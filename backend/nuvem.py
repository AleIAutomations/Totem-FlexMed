"""Envio das métricas e logs do totem para o Supabase, e leitura de volta para o painel.

O totem grava tudo primeiro no SQLite local (funciona sem internet). A cada
INTERVALO_S uma thread envia o que é novo para as tabelas `totem_*` do Supabase
(upsert idempotente: reenviar não duplica). Os relatórios do painel admin leem
do Supabase quando ele está acessível, e do SQLite quando não está.

Tabelas: backend/supabase/metricas.sql (rodar uma vez no SQL Editor do projeto).

Rotas:
  GET  /api/nuvem/status        conexão, tabelas, pendências e último envio
  POST /api/nuvem/sincronizar   envia agora
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Callable

import requests
from flask import Blueprint, jsonify

bp = Blueprint("nuvem", __name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
TOTEM_ID = (os.getenv("TOTEM_ID") or "totem-01")[:40]
INTERVALO_S = 15
LOTE = 500
TIMEOUT = 15
SOBREPOSICAO_S = 10     # cursor de tempo ("fim", "atualizado"): reenvia os últimos 10 s (upsert, sem duplicar)


def _json(texto: Any) -> Any:
    if not isinstance(texto, str):
        return texto or {}
    try:
        return json.loads(texto or "{}")
    except ValueError:
        return {}


# tabela local -> como enviar. "cursor": "id" (só inserções) ou uma coluna de tempo que muda a cada
# alteração ("fim" = só linhas encerradas; "atualizado" = linhas que mudam, como saldo e status de pedido)
TABELAS: dict[str, dict[str, Any]] = {
    "audiencia": {
        "remota": "totem_audiencia", "cursor": "id", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], "inicio": r["inicio"], "fim": r["fim"], "faixa": r["faixa"],
                            "idade": r["idade"], "confianca": r["confianca"], "olhou": bool(r["olhou"]),
                            "atencao_s": r["atencao_s"], "contexto": r["contexto"]},
    },
    "exibicoes_anuncio": {
        "remota": "totem_exibicoes", "cursor": "fim", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], "campaign_id": r["campaign_id"], "campanha_nome": r["campanha_nome"],
                            "motivo": r["motivo"], "faixa_alvo": r["faixa_alvo"], "inicio": r["inicio"],
                            "fim": r["fim"], "duracao_s": r["duracao_s"], "espectadores": r["espectadores"],
                            "atencao_s": r["atencao_s"], "faixas": _json(r["faixas"]),
                            "interagiu": bool(r["interagiu"])},
        "sql": """SELECT e.*, c.name AS campanha_nome FROM exibicoes_anuncio e
                  LEFT JOIN campaigns c ON c.id = e.campaign_id WHERE e.fim IS NOT NULL AND e.fim > ?
                  ORDER BY e.fim LIMIT ?""",
    },
    "sessoes": {
        "remota": "totem_sessoes", "cursor": "fim", "conflito": "totem_id,id",
        "linha": lambda r: {k: r[k] for k in (
            "id", "origem", "inicio", "fim", "duracao_s", "atencao_s", "faixa", "cliques", "produtos_vistos",
            "buscas", "adicionados", "ultima_tela", "saida")} | {"finalizou": bool(r["finalizou"]),
                                                                "desistiu": bool(r["desistiu"])},
    },
    "sessao_eventos": {
        "remota": "totem_sessao_eventos", "cursor": "id", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], "sessao_id": r["sessao_id"], "ts": r["ts"], "tipo": r["tipo"],
                            "alvo": r["alvo"], "tela": r["tela"], "detalhe": _json(r["detalhe"])},
    },
    "presenca_eventos": {
        "remota": "totem_presenca_eventos", "cursor": "id", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], "ts": r["ts"], "tipo": r["tipo"],
                            "distancia_cm": r["distancia_cm"], "detalhe": _json(r["detalhe"])},
    },
    # ─── loja (loja.py) ───
    "produto_estoque": {
        "remota": "totem_estoque", "cursor": "atualizado", "conflito": "totem_id,product_id",
        "linha": lambda r: {k: r[k] for k in (
            "product_id", "sku", "ean", "marca", "fabricante", "fornecedor", "unidade", "custo", "estoque",
            "estoque_minimo", "estoque_maximo", "atualizado")} | {"controla_estoque": bool(r["controla_estoque"])},
    },
    "estoque_lotes": {
        "remota": "totem_estoque_lotes", "cursor": "atualizado", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], "product_id": r["product_id"], "lote": r["lote"],
                            "validade": r["validade"], "quantidade": r["quantidade"], "atualizado": r["atualizado"]},
    },
    "estoque_movimentos": {
        "remota": "totem_estoque_movimentos", "cursor": "id", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], **{k: r[k] for k in (
            "product_id", "sku", "nome", "tipo", "quantidade", "saldo_apos", "custo_unit", "lote", "motivo",
            "pedido_id", "usuario", "ts")}},
    },
    "pedidos": {
        "remota": "totem_pedidos", "cursor": "atualizado", "conflito": "totem_id,id",
        "linha": lambda r: {k: r[k] for k in (
            "id", "codigo", "sessao_id", "status", "itens", "total", "observacao", "criado", "atualizado", "entregue_em")},
    },
    "pedido_itens": {
        "remota": "totem_pedido_itens", "cursor": "id", "conflito": "totem_id,local_id",
        "linha": lambda r: {"local_id": r["id"], "pedido_id": r["pedido_id"], "product_id": r["product_id"],
                            "nome": r["nome"], "sku": r["sku"], "qtd": r["qtd"], "preco_unit": r["preco_unit"],
                            "faltou": bool(r["faltou"])},
    },
}

SCHEMA_LOCAL = "CREATE TABLE IF NOT EXISTS nuvem_cursor (tabela TEXT PRIMARY KEY, valor REAL NOT NULL DEFAULT 0)"

_db: Callable[[], Any] | None = None
_lock = threading.Lock()
_estado: dict[str, Any] = {"ultimo_envio": None, "ultima_tentativa": None, "erro": None, "tabelas_ok": None,
                           "enviados": {t: 0 for t in TABELAS}}


def configurado() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _cabecalhos(**extra: str) -> dict[str, str]:
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json",
            **extra}


def configurar(db: Callable[[], Any]) -> None:
    global _db
    _db = db
    with _db() as conn:
        conn.execute(SCHEMA_LOCAL)
    if configurado():
        threading.Thread(target=_laco, name="nuvem-sync", daemon=True).start()


def _laco() -> None:
    time.sleep(5)
    while True:
        sincronizar()
        time.sleep(INTERVALO_S)


def _cursor(conn, tabela: str) -> float:
    r = conn.execute("SELECT valor FROM nuvem_cursor WHERE tabela=?", (tabela,)).fetchone()
    return r["valor"] if r else 0.0


def _pendentes(conn, tabela: str, cfg: dict[str, Any], limite: int) -> list[Any]:
    valor = _cursor(conn, tabela)
    if "sql" in cfg:
        return conn.execute(cfg["sql"], (valor - SOBREPOSICAO_S if valor else 0, limite)).fetchall()
    coluna = cfg["cursor"]
    if coluna != "id":
        return conn.execute(f"SELECT * FROM {tabela} WHERE {coluna} IS NOT NULL AND {coluna} > ? ORDER BY {coluna} LIMIT ?",
                            (valor - SOBREPOSICAO_S if valor else 0, limite)).fetchall()
    return conn.execute(f"SELECT * FROM {tabela} WHERE id > ? ORDER BY id LIMIT ?", (valor, limite)).fetchall()


def _contar_pendentes(conn) -> dict[str, int]:
    saida = {}
    for tabela, cfg in TABELAS.items():
        valor = _cursor(conn, tabela)
        coluna = cfg["cursor"]
        sql = f"SELECT COUNT(*) FROM {tabela} WHERE {coluna} IS NOT NULL AND {coluna} > ?"
        saida[tabela] = conn.execute(sql, (valor,)).fetchone()[0]
    return saida


def sincronizar() -> dict[str, Any]:
    """Envia ao Supabase tudo o que ainda não foi enviado. Seguro chamar de várias threads."""
    if not configurado() or _db is None:
        return {"ok": False, "erro": "supabase_nao_configurado"}
    if not _lock.acquire(timeout=TIMEOUT):
        return {"ok": False, "erro": "sincronizacao_em_andamento"}
    try:
        _estado["ultima_tentativa"] = time.time()
        enviados = {}
        for tabela, cfg in TABELAS.items():
            total = 0
            while True:
                with _db() as conn:
                    linhas = _pendentes(conn, tabela, cfg, LOTE)
                if not linhas:
                    break
                corpo = [{"totem_id": TOTEM_ID, **cfg["linha"](r)} for r in linhas]
                resp = requests.post(f"{SUPABASE_URL}/rest/v1/{cfg['remota']}?on_conflict={cfg['conflito']}",
                                     headers=_cabecalhos(Prefer="resolution=merge-duplicates,return=minimal"),
                                     data=json.dumps(corpo), timeout=TIMEOUT)
                if resp.status_code >= 300:
                    faltando = "PGRST205" in resp.text or resp.status_code == 404
                    _estado["tabelas_ok"] = False if faltando else _estado["tabelas_ok"]
                    raise RuntimeError(f"{cfg['remota']}: {resp.status_code} {resp.text[:200]}")
                novo = max(r[cfg["cursor"]] for r in linhas)
                with _db() as conn:
                    conn.execute("INSERT INTO nuvem_cursor (tabela, valor) VALUES (?, ?) "
                                 "ON CONFLICT(tabela) DO UPDATE SET valor=MAX(valor, excluded.valor)", (tabela, novo))
                total += len(linhas)
                _estado["enviados"][tabela] += len(linhas)
                if len(linhas) < LOTE:
                    break
            enviados[tabela] = total
        _estado.update(ultimo_envio=time.time(), erro=None, tabelas_ok=True)
        return {"ok": True, "enviados": enviados}
    except Exception as exc:
        _estado["erro"] = str(exc)[:300]
        return {"ok": False, "erro": _estado["erro"]}
    finally:
        _lock.release()


def disponivel() -> bool:
    """Supabase acessível e com as tabelas criadas (último envio deu certo)."""
    return configurado() and _estado["tabelas_ok"] is True and _estado["erro"] is None


def buscar(tabela_remota: str, filtros: dict[str, str], colunas: str = "*", ordem: str | None = None,
           limite: int = 50000) -> list[dict[str, Any]]:
    """Linhas deste totem numa tabela totem_* do Supabase (paginado de 1000 em 1000)."""
    params = {"select": colunas, "totem_id": f"eq.{TOTEM_ID}", **filtros}
    if ordem:
        params["order"] = ordem
    linhas: list[dict[str, Any]] = []
    while len(linhas) < limite:
        pagina = min(1000, limite - len(linhas))
        resp = requests.get(f"{SUPABASE_URL}/rest/v1/{tabela_remota}", params=params, timeout=TIMEOUT,
                            headers=_cabecalhos(Range=f"{len(linhas)}-{len(linhas) + pagina - 1}"))
        if resp.status_code >= 300:
            raise RuntimeError(f"{tabela_remota}: {resp.status_code} {resp.text[:200]}")
        lote = resp.json()
        linhas.extend(lote)
        if len(lote) < pagina:
            break
    return linhas


def atualizado_para_leitura() -> bool:
    """Antes de um relatório: envia o que falta e diz se dá para ler do Supabase."""
    if not configurado():
        return False
    if not _estado["ultima_tentativa"] or time.time() - _estado["ultima_tentativa"] > 3:
        sincronizar()
    return disponivel()


@bp.get("/api/nuvem/status")
def status():
    pendentes = {}
    if _db is not None:
        with _db() as conn:
            pendentes = _contar_pendentes(conn)
    return jsonify({
        "configurado": configurado(), "disponivel": disponivel(), "totem_id": TOTEM_ID,
        "tabelas_ok": _estado["tabelas_ok"], "erro": _estado["erro"],
        "ultimo_envio": _estado["ultimo_envio"], "ultima_tentativa": _estado["ultima_tentativa"],
        "enviados_desde_inicio": _estado["enviados"], "pendentes": pendentes,
        "tabelas": {t: c["remota"] for t, c in TABELAS.items()}, "intervalo_s": INTERVALO_S,
    })


@bp.post("/api/nuvem/sincronizar")
def sincronizar_agora():
    r = sincronizar()
    return jsonify(r), 200 if r["ok"] else 502
