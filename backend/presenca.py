"""Acionamento do totem por aproximação (câmera).

A câmera do totem já mede a audiência (visao.py). Aqui ficam as regras de
presença que o totem aplica sozinho (presenca.js):
  - acordar do modo anúncio quando alguém chega perto (e olha) por alguns segundos;
  - voltar ao modo anúncio quando ninguém está na frente e ninguém toca a tela.

Rotas (Blueprint registrado no app.py):
  GET  /api/presenca/config      regras atuais (o totem consulta a cada 10 s)
  POST /api/presenca/config      salva as regras (painel admin)
  POST /api/presenca/estado      batida do totem: câmera, modo, pessoas, distância
  POST /api/presenca/eventos     totem acordou / voltou ao modo anúncio
  GET  /api/presenca/status      estado ao vivo + resumo do dia + últimos eventos
"""
from __future__ import annotations

import json
import time
from collections import Counter
from typing import Any, Callable

from flask import Blueprint, jsonify, request

bp = Blueprint("presenca", __name__)

_db: Callable[[], Any] | None = None

PADRAO = {
    "camera": True,          # câmera do totem ligada (audiência + presença)
    "ativo": True,           # acordar o totem quando alguém se aproxima
    "distancia_cm": 120,     # distância máxima (aproximada) para acordar
    "exigir_olhar": True,    # só acorda se a pessoa estiver olhando para a tela
    "delay_s": 1.5,          # tempo de presença antes de acordar
    "ausencia_s": 60,        # sem ninguém e sem toque por N s -> modo anúncio (0 = nunca)
}
LIMITES = {"distancia_cm": (40, 300), "delay_s": (0.5, 15), "ausencia_s": (0, 600)}
TIPOS = {"acordou", "ausencia"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS presenca_config (
    tenant_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    atualizado REAL
);
CREATE TABLE IF NOT EXISTS presenca_eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    tipo TEXT NOT NULL,                  -- acordou | ausencia
    distancia_cm INTEGER,                -- pessoa mais próxima no momento (aprox.)
    detalhe TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_presenca_ts ON presenca_eventos (ts);
"""

# última batida do totem (memória: é estado ao vivo, não histórico)
_estado: dict[str, Any] = {}


def configurar(db: Callable[[], Any]) -> None:
    global _db
    _db = db
    with _db() as conn:
        conn.executescript(SCHEMA)


def _validar(dados: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    cfg = dict(base)
    for chave, padrao in PADRAO.items():
        if chave not in dados:
            continue
        valor = dados[chave]
        if isinstance(padrao, bool):
            cfg[chave] = bool(valor)
            continue
        try:
            valor = float(valor)
        except (TypeError, ValueError):
            continue
        minimo, maximo = LIMITES[chave]
        valor = min(max(valor, minimo), maximo)
        cfg[chave] = int(valor) if isinstance(padrao, int) else round(valor, 1)
    return cfg


def ler_config() -> dict[str, Any]:
    with _db() as conn:
        row = conn.execute("SELECT payload FROM presenca_config WHERE tenant_id='default'").fetchone()
    try:
        salvo = json.loads(row["payload"]) if row else {}
    except (TypeError, ValueError):
        salvo = {}
    return _validar(salvo, PADRAO)


@bp.get("/api/presenca/config")
def config_get():
    return jsonify(ler_config())


@bp.post("/api/presenca/config")
def config_salvar():
    cfg = _validar(request.get_json(force=True, silent=True) or {}, ler_config())
    with _db() as conn:
        conn.execute(
            "INSERT INTO presenca_config (tenant_id, payload, atualizado) VALUES ('default',?,?) "
            "ON CONFLICT(tenant_id) DO UPDATE SET payload=excluded.payload, atualizado=excluded.atualizado",
            (json.dumps(cfg), time.time()),
        )
    return jsonify(cfg)


@bp.post("/api/presenca/estado")
def estado():
    p = request.get_json(force=True, silent=True) or {}
    _estado.update({
        "ts": time.time(),
        "camera": bool(p.get("camera")),
        "standby": bool(p.get("standby")),
        "pessoas": int(p.get("pessoas") or 0),
        "distancia_cm": p.get("distancia_cm"),
        "motivo": str(p.get("motivo") or "")[:60],
    })
    return jsonify({"ok": True})


@bp.post("/api/presenca/eventos")
def evento():
    p = request.get_json(force=True, silent=True) or {}
    tipo = p.get("tipo")
    if tipo not in TIPOS:
        return jsonify({"error": "tipo_invalido"}), 400
    dist = p.get("distancia_cm")
    with _db() as conn:
        conn.execute("INSERT INTO presenca_eventos (ts, tipo, distancia_cm, detalhe) VALUES (?,?,?,?)",
                     (time.time(), tipo, int(dist) if isinstance(dist, (int, float)) else None,
                      json.dumps(p.get("detalhe") or {})[:500]))
    return jsonify({"ok": True})


@bp.get("/api/presenca/status")
def status():
    agora = time.time()
    hoje = time.mktime(time.localtime(agora)[:3] + (0, 0, 0, 0, 0, -1))
    with _db() as conn:
        eventos = conn.execute(
            "SELECT ts, tipo, distancia_cm, detalhe FROM presenca_eventos ORDER BY ts DESC LIMIT 40").fetchall()
        hoje_ev = conn.execute(
            """SELECT tipo, CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) AS hora
               FROM presenca_eventos WHERE ts>=?""", (hoje,)).fetchall()
        passaram = conn.execute("SELECT COUNT(*) AS n FROM audiencia WHERE inicio>=?", (hoje,)).fetchone()["n"]
    por_tipo = Counter(r["tipo"] for r in hoje_ev)
    acordou_hora = Counter(r["hora"] for r in hoje_ev if r["tipo"] == "acordou")
    online = bool(_estado) and agora - _estado.get("ts", 0) < 15
    return jsonify({
        "config": ler_config(),
        "totem": {**_estado, "online": online, "visto_ha_s": round(agora - _estado["ts"]) if _estado else None},
        "hoje": {"acordou": por_tipo.get("acordou", 0), "ausencia": por_tipo.get("ausencia", 0), "passaram": passaram},
        "acordou_por_hora": [{"hora": h, "n": acordou_hora.get(h, 0)} for h in range(24)],
        "eventos": [{"ts": r["ts"], "tipo": r["tipo"], "distancia_cm": r["distancia_cm"],
                     "detalhe": json.loads(r["detalhe"] or "{}")} for r in eventos],
    })
