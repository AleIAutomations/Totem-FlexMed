"""Métricas de anúncios, audiência e sessões de uso do totem (SQLite local).

Tudo é anônimo: guarda-se faixa etária, se a pessoa olhou e por quanto tempo,
e o que foi tocado na tela — nunca imagem ou dado do rosto.

Rotas (Blueprint registrado no app.py):
  POST /api/anuncios/exibicoes              início da exibição de um anúncio
  POST /api/anuncios/exibicoes/<id>/fim     fim (audiência vem do motor de visão)
  GET  /api/audiencia/agora                 público na frente do totem agora
  POST /api/sessoes                         início de uma sessão de uso
  POST /api/sessoes/<id>/eventos            eventos da sessão (cliques, telas...)
  POST /api/sessoes/<id>/fim                fim da sessão (finalizou ou desistiu)
  GET  /api/sessoes/<id>                    linha do tempo de uma sessão
  GET  /api/relatorios/anuncios|audiencia|sessoes?dias=7
  GET  /api/logs?dias=1&tipo=todos           linha do tempo de tudo o que o totem registrou
  GET  /api/audiencia/modelo                 classificador de faixa etária em uso e sua precisão

Os relatórios e os logs leem do Supabase (ver nuvem.py) quando ele está
acessível; senão, do SQLite local. A resposta diz a fonte ("fonte").
"""
from __future__ import annotations

import json
import time
from collections import Counter
from typing import Any, Callable

from flask import Blueprint, jsonify, request

import nuvem
from visao import FAIXAS, MENOR, SLUGS_FAIXAS

bp = Blueprint("metricas", __name__)

# preenchidos pelo app.py em configurar()
_db: Callable[[], Any] | None = None
_motor: Callable[[], Any] | None = None

TIPOS_EVENTO = {"clique", "tela", "busca", "categoria", "produto", "carrinho_add", "carrinho_remover",
                "finalizou", "voz", "libras", "idioma", "avaliacao",
                "vitrine_ver", "vitrine_clique",
                # comportamento (sessao.js): posição dos toques, tempo por tela/produto, produtos vistos, rolagem
                "toque", "tela_tempo", "produto_tempo", "impressoes", "rolagem", "layout"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS exibicoes_anuncio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT DEFAULT 'default',
    campaign_id INTEGER,
    motivo TEXT DEFAULT 'rotacao',        -- segmentado (pela faixa do público) | rotacao
    faixa_alvo TEXT,                      -- faixa que motivou a escolha
    inicio REAL NOT NULL,                 -- epoch (s)
    fim REAL,
    duracao_s REAL DEFAULT 0,
    espectadores INTEGER DEFAULT 0,       -- pessoas que olharam durante a exibição
    atencao_s REAL DEFAULT 0,             -- soma do tempo olhando
    faixas TEXT DEFAULT '{}',             -- espectadores por faixa
    interagiu INTEGER DEFAULT 0           -- alguém tocou a tela durante o anúncio
);
CREATE INDEX IF NOT EXISTS idx_exib_inicio ON exibicoes_anuncio (inicio);

CREATE TABLE IF NOT EXISTS audiencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT DEFAULT 'default',
    inicio REAL NOT NULL,
    fim REAL NOT NULL,
    faixa TEXT,                           -- menor | 18-28 | 28-38 | ... | 78-88 | NULL
    olhou INTEGER DEFAULT 0,
    atencao_s REAL DEFAULT 0,
    contexto TEXT DEFAULT 'standby'       -- standby (anúncios) | uso
);
CREATE INDEX IF NOT EXISTS idx_aud_inicio ON audiencia (inicio);

CREATE TABLE IF NOT EXISTS sessoes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    origem TEXT DEFAULT 'toque',          -- toque | anuncio
    inicio REAL NOT NULL,
    fim REAL,
    duracao_s REAL DEFAULT 0,
    atencao_s REAL DEFAULT 0,
    faixa TEXT,                           -- faixa predominante de quem usou
    cliques INTEGER DEFAULT 0,
    produtos_vistos INTEGER DEFAULT 0,
    buscas INTEGER DEFAULT 0,
    adicionados INTEGER DEFAULT 0,
    finalizou INTEGER DEFAULT 0,
    desistiu INTEGER DEFAULT 0,
    ultima_tela TEXT,
    saida TEXT                            -- inatividade | finalizou | libras ...
);
CREATE INDEX IF NOT EXISTS idx_sessoes_inicio ON sessoes (inicio);

CREATE TABLE IF NOT EXISTS sessao_eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessao_id TEXT NOT NULL,
    ts REAL NOT NULL,
    tipo TEXT NOT NULL,
    alvo TEXT,
    tela TEXT,
    detalhe TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_eventos_sessao ON sessao_eventos (sessao_id, ts);
"""


def configurar(db: Callable[[], Any], motor: Callable[[], Any]) -> None:
    global _db, _motor
    _db, _motor = db, motor
    with _db() as conn:
        conn.executescript(SCHEMA)
        colunas = {r["name"] for r in conn.execute("PRAGMA table_info(campaigns)")}
        if "faixas" not in colunas:   # público-alvo das campanhas (lista de faixas)
            conn.execute("ALTER TABLE campaigns ADD COLUMN faixas TEXT DEFAULT '[]'")
        if "na_vitrine" not in colunas:   # campanha também aparece entre as linhas de produtos (vitrine.js)
            conn.execute("ALTER TABLE campaigns ADD COLUMN na_vitrine INTEGER DEFAULT 1")
        colunas = {r["name"] for r in conn.execute("PRAGMA table_info(audiencia)")}
        for coluna, tipo in (("idade", "INTEGER"), ("confianca", "REAL")):
            if coluna not in colunas:
                conn.execute(f"ALTER TABLE audiencia ADD COLUMN {coluna} {tipo}")
        # público-alvo salvo com as faixas antigas (jovem/adulto/maduro/idoso): converte
        for c in conn.execute("SELECT id, faixas FROM campaigns").fetchall():
            antigas = _json_lista(c["faixas"])
            if any(f in FAIXAS_ANTIGAS for f in antigas):
                novas = sorted({n for f in antigas for n in FAIXAS_ANTIGAS.get(f, [f]) if n in SLUGS_FAIXAS},
                               key=SLUGS_FAIXAS.index)
                conn.execute("UPDATE campaigns SET faixas=? WHERE id=?", (json.dumps(novas), c["id"]))


FAIXAS_ANTIGAS = {"jovem": ["18-28"], "adulto": ["28-38", "38-48"], "maduro": ["48-58"],
                  "idoso": ["58-68", "68-78", "78-88"]}


def registrar_passagem(dados: dict[str, Any]) -> None:
    """Chamado pelo motor de visão quando uma pessoa sai da frente da câmera."""
    if _db is None:
        return
    with _db() as conn:
        conn.execute(
            "INSERT INTO audiencia (inicio, fim, faixa, idade, confianca, olhou, atencao_s, contexto) VALUES (?,?,?,?,?,?,?,?)",
            (dados["inicio"], dados["fim"], dados["faixa"], dados.get("idade"), dados.get("confianca"),
             1 if dados["olhou"] else 0, dados["atencao_s"], dados.get("contexto", "standby")),
        )


def faixas_validas(valor: Any) -> list[str]:
    if isinstance(valor, str):
        valor = [valor]
    return [f for f in (valor or []) if f in SLUGS_FAIXAS]


def _desde() -> float:
    dias = max(1, min(request.args.get("dias", 7, type=int), 365))
    return time.time() - dias * 86400


def _json(texto: Any) -> dict:
    if isinstance(texto, dict):      # jsonb vindo do Supabase
        return texto
    try:
        return json.loads(texto or "{}")
    except (TypeError, ValueError):
        return {}


# ─── Anúncios ────────────────────────────────────────────────────────────────
@bp.post("/api/anuncios/exibicoes")
def exibicao_inicio():
    p = request.get_json(silent=True) or {}
    with _db() as conn:
        cur = conn.execute(
            "INSERT INTO exibicoes_anuncio (campaign_id, motivo, faixa_alvo, inicio) VALUES (?,?,?,?)",
            (p.get("campaign_id"), p.get("motivo") or "rotacao",
             p.get("faixa_alvo") if p.get("faixa_alvo") in SLUGS_FAIXAS else None, time.time()),
        )
    return jsonify({"id": cur.lastrowid}), 201


@bp.post("/api/anuncios/exibicoes/<int:eid>/fim")
def exibicao_fim(eid: int):
    p = request.get_json(silent=True) or {}
    resumo = _motor().fechar_alvo(f"anuncio:{eid}") if _motor() else {"espectadores": 0, "atencao_s": 0, "faixas": {}}
    agora = time.time()
    with _db() as conn:
        conn.execute(
            """UPDATE exibicoes_anuncio SET fim=?, duracao_s=?-inicio, espectadores=?, atencao_s=?, faixas=?,
               interagiu=? WHERE id=? AND fim IS NULL""",
            (agora, agora, resumo["espectadores"], resumo["atencao_s"], json.dumps(resumo["faixas"]),
             1 if p.get("interagiu") else 0, eid),
        )
    return jsonify({"ok": True, **resumo})


@bp.get("/api/audiencia/agora")
def audiencia_agora():
    motor = _motor()
    return jsonify(motor.retrato() if motor else {"pessoas": 0, "olhando": 0, "faixas": {}, "dominante": None})


# ─── Sessões de uso ──────────────────────────────────────────────────────────
@bp.post("/api/sessoes")
def sessao_inicio():
    p = request.get_json(silent=True) or {}
    sid = str(p.get("id") or "")[:64]
    if not sid:
        return jsonify({"error": "missing_id"}), 400
    with _db() as conn:
        conn.execute("INSERT OR IGNORE INTO sessoes (id, origem, inicio) VALUES (?,?,?)",
                     (sid, p.get("origem") if p.get("origem") in ("toque", "anuncio", "aproximacao") else "toque",
                      time.time()))
    return jsonify({"id": sid}), 201


@bp.post("/api/sessoes/<sid>/eventos")
def sessao_eventos(sid: str):
    p = request.get_json(silent=True, force=True) or {}
    linhas = []
    for ev in (p.get("eventos") or [])[:200]:
        if ev.get("tipo") not in TIPOS_EVENTO:
            continue
        detalhe = json.dumps(ev.get("detalhe") or {}, ensure_ascii=False)
        if len(detalhe) > 2500:   # nunca corta o JSON no meio (ficaria ilegível): descarta o detalhe
            detalhe = "{}"
        linhas.append((sid, float(ev.get("ts") or time.time()), ev["tipo"], str(ev.get("alvo") or "")[:120],
                       str(ev.get("tela") or "")[:40], detalhe))
    if linhas:
        with _db() as conn:
            conn.executemany("INSERT INTO sessao_eventos (sessao_id, ts, tipo, alvo, tela, detalhe) VALUES (?,?,?,?,?,?)", linhas)
    return jsonify({"ok": True, "gravados": len(linhas)})


@bp.post("/api/sessoes/<sid>/fim")
def sessao_fim(sid: str):
    p = request.get_json(silent=True, force=True) or {}
    resumo = _motor().fechar_alvo(f"sessao:{sid}") if _motor() else {"atencao_s": 0, "faixas": {}}
    faixas = Counter({k: v for k, v in (resumo.get("faixas") or {}).items() if v})
    agora = time.time()
    with _db() as conn:
        sessao = conn.execute("SELECT * FROM sessoes WHERE id=?", (sid,)).fetchone()
        if not sessao or sessao["fim"] is not None:
            return jsonify({"ok": False}), 404
        tipos = Counter(r["tipo"] for r in conn.execute("SELECT tipo FROM sessao_eventos WHERE sessao_id=?", (sid,)))
        finalizou = tipos["finalizou"] > 0
        conn.execute(
            """UPDATE sessoes SET fim=?, duracao_s=?-inicio, atencao_s=?, faixa=?, cliques=?, produtos_vistos=?,
               buscas=?, adicionados=?, finalizou=?, desistiu=?, ultima_tela=?, saida=? WHERE id=?""",
            (agora, agora, resumo.get("atencao_s", 0), faixas.most_common(1)[0][0] if faixas else None,
             tipos["clique"], tipos["produto"], tipos["busca"], tipos["carrinho_add"],
             1 if finalizou else 0, 0 if finalizou else 1, str(p.get("ultima_tela") or "")[:40],
             "finalizou" if finalizou else str(p.get("saida") or "inatividade")[:40], sid),
        )
    return jsonify({"ok": True})


@bp.get("/api/sessoes/<sid>")
def sessao_detalhe(sid: str):
    sessao, _ = _ler("totem_sessoes", {"id": f"eq.{sid}"}, "SELECT * FROM sessoes WHERE id=?", (sid,))
    eventos, _ = _ler("totem_sessao_eventos", {"sessao_id": f"eq.{sid}"},
                      "SELECT ts, tipo, alvo, tela, detalhe FROM sessao_eventos WHERE sessao_id=? ORDER BY ts", (sid,),
                      colunas="ts,tipo,alvo,tela,detalhe", ordem="ts")
    sessao = sessao[0] if sessao else None
    if not sessao:
        return jsonify({"error": "not_found"}), 404
    return jsonify({**dict(sessao), "eventos": [{**dict(e), "detalhe": _json(e["detalhe"])} for e in eventos]})


# ─── Leitura para os relatórios: Supabase, ou SQLite se ele estiver fora ──────
def _ler(remota: str, filtros: dict[str, str], sql_local: str, params: tuple, colunas: str = "*",
         ordem: str | None = None, limite: int = 50000) -> tuple[list[dict[str, Any]], str]:
    if nuvem.atualizado_para_leitura():
        try:
            return nuvem.buscar(remota, filtros, colunas, ordem, limite), "supabase"
        except Exception as exc:
            print(f"[Métricas] Supabase indisponível na leitura ({exc}); usando o SQLite", flush=True)
    with _db() as conn:
        return [dict(r) for r in conn.execute(sql_local, params)], "local"


# ─── Relatórios do painel admin ──────────────────────────────────────────────
@bp.get("/api/relatorios/anuncios")
def relatorio_anuncios():
    desde = _desde()
    with _db() as conn:
        nomes = {r["id"]: (r["name"], _json_lista(r["faixas"])) for r in conn.execute("SELECT id, name, faixas FROM campaigns")}
    linhas, fonte = _ler("totem_exibicoes", {"inicio": f"gte.{desde}", "fim": "not.is.null"},
                         "SELECT * FROM exibicoes_anuncio WHERE inicio>=? AND fim IS NOT NULL", (desde,))
    removidas: dict[Any, str] = {}
    por_campanha: dict[Any, dict[str, Any]] = {}
    for r in linhas:
        c = por_campanha.setdefault(r["campaign_id"], {
            "campaign_id": r["campaign_id"], "exibicoes": 0, "segmentadas": 0, "tempo_s": 0.0, "espectadores": 0,
            "atencao_s": 0.0, "interacoes": 0, "faixas": Counter()})
        if r.get("campanha_nome"):
            removidas[r["campaign_id"]] = r["campanha_nome"]
        c["exibicoes"] += 1
        c["segmentadas"] += r["motivo"] == "segmentado"
        c["tempo_s"] += r["duracao_s"] or 0
        c["espectadores"] += r["espectadores"] or 0
        c["atencao_s"] += r["atencao_s"] or 0
        c["interacoes"] += r["interagiu"] or 0
        c["faixas"].update(_json(r["faixas"]))
    saida = []
    for c in por_campanha.values():
        # campanha apagada: o histórico de exibições continua valendo
        nome, alvo = nomes.get(c["campaign_id"], (
            f"{removidas.get(c['campaign_id']) or 'Anúncio'} (removido, #{c['campaign_id']})", []))
        saida.append({
            **c, "nome": nome, "publico_alvo": alvo, "faixas": {f: c["faixas"].get(f, 0) for f in SLUGS_FAIXAS},
            "tempo_s": round(c["tempo_s"]), "atencao_s": round(c["atencao_s"], 1),
            "atencao_media_s": round(c["atencao_s"] / c["espectadores"], 1) if c["espectadores"] else 0,
            "espectadores_por_exibicao": round(c["espectadores"] / c["exibicoes"], 2) if c["exibicoes"] else 0,
            "taxa_interacao": round(c["interacoes"] / c["exibicoes"] * 100, 1) if c["exibicoes"] else 0,
        })
    saida.sort(key=lambda c: c["espectadores"], reverse=True)
    totais = {
        "exibicoes": sum(c["exibicoes"] for c in saida), "espectadores": sum(c["espectadores"] for c in saida),
        "atencao_s": round(sum(c["atencao_s"] for c in saida), 1), "interacoes": sum(c["interacoes"] for c in saida),
    }
    return jsonify({"fonte": fonte, "totais": totais, "campanhas": saida})


def _json_lista(texto: str | None) -> list:
    try:
        v = json.loads(texto or "[]")
        return v if isinstance(v, list) else []
    except (TypeError, ValueError):
        return []


@bp.get("/api/relatorios/audiencia")
def relatorio_audiencia():
    desde = _desde()
    linhas, fonte = _ler("totem_audiencia", {"inicio": f"gte.{desde}"},
                         "SELECT inicio, faixa, idade, confianca, olhou, atencao_s, contexto FROM audiencia WHERE inicio>=?",
                         (desde,), colunas="inicio,faixa,idade,confianca,olhou,atencao_s,contexto")
    for r in linhas:
        r["hora"] = time.localtime(r["inicio"]).tm_hour
    total = len(linhas)
    olharam = [r for r in linhas if r["olhou"]]
    faixas = Counter(r["faixa"] for r in olharam if r["faixa"])
    segmentaveis = sum(faixas.get(f, 0) for f in SLUGS_FAIXAS)
    confiancas = [r["confianca"] for r in olharam if r.get("confianca") is not None]
    por_hora = Counter(r["hora"] for r in linhas)
    olhar_hora = Counter(r["hora"] for r in olharam)
    return jsonify({
        "fonte": fonte,
        "pessoas": total,
        "olharam": len(olharam),
        "taxa_olhar": round(len(olharam) / total * 100, 1) if total else 0,
        "atencao_media_s": round(sum(r["atencao_s"] for r in olharam) / len(olharam), 1) if olharam else 0,
        "por_contexto": dict(Counter(r["contexto"] for r in linhas)),
        "faixas": [{"faixa": slug, "nome": nome, "pessoas": faixas.get(slug, 0),
                    "pct": round(faixas.get(slug, 0) / segmentaveis * 100, 1) if segmentaveis else 0}
                   for slug, nome, _, _ in FAIXAS] + [{"faixa": MENOR, "nome": "Menores de 18",
                                                       "pessoas": faixas.get(MENOR, 0), "pct": None}],
        # sem faixa: rosto longe/de lado, ou registro de antes das faixas de 10 anos
        "sem_faixa": len(olharam) - segmentaveis - faixas.get(MENOR, 0),
        "confianca_media": round(sum(confiancas) / len(confiancas) * 100) if confiancas else None,
        "por_hora": [{"hora": h, "pessoas": por_hora.get(h, 0), "olharam": olhar_hora.get(h, 0)} for h in range(24)],
    })


@bp.get("/api/relatorios/sessoes")
def relatorio_sessoes():
    desde = _desde()
    sessoes, fonte = _ler("totem_sessoes", {"inicio": f"gte.{desde}", "fim": "not.is.null"},
                          "SELECT * FROM sessoes WHERE inicio>=? AND fim IS NOT NULL ORDER BY inicio DESC", (desde,),
                          ordem="inicio.desc")
    eventos, _ = _ler("totem_sessao_eventos", {"ts": f"gte.{desde}"},
                      """SELECT e.tipo, e.alvo, e.tela FROM sessao_eventos e JOIN sessoes s ON s.id = e.sessao_id
                         WHERE s.inicio>=?""", (desde,), colunas="tipo,alvo,tela")
    n = len(sessoes)
    media = lambda campo: round(sum(s[campo] or 0 for s in sessoes) / n, 1) if n else 0
    finalizaram = sum(s["finalizou"] for s in sessoes)
    desistencias = [s for s in sessoes if s["desistiu"]]
    contar = lambda tipo: Counter(e["alvo"] for e in eventos if e["tipo"] == tipo and e["alvo"]).most_common(10)
    funil = [
        ("Iniciaram uma sessão", n),
        ("Interagiram (tocaram)", sum(1 for s in sessoes if s["cliques"] > 0)),
        ("Viram um produto", sum(1 for s in sessoes if s["produtos_vistos"] > 0)),
        ("Adicionaram à lista", sum(1 for s in sessoes if s["adicionados"] > 0)),
        ("Finalizaram (pedido no balcão)", finalizaram),
    ]
    return jsonify({
        "fonte": fonte,
        "sessoes": n,
        "duracao_media_s": media("duracao_s"),
        "atencao_media_s": media("atencao_s"),
        "cliques_por_sessao": media("cliques"),
        "produtos_vistos_total": sum(s["produtos_vistos"] or 0 for s in sessoes),
        "buscas_voz": sum(1 for e in eventos if e["tipo"] == "voz"),
        "taxa_conversao": round(finalizaram / n * 100, 1) if n else 0,
        "taxa_desistencia": round(len(desistencias) / n * 100, 1) if n else 0,
        "funil": [{"etapa": e, "sessoes": v, "pct": round(v / n * 100, 1) if n else 0} for e, v in funil],
        "mais_clicados": [{"alvo": a, "cliques": c} for a, c in contar("clique")],
        "produtos_mais_vistos": [{"produto": a, "vezes": c} for a, c in contar("produto")],
        "buscas": [{"termo": a, "vezes": c} for a, c in contar("busca")],
        "categorias": [{"categoria": a, "vezes": c} for a, c in contar("categoria")],
        "telas_de_desistencia": [{"tela": t or "início", "sessoes": c}
                                 for t, c in Counter(s["ultima_tela"] for s in desistencias).most_common(8)],
        "por_faixa": dict(Counter(s["faixa"] or "não identificado" for s in sessoes)),
        "por_origem": dict(Counter(s["origem"] for s in sessoes)),
        "recentes": [{k: s[k] for k in ("id", "origem", "inicio", "duracao_s", "atencao_s", "faixa", "cliques",
                                       "produtos_vistos", "adicionados", "finalizou", "ultima_tela", "saida")}
                     for s in sessoes[:25]],
    })


# ─── Logs: tudo o que o totem registrou, em ordem de tempo ───────────────────
TIPOS_LOG = {
    # tipo: (tabela remota, colunas, SQL local) — "ts" é o instante do registro
    "sessoes": ("totem_sessoes", "id,origem,inicio,fim,duracao_s,faixa,cliques,produtos_vistos,adicionados,finalizou,ultima_tela,saida",
                "SELECT id, origem, inicio, fim, duracao_s, faixa, cliques, produtos_vistos, adicionados, finalizou, "
                "ultima_tela, saida FROM sessoes WHERE inicio>=? AND fim IS NOT NULL ORDER BY inicio DESC LIMIT ?", "inicio"),
    "eventos": ("totem_sessao_eventos", "sessao_id,ts,tipo,alvo,tela",
                "SELECT sessao_id, ts, tipo, alvo, tela FROM sessao_eventos WHERE ts>=? ORDER BY ts DESC LIMIT ?", "ts"),
    "presenca": ("totem_presenca_eventos", "ts,tipo,distancia_cm,detalhe",
                 "SELECT ts, tipo, distancia_cm, detalhe FROM presenca_eventos WHERE ts>=? ORDER BY ts DESC LIMIT ?", "ts"),
    "anuncios": ("totem_exibicoes", "campaign_id,campanha_nome,motivo,faixa_alvo,inicio,duracao_s,espectadores,atencao_s,interagiu",
                 "SELECT e.campaign_id, c.name AS campanha_nome, e.motivo, e.faixa_alvo, e.inicio, e.duracao_s, "
                 "e.espectadores, e.atencao_s, e.interagiu FROM exibicoes_anuncio e LEFT JOIN campaigns c "
                 "ON c.id = e.campaign_id WHERE e.inicio>=? AND e.fim IS NOT NULL ORDER BY e.inicio DESC LIMIT ?", "inicio"),
    "audiencia": ("totem_audiencia", "inicio,fim,faixa,idade,confianca,olhou,atencao_s,contexto",
                  "SELECT inicio, fim, faixa, idade, confianca, olhou, atencao_s, contexto FROM audiencia "
                  "WHERE inicio>=? ORDER BY inicio DESC LIMIT ?", "inicio"),
}


@bp.get("/api/logs")
def logs():
    desde = _desde()
    limite = max(10, min(request.args.get("limite", 300, type=int), 2000))
    pedidos = request.args.get("tipo", "todos")
    tipos = list(TIPOS_LOG) if pedidos == "todos" else [t for t in pedidos.split(",") if t in TIPOS_LOG]
    itens, fontes, contagem = [], set(), {}
    for tipo in tipos:
        remota, colunas, sql, campo_ts = TIPOS_LOG[tipo]
        linhas, fonte = _ler(remota, {campo_ts: f"gte.{desde}"}, sql, (desde, limite), colunas=colunas,
                             ordem=f"{campo_ts}.desc", limite=limite)
        fontes.add(fonte)
        contagem[tipo] = len(linhas)
        for r in linhas:
            if "detalhe" in r:
                r["detalhe"] = _json(r["detalhe"])
            itens.append({**r, "categoria": tipo, "ts": r[campo_ts]})
    itens.sort(key=lambda i: i["ts"], reverse=True)
    return jsonify({"fonte": "supabase" if fontes == {"supabase"} else "local" if fontes == {"local"} else "misto",
                    "contagem": contagem, "itens": itens[:limite]})


@bp.get("/api/audiencia/modelo")
def audiencia_modelo():
    motor = _motor()
    info = motor.modelo_info if motor else {"treinado": False}
    return jsonify({**info, "faixas": [{"faixa": slug, "nome": nome} for slug, nome, _, _ in FAIXAS]})
