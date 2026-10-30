"""Vitrine entre linhas: blocos (banner, carrossel, vídeo, faixa de produtos, aviso)
intercalados na rolagem infinita de produtos do totem.

Cada bloco diz depois de qual linha de produtos aparece (e se repete a cada N
linhas) e, opcionalmente, para quem: faixas etárias estimadas pela câmera e/ou
interesses da sessão (nichos e categorias que a pessoa navegou ou abriu). O
totem escolhe o bloco de cada posição quando ela está para aparecer na tela
(frontend/vitrine.js), então a escolha reflete quem está na frente naquele momento.

Exibições e toques viram eventos da sessão (vitrine_ver / vitrine_clique), que já
vão para o Supabase com os outros logs (nuvem.py).

Rotas:
  GET    /api/vitrine                 blocos (?ativos=1: só os ativos e no período, para o totem)
  POST   /api/vitrine                 cria
  PATCH  /api/vitrine/<id>            altera
  DELETE /api/vitrine/<id>            remove
  GET    /api/vitrine/relatorio?dias=7 exibições, toques e público de cada bloco
  GET    /api/vitrine/config          campanhas entre as linhas: ligado e a cada quantas linhas
  POST   /api/vitrine/config
"""
from __future__ import annotations

import json
import re
import time
from collections import Counter
from datetime import datetime
from typing import Any, Callable

from flask import Blueprint, jsonify, request

import metricas

bp = Blueprint("vitrine", __name__)
_db: Callable[[], Any] | None = None

TIPOS = {"banner", "carrossel", "video", "produtos", "aviso"}
ACOES = {"nenhuma", "categoria", "nicho", "busca", "produto"}
CORES = {"azul", "verde", "laranja", "roxo", "escuro"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS vitrine_config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vitrine_blocos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT DEFAULT 'default',
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL,                  -- banner | carrossel | video | produtos | aviso
    midias TEXT DEFAULT '[]',            -- URLs das imagens/vídeo
    titulo TEXT DEFAULT '',
    subtitulo TEXT DEFAULT '',
    cta TEXT DEFAULT '',                 -- texto do botão
    acao TEXT DEFAULT 'nenhuma',         -- o que o toque faz: categoria | nicho | busca | produto | nenhuma
    acao_valor TEXT DEFAULT '',
    apos_linha INTEGER DEFAULT 2,        -- aparece depois desta linha de produtos
    repetir_cada INTEGER DEFAULT 0,      -- e de novo a cada N linhas (0 = só uma vez)
    faixas TEXT DEFAULT '[]',            -- público por idade ([] = todos)
    interesses TEXT DEFAULT '[]',        -- nichos/categorias ([] = todos)
    prioridade INTEGER DEFAULT 0,
    extras TEXT DEFAULT '{}',            -- produtos: {fonte, valor, limite}; aviso: {cor}; carrossel: {intervalo_s}
    ativo INTEGER DEFAULT 1,
    inicio TEXT,                         -- período (ISO local, opcional)
    fim TEXT,
    atualizado REAL
);
"""


def configurar(db: Callable[[], Any]) -> None:
    global _db
    _db = db
    with _db() as conn:
        conn.executescript(SCHEMA)


def _lista(valor: Any, limite: int = 30, tamanho: int = 60) -> list[str]:
    if isinstance(valor, str):
        valor = [v for v in valor.split(",") if v.strip()]
    return [str(v).strip()[:tamanho] for v in (valor or []) if str(v).strip()][:limite]


def _midia_ok(url: str) -> bool:
    return bool(re.match(r"^(https?://|/uploads/)", url))


def _validar(p: dict[str, Any], base: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    b = {**(base or {}), **p}
    tipo = b.get("tipo")
    if tipo not in TIPOS:
        return None, "tipo_invalido"
    midias = [u for u in _lista(b.get("midias"), 12, 500) if _midia_ok(u)]
    if tipo in {"banner", "carrossel", "video"} and not midias:
        return None, "midia_obrigatoria"
    acao = b.get("acao") if b.get("acao") in ACOES else "nenhuma"
    extras = b.get("extras") if isinstance(b.get("extras"), dict) else {}
    extras = {
        "fonte": extras.get("fonte") if extras.get("fonte") in {"categoria", "nicho", "busca", "promocao"} else "promocao",
        "valor": str(extras.get("valor") or "")[:80],
        "limite": max(4, min(int(extras.get("limite") or 8), 16)),
        "cor": extras.get("cor") if extras.get("cor") in CORES else "azul",
        "intervalo_s": max(2, min(int(extras.get("intervalo_s") or 4), 20)),
    }
    return {
        "nome": str(b.get("nome") or "").strip()[:80] or f"Bloco {tipo}",
        "tipo": tipo,
        "midias": midias if tipo != "video" else midias[:1],
        "titulo": str(b.get("titulo") or "")[:90],
        "subtitulo": str(b.get("subtitulo") or "")[:160],
        "cta": str(b.get("cta") or "")[:30],
        "acao": acao,
        "acao_valor": str(b.get("acao_valor") or "")[:120] if acao != "nenhuma" else "",
        "apos_linha": max(1, min(int(b.get("apos_linha") or 1), 200)),
        "repetir_cada": max(0, min(int(b.get("repetir_cada") or 0), 50)),
        "faixas": metricas.faixas_validas(b.get("faixas")),
        "interesses": _lista(b.get("interesses"), 30, 40),
        "prioridade": max(0, min(int(b.get("prioridade") or 0), 10)),
        "extras": extras,
        "ativo": bool(b.get("ativo", True)),
        "inicio": str(b.get("inicio") or "")[:16] or None,
        "fim": str(b.get("fim") or "")[:16] or None,
    }, None


def _linha(r: Any) -> dict[str, Any]:
    d = dict(r)
    host = request.host_url.rstrip("/")
    # mídias enviadas pelo admin no notebook: troca o host pelo de quem pede (o totem)
    d["midias"] = [re.sub(r"^https?://[^/]+(?=/uploads/)", host, u) if u.startswith("http") else host + u
                   for u in json.loads(d["midias"] or "[]")]
    for campo in ("faixas", "interesses"):
        d[campo] = json.loads(d[campo] or "[]")
    d["extras"] = json.loads(d["extras"] or "{}")
    d["ativo"] = bool(d["ativo"])
    return d


def _no_periodo(b: dict[str, Any]) -> bool:
    agora = datetime.now().strftime("%Y-%m-%dT%H:%M")
    return (not b["inicio"] or b["inicio"] <= agora) and (not b["fim"] or agora <= b["fim"])


def _gravar(conn, dados: dict[str, Any], bid: int | None = None) -> int:
    valores = (dados["nome"], dados["tipo"], json.dumps(dados["midias"]), dados["titulo"], dados["subtitulo"],
               dados["cta"], dados["acao"], dados["acao_valor"], dados["apos_linha"], dados["repetir_cada"],
               json.dumps(dados["faixas"]), json.dumps(dados["interesses"]), dados["prioridade"],
               json.dumps(dados["extras"]), 1 if dados["ativo"] else 0, dados["inicio"], dados["fim"], time.time())
    campos = ("nome, tipo, midias, titulo, subtitulo, cta, acao, acao_valor, apos_linha, repetir_cada, faixas, "
              "interesses, prioridade, extras, ativo, inicio, fim, atualizado")
    if bid is None:
        cur = conn.execute(f"INSERT INTO vitrine_blocos ({campos}) VALUES ({','.join('?' * len(valores))})", valores)
        return cur.lastrowid
    conn.execute(f"UPDATE vitrine_blocos SET {', '.join(c.strip() + '=?' for c in campos.split(','))} WHERE id=?",
                 (*valores, bid))
    return bid


@bp.get("/api/vitrine")
def listar():
    with _db() as conn:
        blocos = [_linha(r) for r in conn.execute(
            "SELECT * FROM vitrine_blocos ORDER BY apos_linha, prioridade DESC, id")]
    if request.args.get("ativos"):
        blocos = [b for b in blocos if b["ativo"] and _no_periodo(b)]
    return jsonify(blocos)


@bp.post("/api/vitrine")
def criar():
    dados, erro = _validar(request.get_json(silent=True) or {})
    if erro:
        return jsonify({"error": erro}), 400
    with _db() as conn:
        bid = _gravar(conn, dados)
        return jsonify(_linha(conn.execute("SELECT * FROM vitrine_blocos WHERE id=?", (bid,)).fetchone())), 201


@bp.patch("/api/vitrine/<int:bid>")
def alterar(bid: int):
    with _db() as conn:
        atual = conn.execute("SELECT * FROM vitrine_blocos WHERE id=?", (bid,)).fetchone()
        if not atual:
            return jsonify({"error": "nao_encontrado"}), 404
        dados, erro = _validar(request.get_json(silent=True) or {}, _linha(atual))
        if erro:
            return jsonify({"error": erro}), 400
        _gravar(conn, dados, bid)
        return jsonify(_linha(conn.execute("SELECT * FROM vitrine_blocos WHERE id=?", (bid,)).fetchone()))


@bp.delete("/api/vitrine/<int:bid>")
def remover(bid: int):
    with _db() as conn:
        conn.execute("DELETE FROM vitrine_blocos WHERE id=?", (bid,))
    return jsonify({"ok": True})


CONFIG_PADRAO = {"campanhas_ativas": True, "campanhas_a_cada": 5, "anuncios_casa": True}


def config() -> dict[str, Any]:
    with _db() as conn:
        salvo = {r["chave"]: json.loads(r["valor"]) for r in conn.execute("SELECT * FROM vitrine_config")}
    return {**CONFIG_PADRAO, **{k: v for k, v in salvo.items() if k in CONFIG_PADRAO}}


@bp.get("/api/vitrine/config")
def ler_config():
    return jsonify(config())


@bp.post("/api/vitrine/config")
def salvar_config():
    p = request.get_json(silent=True) or {}
    atual = config()
    novos = {"campanhas_ativas": bool(p.get("campanhas_ativas", atual["campanhas_ativas"])),
             "campanhas_a_cada": max(2, min(int(p.get("campanhas_a_cada", atual["campanhas_a_cada"])), 30)),
             "anuncios_casa": bool(p.get("anuncios_casa", atual["anuncios_casa"]))}
    with _db() as conn:
        conn.executemany("INSERT OR REPLACE INTO vitrine_config (chave, valor) VALUES (?,?)",
                         [(k, json.dumps(v)) for k, v in novos.items()])
    return jsonify(novos)


@bp.get("/api/vitrine/relatorio")
def relatorio():
    desde = metricas._desde()
    eventos, fonte = metricas._ler(
        "totem_sessao_eventos", {"ts": f"gte.{desde}", "tipo": "in.(vitrine_ver,vitrine_clique)"},
        "SELECT tipo, alvo, detalhe FROM sessao_eventos WHERE ts>=? AND tipo IN ('vitrine_ver','vitrine_clique')",
        (desde,), colunas="tipo,alvo,detalhe")
    por_bloco: dict[str, dict[str, Any]] = {}
    for ev in eventos:
        b = por_bloco.setdefault(ev["alvo"], {"exibicoes": 0, "toques": 0, "segmentadas": 0, "faixas": Counter()})
        detalhe = metricas._json(ev["detalhe"])
        if ev["tipo"] == "vitrine_ver":
            b["exibicoes"] += 1
            b["segmentadas"] += detalhe.get("motivo") in {"idade", "interesse", "idade+interesse"}
            if detalhe.get("faixa"):
                b["faixas"][detalhe["faixa"]] += 1
        else:
            b["toques"] += 1
    saida = {bid: {**b, "faixas": dict(b["faixas"]),
                   "taxa_toque": round(b["toques"] / b["exibicoes"] * 100, 1) if b["exibicoes"] else 0}
             for bid, b in por_bloco.items()}
    return jsonify({"fonte": fonte, "blocos": saida})
