from __future__ import annotations

import json
import re
import os
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, Response, abort, jsonify, redirect, request, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import supabase_products as sb  # noqa: E402 (precisa do .env já carregado)
import assistente  # noqa: E402 (carrega o Whisper em segundo plano)
import metricas  # noqa: E402
import presenca  # noqa: E402
import nuvem  # noqa: E402
import vitrine  # noqa: E402
import loja  # noqa: E402
import comportamento  # noqa: E402
import taxonomia  # noqa: E402
import marketing  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("FLEXMED_DB", BASE_DIR / "data" / "flexmed.sqlite3"))
UPLOAD_DIR = BASE_DIR / "uploads" / "campanhas"
FRONTEND_DIR = BASE_DIR.parent / "frontend"
# Certificado para HTTPS (o Android só libera a câmera do navegador em HTTPS)
CERT_FILE = Path(os.getenv("FLEXMED_CERT", BASE_DIR / "certs" / "flexmed.crt"))
KEY_FILE = Path(os.getenv("FLEXMED_KEY", BASE_DIR / "certs" / "flexmed.key"))
CAMERA_INDEX = int(os.getenv("FLEXMED_CAMERA_INDEX", "0"))
HOST = os.getenv("FLEXMED_HOST", "127.0.0.1")
PORT = int(os.getenv("FLEXMED_PORT", "5050"))

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, expose_headers=["X-Total-Count"])
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def json_loads(value: str | None, fallback: Any = None) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                tipo TEXT DEFAULT '',
                categoria TEXT DEFAULT '',
                uso TEXT DEFAULT '',
                indicacoes TEXT DEFAULT '[]',
                receita INTEGER DEFAULT 0,
                estoque INTEGER DEFAULT 0,
                estoqueMax INTEGER DEFAULT 0,
                local TEXT DEFAULT '',
                locaisDisponiveis TEXT DEFAULT '[]',
                info TEXT DEFAULT '',
                dicaIA TEXT DEFAULT '',
                preco TEXT DEFAULT '',
                imgUrl TEXT DEFAULT '',
                imgIndex INTEGER DEFAULT NULL,
                active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS config (
                tenant_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS metrics (
                tenant_id TEXT PRIMARY KEY,
                views INTEGER DEFAULT 0,
                libras INTEGER DEFAULT 0,
                rating_sum REAL DEFAULT 0,
                rating_count INTEGER DEFAULT 0,
                score REAL DEFAULT 0,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT DEFAULT 'default',
                name TEXT NOT NULL,
                type TEXT DEFAULT 'image',
                media_urls TEXT DEFAULT '[]',
                priority INTEGER DEFAULT 0,
                duration_seconds INTEGER DEFAULT 10,
                start_date TEXT DEFAULT NULL,
                end_date TEXT DEFAULT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS campaign_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT DEFAULT 'default',
                campaign_id INTEGER,
                event_type TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS vision_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT DEFAULT 'default',
                campaign_id INTEGER,
                metric_type TEXT NOT NULL,
                value TEXT DEFAULT '{}',
                recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS touch_heatmap (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT DEFAULT 'default',
                campaign_id INTEGER,
                x_pct REAL NOT NULL,
                y_pct REAL NOT NULL,
                recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        count = conn.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"]
        if count == 0:
            seed_path = BASE_DIR / "data" / "seed_products.json"
            products = json.loads(seed_path.read_text(encoding="utf-8"))
            for p in products:
                insert_product(conn, p)
        conn.execute(
            "INSERT OR IGNORE INTO metrics (tenant_id, views, libras, score) VALUES ('default', 0, 0, 0)"
        )


def row_to_product(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["indicacoes"] = json_loads(d.get("indicacoes"), [])
    d["locaisDisponiveis"] = json_loads(d.get("locaisDisponiveis"), [])
    d["receita"] = bool(d.get("receita"))
    d["active"] = bool(d.get("active", 1))
    return d


def normalize_product_payload(payload: dict[str, Any]) -> dict[str, Any]:
    # Accept both totem schema and admin schema.
    nome = payload.get("nome") or payload.get("name") or "Produto sem nome"
    categoria = payload.get("categoria") or payload.get("cat") or "outros"
    local = payload.get("local") or ""
    return {
        "nome": nome,
        "tipo": payload.get("tipo") or payload.get("cat") or categoria,
        "categoria": categoria,
        "uso": payload.get("uso") or payload.get("use") or "",
        "indicacoes": payload.get("indicacoes") or [],
        "receita": 1 if bool(payload.get("receita", payload.get("rx", False))) else 0,
        "estoque": int(payload.get("estoque", payload.get("stock", 0)) or 0),
        "estoqueMax": int(payload.get("estoqueMax", payload.get("stockMax", payload.get("stock", 0))) or 0),
        "local": local,
        "locaisDisponiveis": payload.get("locaisDisponiveis") or ([local] if local else []),
        "info": payload.get("info") or "",
        "dicaIA": payload.get("dicaIA") or "",
        "preco": payload.get("preco") or payload.get("price") or "",
        "imgUrl": payload.get("imgUrl") or "",
        "imgIndex": payload.get("imgIndex"),
        "active": 1 if payload.get("active", True) else 0,
    }


def insert_product(conn: sqlite3.Connection, payload: dict[str, Any]) -> int:
    p = normalize_product_payload(payload)
    cur = conn.execute(
        """
        INSERT INTO products
        (nome,tipo,categoria,uso,indicacoes,receita,estoque,estoqueMax,local,locaisDisponiveis,info,dicaIA,preco,imgUrl,imgIndex,active,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            p["nome"], p["tipo"], p["categoria"], p["uso"], json_dumps(p["indicacoes"]),
            p["receita"], p["estoque"], p["estoqueMax"], p["local"], json_dumps(p["locaisDisponiveis"]),
            p["info"], p["dicaIA"], p["preco"], p["imgUrl"], p["imgIndex"], p["active"], now_iso()
        ),
    )
    return int(cur.lastrowid)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "flexmed-backend", "camera_mode": camera.mode,
                    "assistente": assistente.status()})


# ─────────────────────────────────────────────────────────────────────────────
# Products
# ─────────────────────────────────────────────────────────────────────────────
# Catálogo do Supabase em cache por 60 s: cada página custava 0,4–0,8 s de internet (pelo
# hotspot). O estoque (SQLite local) é mesclado sempre na hora; qualquer alteração pela API
# (POST/PUT/PATCH/DELETE) limpa o cache (limpar_cache_catalogo, no after_request).
CATALOGO_CACHE_S = 60
_cache_catalogo: dict[tuple, tuple[float, list[dict[str, Any]], int]] = {}


def listar_catalogo(q, categoria, only_active, limit, offset, excluir_ids):
    chave = (q, categoria, only_active, limit, offset, tuple(sorted(excluir_ids or [])))
    guardado = _cache_catalogo.get(chave)
    if guardado and time.time() - guardado[0] < CATALOGO_CACHE_S:
        items, total = guardado[1], guardado[2]
    else:
        items, total = sb.listar(q, categoria, only_active, limit, offset, excluir_ids=excluir_ids)
        if len(_cache_catalogo) > 300:
            _cache_catalogo.clear()
        _cache_catalogo[chave] = (time.time(), items, total)
    return [dict(p) for p in items], total       # cópias: a mescla do estoque não altera o cache


@app.after_request
def limpar_cache_catalogo(resp):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.path.startswith("/api/"):
        _cache_catalogo.clear()
    return resp


@app.get("/api/products")
def api_products_list():
    q = (request.args.get("q") or request.args.get("search") or "").strip().lower()
    categoria = (request.args.get("categoria") or "").strip().lower()
    nicho = (request.args.get("nicho") or "").strip().lower()
    if nicho and not categoria:   # nicho = todas as categorias dele
        categoria = ",".join(taxonomia.categorias_do_nicho(nicho))
    only_active = request.args.get("active", "true").lower() != "false"
    # Paginação opcional (?limit=&offset=); o total vai no header X-Total-Count
    limit = request.args.get("limit", type=int)
    offset = max(request.args.get("offset", 0, type=int), 0)
    if limit is not None:
        limit = min(max(limit, 1), 100)
    if sb.configurado():
        # esgotados escondidos no totem (config da loja) e saldo disponível/selos do estoque local
        items, total = listar_catalogo(q, categoria, only_active, limit, offset, loja.ids_ocultos())
        return jsonify(loja.mesclar_no_catalogo(items)), 200, {"X-Total-Count": str(total)}
    sql = "SELECT * FROM products WHERE 1=1"
    params: list[Any] = []
    if only_active:
        sql += " AND active=1"
    if categoria:
        sql += " AND lower(categoria)=?"
        params.append(categoria)
    if q:
        sql += " AND (lower(nome) LIKE ? OR lower(uso) LIKE ? OR lower(categoria) LIKE ? OR lower(tipo) LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like, like])
    sql += " ORDER BY nome ASC"
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    items = [row_to_product(r) for r in rows]
    page = items[offset:offset + limit] if limit is not None else items
    return jsonify(page), 200, {"X-Total-Count": str(len(items))}


# ─────────────────────────────────────────────────────────────────────────────
# Assistente por voz: áudio do totem -> texto (Whisper) -> busca no catálogo
# ─────────────────────────────────────────────────────────────────────────────
TIPOS_AUDIO = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".mp4", "audio/mpeg": ".mp3",
               "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/aiff": ".aiff"}


@app.post("/api/assistente/voz")
def api_assistente_voz():
    if not sb.configurado():
        return jsonify({"error": "supabase_not_configured"}), 503
    audio = request.get_data()
    if not audio:
        return jsonify({"error": "missing_audio"}), 400
    if len(audio) > 5 * 1024 * 1024:
        return jsonify({"error": "audio_too_large"}), 413
    tipo = (request.mimetype or "").split(";")[0]
    try:
        texto = assistente.transcrever(audio, TIPOS_AUDIO.get(tipo, ".webm"))
    except RuntimeError as exc:
        return jsonify({"error": "transcription_unavailable", "detail": str(exc)}), 503
    return jsonify(assistente.atender(texto, sb.listar))


@app.post("/api/assistente/parcial")
def api_assistente_parcial():
    """Transcrição rápida do áudio gravado até agora (texto aparecendo enquanto fala)."""
    audio = request.get_data()
    if not audio or len(audio) > 5 * 1024 * 1024:
        return jsonify({"texto": None})
    tipo = (request.mimetype or "").split(";")[0]
    return jsonify({"texto": assistente.transcrever_parcial(audio, TIPOS_AUDIO.get(tipo, ".webm"))})


@app.post("/api/assistente/texto")
def api_assistente_texto():
    if not sb.configurado():
        return jsonify({"error": "supabase_not_configured"}), 503
    texto = ((request.get_json(silent=True) or {}).get("texto") or "").strip()[:300]
    return jsonify(assistente.atender(texto, sb.listar))


@app.get("/api/categorias")
def api_categorias():
    if sb.configurado():
        # subcategorias do Supabase com nicho, ícone, ordem e ativo definidos no admin (taxonomia.py)
        return jsonify(taxonomia.enriquecer(sb.listar_categorias(somente_com_produtos=True)))
    with db() as conn:
        rows = conn.execute("SELECT DISTINCT categoria FROM products WHERE active=1 ORDER BY categoria").fetchall()
    return jsonify([{"slug": r["categoria"], "nome": r["categoria"]} for r in rows])


@app.get("/api/products/<pid>/recomendacoes")
def api_products_recomendacoes(pid: str):
    """"Leve junto" e "parecidos" para a página do produto."""
    if not sb.configurado():
        return jsonify({"levar_junto": [], "parecidos": []})
    produto = sb.buscar_por("id", pid)
    if produto is None:
        return jsonify({"error": "product_not_found"}), 404
    from recomendacoes import recomendar
    return jsonify(recomendar(sb._para_api(produto), sb.listar))


@app.post("/api/products")
def api_products_create():
    payload = request.get_json(force=True, silent=True) or {}
    if sb.configurado():
        return jsonify(sb.criar(payload)), 201
    with db() as conn:
        pid = insert_product(conn, payload)
        row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    return jsonify(row_to_product(row)), 201


@app.patch("/api/products/<pid>")
@app.put("/api/products/<pid>")
def api_products_update(pid: str):
    payload = request.get_json(force=True, silent=True) or {}
    if sb.configurado():
        product = sb.atualizar(pid, payload)
        if product is None:
            return jsonify({"error": "product_not_found"}), 404
        return jsonify(product)
    p = normalize_product_payload(payload)
    with db() as conn:
        conn.execute(
            """
            UPDATE products SET nome=?, tipo=?, categoria=?, uso=?, indicacoes=?, receita=?, estoque=?, estoqueMax=?,
                local=?, locaisDisponiveis=?, info=?, dicaIA=?, preco=?, imgUrl=?, imgIndex=?, active=?, updated_at=?
            WHERE id=?
            """,
            (
                p["nome"], p["tipo"], p["categoria"], p["uso"], json_dumps(p["indicacoes"]), p["receita"],
                p["estoque"], p["estoqueMax"], p["local"], json_dumps(p["locaisDisponiveis"]), p["info"],
                p["dicaIA"], p["preco"], p["imgUrl"], p["imgIndex"], p["active"], now_iso(), pid,
            ),
        )
        row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if row is None:
        return jsonify({"error": "product_not_found"}), 404
    return jsonify(row_to_product(row))


@app.delete("/api/products/<pid>")
def api_products_delete(pid: str):
    if sb.configurado():
        sb.remover(pid)
        return jsonify({"ok": True})
    with db() as conn:
        conn.execute("DELETE FROM products WHERE id=?", (pid,))
    return jsonify({"ok": True})


@app.post("/api/products/image")
def api_products_image():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "missing_file"}), 400
    if not (file.mimetype or "").startswith("image/"):
        return jsonify({"error": "not_an_image"}), 400
    if not sb.configurado():
        return jsonify({"error": "supabase_not_configured"}), 503
    url = sb.enviar_imagem(file.read(), secure_filename(file.filename or "imagem.png"), file.mimetype)
    return jsonify({"url": url})


@app.errorhandler(sb.SupabaseError)
def supabase_error(exc: sb.SupabaseError):
    app.logger.error("Supabase: %s", exc)
    return jsonify({"error": "supabase_error", "detail": str(exc)}), 502


# ─────────────────────────────────────────────────────────────────────────────
# Config / metrics
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/config")
def api_config_get():
    tenant_id = request.args.get("tenant_id", "default")
    with db() as conn:
        row = conn.execute("SELECT payload FROM config WHERE tenant_id=?", (tenant_id,)).fetchone()
    return jsonify(json_loads(row["payload"], {}) if row else {})


@app.post("/api/config")
def api_config_save():
    payload = request.get_json(force=True, silent=True) or {}
    tenant_id = payload.pop("tenant_id", payload.pop("tenantId", "default"))
    with db() as conn:
        conn.execute(
            "INSERT INTO config (tenant_id, payload, updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
            (tenant_id, json_dumps(payload), now_iso()),
        )
    return jsonify({"ok": True, **payload})


@app.get("/api/metrics")
def api_metrics_get():
    tenant_id = request.args.get("tenant_id", "default")
    with db() as conn:
        row = conn.execute("SELECT * FROM metrics WHERE tenant_id=?", (tenant_id,)).fetchone()
    if not row:
        return jsonify({"views": 0, "libras": 0, "score": 0})
    d = dict(row)
    return jsonify({"views": d["views"], "libras": d["libras"], "score": d["score"]})


@app.post("/api/metrics/event")
def api_track_event():
    payload = request.get_json(force=True, silent=True) or {}
    typ = payload.get("type")
    tenant_id = payload.get("tenant_id", "default")
    if typ not in {"views", "view", "libras"}:
        return jsonify({"error": "invalid_event_type"}), 400
    field = "views" if typ in {"views", "view"} else "libras"
    with db() as conn:
        conn.execute("INSERT OR IGNORE INTO metrics (tenant_id) VALUES (?)", (tenant_id,))
        conn.execute(f"UPDATE metrics SET {field}={field}+1, updated_at=? WHERE tenant_id=?", (now_iso(), tenant_id))
    return jsonify({"ok": True})


@app.post("/api/metrics/rating")
def api_rating():
    payload = request.get_json(force=True, silent=True) or {}
    tenant_id = payload.get("tenant_id", "default")
    score = float(payload.get("score", payload.get("rating", 0)) or 0)
    if not (1 <= score <= 5):
        return jsonify({"error": "invalid_rating"}), 400
    with db() as conn:
        conn.execute("INSERT OR IGNORE INTO metrics (tenant_id) VALUES (?)", (tenant_id,))
        conn.execute(
            """
            UPDATE metrics
               SET rating_sum=rating_sum+?, rating_count=rating_count+1,
                   score=(rating_sum+?) / (rating_count+1), updated_at=?
             WHERE tenant_id=?
            """,
            (score, score, now_iso(), tenant_id),
        )
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────────────────────
# Campaigns and analytics
# ─────────────────────────────────────────────────────────────────────────────
def campaign_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    # Mídias enviadas são gravadas com o host de quem fez o upload (ex.: localhost
    # no notebook); reescreve para o host de quem está pedindo (ex.: IP no totem).
    host = request.host_url.rstrip("/")
    d["media_urls"] = [
        re.sub(r"^https?://[^/]+(?=/uploads/campanhas/)", host, u) if isinstance(u, str) else u
        for u in json_loads(d.get("media_urls"), [])
    ]
    d["is_active"] = bool(d.get("is_active"))
    d["faixas"] = json_loads(d.get("faixas"), [])   # público-alvo; [] = todos
    d["na_vitrine"] = bool(d.get("na_vitrine", 1))   # também entre as linhas de produtos
    return d


@app.get("/api/campaigns")
def api_campaigns_list():
    tenant_id = request.args.get("tenant_id", "default")
    active = request.args.get("active")
    sql = "SELECT * FROM campaigns WHERE tenant_id=?"
    params: list[Any] = [tenant_id]
    if active is not None:
        sql += " AND is_active=?"
        params.append(1 if active.lower() == "true" else 0)
    sql += " ORDER BY priority DESC, created_at ASC"
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return jsonify([campaign_row(r) for r in rows])


@app.post("/api/campaigns")
def api_campaigns_create():
    p = request.get_json(force=True, silent=True) or {}
    with db() as conn:
        cur = conn.execute(
            """
            INSERT INTO campaigns (tenant_id,name,type,media_urls,priority,duration_seconds,start_date,end_date,is_active,faixas,na_vitrine,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                p.get("tenant_id", "default"), p.get("name") or "Campanha", p.get("type", "image"),
                json_dumps(p.get("media_urls") or []), int(p.get("priority") or 0), int(p.get("duration_seconds") or 10),
                p.get("start_date") or None, p.get("end_date") or None, 1 if p.get("is_active", True) else 0,
                json_dumps(metricas.faixas_validas(p.get("faixas"))), 1 if p.get("na_vitrine", True) else 0, now_iso(),
            ),
        )
        row = conn.execute("SELECT * FROM campaigns WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(campaign_row(row)), 201


@app.patch("/api/campaigns/<int:cid>")
def api_campaigns_update(cid: int):
    p = request.get_json(force=True, silent=True) or {}
    current = None
    with db() as conn:
        current = conn.execute("SELECT * FROM campaigns WHERE id=?", (cid,)).fetchone()
        if not current:
            return jsonify({"error": "campaign_not_found"}), 404
        c = campaign_row(current)
        c.update(p)
        conn.execute(
            """
            UPDATE campaigns SET name=?, type=?, media_urls=?, priority=?, duration_seconds=?, start_date=?, end_date=?, is_active=?, faixas=?, na_vitrine=?, updated_at=?
            WHERE id=?
            """,
            (
                c.get("name") or "Campanha", c.get("type", "image"), json_dumps(c.get("media_urls") or []),
                int(c.get("priority") or 0), int(c.get("duration_seconds") or 10), c.get("start_date") or None,
                c.get("end_date") or None, 1 if c.get("is_active", True) else 0,
                json_dumps(metricas.faixas_validas(c.get("faixas"))), 1 if c.get("na_vitrine", True) else 0, now_iso(), cid,
            ),
        )
        row = conn.execute("SELECT * FROM campaigns WHERE id=?", (cid,)).fetchone()
    return jsonify(campaign_row(row))


@app.delete("/api/campaigns/<int:cid>")
def api_campaigns_delete(cid: int):
    with db() as conn:
        conn.execute("DELETE FROM campaigns WHERE id=?", (cid,))
    return jsonify({"ok": True})


@app.post("/api/campaign_analytics")
def api_campaign_event():
    p = request.get_json(force=True, silent=True) or {}
    with db() as conn:
        conn.execute(
            "INSERT INTO campaign_analytics (tenant_id,campaign_id,event_type,created_at) VALUES (?,?,?,?)",
            (p.get("tenant_id", "default"), p.get("campaign_id"), p.get("event_type"), now_iso()),
        )
    return jsonify({"ok": True})


@app.get("/api/campaign_analytics")
def api_campaign_analytics():
    tenant_id = request.args.get("tenant_id", "default")
    with db() as conn:
        rows = conn.execute(
            "SELECT campaign_id,event_type,created_at FROM campaign_analytics WHERE tenant_id=? ORDER BY created_at DESC LIMIT 2000",
            (tenant_id,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/vision_metrics")
def api_vision_metric():
    p = request.get_json(force=True, silent=True) or {}
    with db() as conn:
        conn.execute(
            "INSERT INTO vision_metrics (tenant_id,campaign_id,metric_type,value,recorded_at) VALUES (?,?,?,?,?)",
            (p.get("tenant_id", "default"), p.get("campaign_id"), p.get("metric_type"), json_dumps(p.get("value") or {}), now_iso()),
        )
    return jsonify({"ok": True})


@app.get("/api/vision_metrics")
def api_vision_metrics():
    tenant_id = request.args.get("tenant_id", "default")
    limit = int(request.args.get("limit", 2000))
    with db() as conn:
        rows = conn.execute(
            "SELECT campaign_id,metric_type,value,recorded_at FROM vision_metrics WHERE tenant_id=? ORDER BY recorded_at DESC LIMIT ?",
            (tenant_id, limit),
        ).fetchall()
    data = []
    for r in rows:
        d = dict(r)
        d["value"] = json_loads(d.get("value"), {})
        data.append(d)
    return jsonify(data)


@app.post("/api/touch_heatmap")
def api_touch_heatmap_post():
    p = request.get_json(force=True, silent=True) or {}
    with db() as conn:
        conn.execute(
            "INSERT INTO touch_heatmap (tenant_id,campaign_id,x_pct,y_pct,recorded_at) VALUES (?,?,?,?,?)",
            (p.get("tenant_id", "default"), p.get("campaign_id"), float(p.get("x_pct", 0)), float(p.get("y_pct", 0)), now_iso()),
        )
    return jsonify({"ok": True})


@app.get("/api/touch_heatmap")
def api_touch_heatmap_get():
    tenant_id = request.args.get("tenant_id", "default")
    with db() as conn:
        rows = conn.execute(
            "SELECT x_pct,y_pct,campaign_id,recorded_at FROM touch_heatmap WHERE tenant_id=? ORDER BY recorded_at DESC LIMIT 5000",
            (tenant_id,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/upload")
def api_upload():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "missing_file"}), 400
    filename = secure_filename(file.filename or "upload.bin")
    suffix = Path(filename).suffix.lower()
    safe = f"{int(time.time())}_{os.urandom(4).hex()}{suffix}"
    dest = UPLOAD_DIR / safe
    file.save(dest)
    public_url = request.host_url.rstrip("/") + f"/uploads/campanhas/{safe}"
    return jsonify({"url": public_url})


@app.get("/uploads/campanhas/<path:filename>")
def uploaded_campaign(filename: str):
    return send_from_directory(UPLOAD_DIR, filename)


# ─────────────────────────────────────────────────────────────────────────────
# Camera broker: garante câmera exclusiva entre standby vision e Libras.
# ─────────────────────────────────────────────────────────────────────────────
# Vídeo do Libras (câmera do notebook) enviado ao totem: reduzido para caber na rede do
# totem; o reconhecimento usa o quadro inteiro, na taxa da câmera.
LIBRAS_VIDEO_LARGURA = 640
LIBRAS_VIDEO_QUALIDADE = 60      # JPEG: ~20 KB por quadro (mais quadros por segundo na mesma rede)
# Buffer de envio da conexão do vídeo: pequeno (~3 quadros) para não acumular imagens velhas
# na rede. Com o buffer padrão (que cresce a megabytes), a rede lenta do totem enchia uma fila
# e o vídeo chegava segundos atrasado; assim o envio espera e pula para o quadro mais novo.
LIBRAS_VIDEO_BUFFER = 64 * 1024
# Sem ninguém pedindo quadros por este tempo (totem fechou sem avisar), a câmera desliga
LIBRAS_SEM_CLIENTE_S = 15
# Com a câmera sempre ligada: sem ninguém vendo por este tempo, o laço só mantém a câmera
# acordada (não reconhece nem codifica), para não ocupar o processador à toa
LIBRAS_OCIOSO_S = 5


class CameraBroker:
    def __init__(self, camera_index: int):
        self.camera_index = camera_index
        self.mode = "idle"  # idle | vision | libras
        self.lock = threading.RLock()
        self.cap = None
        self.last_status = {"active": False, "face_count": 0, "looking": False, "age_group": None, "gender": None}
        self.frase = ""
        self.ultima_letra = ""
        self.last_prediction_ts = 0.0
        self._cv2 = None
        self._mp_face_detection = None
        self._face_detector = None
        self._libras_notice = "Modelos não carregados"
        self._load_cv()
        self.sessao_video = 0            # vídeo do Libras atual (ver frames())
        # Libras com a câmera do notebook: a thread _laco_libras reconhece em velocidade
        # total e deixa aqui o último quadro (JPEG reduzido) para o vídeo do totem
        self._libras_jpeg = b""
        self._libras_capturado = 0       # instante (ms) em que o quadro atual saiu da câmera
        self._libras_seq = 0
        self._libras_novo = threading.Condition()
        self._libras_laco = None
        self._libras_pedido = 0.0        # último pedido de quadro (totem) ou quadro enviado (MJPEG)
        self.sempre_ligada = False       # câmera do notebook sempre ligada no Libras (manter_libras_ligada)
        self.libras_diag = {"quadros_por_segundo": 0.0, "ms_por_quadro": 0.0}
        # /status com espera: a versão sobe quando a letra ou a frase mudam, e quem está
        # esperando (o totem) recebe a novidade na hora, sem ficar consultando
        self.status_versao = 0
        self._status_mudou = threading.Condition()
        self.motor = None                # motor de visão (audiência anônima, idade estimada)
        try:
            from visao import MotorVisao
            self.motor = MotorVisao(ao_sair=metricas.registrar_passagem)
        except Exception as exc:
            print(f"[Visão] motor indisponível: {exc}", flush=True)
        self.modo_remoto = None          # vision | libras (frames vindos do navegador)
        self.ultimo_capturado_em = 0      # instante de captura (ms) do último frame processado
        self.ultima_resposta_remota: dict[str, Any] = {}
        self.ultimo_frame_remoto = 0.0
        self.reconhecedor = None
        try:
            sys.path.insert(0, str(BASE_DIR / "libras"))
            from reconhecedor import ReconhecedorLibras  # type: ignore
            self.reconhecedor = ReconhecedorLibras()
        except Exception as exc:
            self._libras_notice = f"LibrasFlow indisponivel: {exc}"

    def _load_cv(self) -> None:
        try:
            import cv2  # type: ignore
            self._cv2 = cv2
        except Exception:
            self._cv2 = None
        try:
            import mediapipe as mp  # type: ignore
            self._mp_face_detection = mp.solutions.face_detection
            self._face_detector = self._mp_face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5)
        except Exception:
            self._mp_face_detection = None
            self._face_detector = None

    def _ensure_camera(self) -> bool:
        if self._cv2 is None:
            return False
        if self.cap is not None and self.cap.isOpened():
            return True
        self.cap = self._cv2.VideoCapture(self.camera_index)
        if self.cap.isOpened():
            self.cap.set(self._cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.cap.set(self._cv2.CAP_PROP_FRAME_HEIGHT, 720)
            return True
        return False

    def _release_camera(self) -> None:
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
        self.cap = None

    def set_mode(self, mode: str) -> tuple[bool, str]:
        with self.lock:
            if mode not in {"idle", "vision", "libras"}:
                return False, "invalid_mode"
            if mode == "vision" and self.mode == "libras":
                return False, "camera_in_use_by_libras"
            if mode == "libras" and self.mode == "vision":
                self._release_camera()
            if mode == "idle":
                self._release_camera()
            self.mode = mode
            if mode in {"vision", "libras"} and not self._ensure_camera():
                self.mode = "idle"
                return False, "camera_unavailable"
            return True, "ok"

    def avisar_status(self) -> None:
        with self._status_mudou:
            self.status_versao += 1
            self._status_mudou.notify_all()

    def esperar_status(self, versao: int, segundos: float) -> None:
        with self._status_mudou:
            if self.status_versao == versao:
                self._status_mudou.wait(timeout=segundos)

    def stop_if(self, mode: str) -> None:
        with self.lock:
            if self.mode == mode:
                self.mode = "idle"
                self._release_camera()
                if mode == "libras":
                    self.ultima_letra = ""
                    if self.reconhecedor is not None:
                        self.reconhecedor.fechar()
                    self.avisar_status()

    def read_frame(self):
        if not self._ensure_camera():
            return None
        ok, frame = self.cap.read()
        if not ok:
            return None
        try:
            frame = self._cv2.flip(frame, 1)
        except Exception:
            pass
        return frame

    def vision_status(self) -> dict[str, Any]:
        with self.lock:
            if self.mode != "vision":
                # câmera do totem (navegador) mandando frames de visão: mostra o público atual
                if self.motor and self.modo_remoto == "vision" and time.time() - self.ultimo_frame_remoto < 5:
                    return {**self.motor.retrato(), "camera_mode": "totem"}
                return {"active": False, "reason": f"mode={self.mode}", "face_count": 0, "looking": False}
            frame = self.read_frame()
            if frame is None:
                return {"active": False, "reason": "camera_unavailable", "face_count": 0, "looking": False}
            return self._detectar_rostos(frame)

    def _detectar_rostos(self, frame, alvos: list[str] | None = None, contexto: str = "standby") -> dict[str, Any]:
        if self.motor is not None:
            self.last_status = {**self.motor.processar(frame, alvos, contexto=contexto), "camera_mode": self.mode}
            return self.last_status
        face_count = 0
        if self._face_detector is not None:
            rgb = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2RGB)
            result = self._face_detector.process(rgb)
            face_count = len(result.detections or [])
        self.last_status = {
            "active": True,
            "face_count": face_count,
            "looking": face_count > 0,
            "age_group": None,
            "gender": None,
            "camera_mode": self.mode,
        }
        return self.last_status

    def processar_frame_remoto(self, jpeg: bytes, modo: str, capturado_em: int | None = None,
                               alvos: list[str] | None = None, contexto: str = "standby") -> tuple[dict[str, Any], int]:
        """Frame capturado pela câmera do totem (navegador) e enviado por POST /frame."""
        import numpy as np
        with self.lock:
            # Com vários frames em voo, um pode chegar depois do seguinte: descarta
            if capturado_em is not None and modo == self.modo_remoto:
                if capturado_em <= self.ultimo_capturado_em:
                    return {**self.ultima_resposta_remota, "descartado": True}, 200
                self.ultimo_capturado_em = capturado_em
            libras_local = self.sempre_ligada and self.mode == "libras"
            if self.mode == "libras" and modo == "vision" and not libras_local:
                # Libras usando a câmera do notebook: frames de audiência que ainda
                # estavam a caminho não podem desligá-la (congelava a imagem do Libras)
                return {"active": False, "reason": "camera_em_uso_pelo_libras", "pessoas": 0, "olhando": 0}, 200
            if self.mode != "idle" and not libras_local:
                # O totem tem prioridade: libera a câmera do notebook se ela ficou ligada.
                # (Com a câmera do notebook sempre ligada só para o Libras, a audiência vem do
                # totem e segue normal, sem mexer nela.)
                self._release_camera()
                self.mode = "idle"
            frame = self._cv2.imdecode(np.frombuffer(jpeg, np.uint8), self._cv2.IMREAD_COLOR)
            if frame is None:
                return {"error": "invalid_image"}, 400
            frame = self._cv2.flip(frame, 1)  # espelhado, como na câmera local e no treino
            agora = time.time()
            # Troca de modo ou pausa longa: recomeça o reconhecimento do zero
            # (não com o Libras local ligado: o reconhecedor é dele)
            if modo != self.modo_remoto or agora - self.ultimo_frame_remoto > 3:
                if self.reconhecedor is not None and not libras_local:
                    self.reconhecedor.fechar()
                self.ultima_letra = ""
                self.modo_remoto = modo
            self.ultimo_frame_remoto = agora
            if modo == "libras":
                rec = self.reconhecedor
                # modo completo (Holistic): quadro em 4:3; modo letras: features em pixels, quadro como veio
                quadro, voltar_x = (self._quadro_4x3(frame) if rec is not None and rec.usa_quadro_4x3
                                    else (frame, lambda x: x))
                self._reconhecer(quadro, desenhar=False)   # o totem desenha com os pontos que recebe
                maos = [[[voltar_x(x), y] for x, y in mao] for mao in rec.maos] if rec else []
                pontos = {nome: [[voltar_x(p[0]), *p[1:]] for p in lista] for nome, lista in rec.pontos.items()} if rec else {}
                self.ultima_resposta_remota = {
                    "active": True,
                    "status": rec.status if rec else "indisponivel",
                    "ultima_letra": self.ultima_letra,
                    "frase": self.frase,
                    "maos": maos,
                    "pontos": pontos,  # rosto/postura/mãos para desenhar no totem
                }
                return self.ultima_resposta_remota, 200
            self.ultima_resposta_remota = self._detectar_rostos(frame, alvos, contexto)
            return self.ultima_resposta_remota, 200

    def _quadro_4x3(self, frame):
        """Câmera em pé (totem: 480x640) → quadro 4:3 deitado, com faixas pretas nas laterais.

        Só no modo completo (Holistic + modelo de palavras): os pontos desse modelo vêm em
        fração da largura e da altura, e com a imagem em pé a mão chega distorcida. Com os
        vídeos do dataset, simulando o totem: 35% de acerto sem as faixas, 85% com elas.
        Devolve o quadro e a função que leva um x do quadro 4:3 de volta ao original.
        """
        h, w = frame.shape[:2]
        largura = round(h * 4 / 3)
        if w >= largura:
            return frame, lambda x: x
        esq = (largura - w) // 2
        quadro = self._cv2.copyMakeBorder(frame, 0, 0, esq, largura - w - esq, self._cv2.BORDER_CONSTANT, value=0)
        return quadro, lambda x: round((x * largura - esq) / w, 4)

    def _annotate_libras_frame(self, frame):
        cv2 = self._cv2
        h, w = frame.shape[:2]
        cv2.rectangle(frame, (0, 0), (w, 92), (10, 22, 40), -1)
        cv2.putText(frame, "FlexMed LibrasFlow v2", (16, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(frame, "Camera em modo LIBRAS - visao de anuncios pausada", (16, 64), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (160, 220, 255), 1)
        rec = self.reconhecedor
        if rec is None:
            aviso = self._libras_notice
        elif rec.status == "carregando":
            aviso = "Carregando modelos..."
        elif rec.status != "pronto":
            aviso = "Modelos nao treinados - rode libras/treinar.py --tudo"
        elif rec.atual:
            aviso = f"Detectado: {rec.atual} ({rec.conf_atual * 100:.0f}%)"
        else:
            aviso = "Faca o sinal em frente a camera"
        cv2.putText(frame, aviso, (16, 86), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 230, 150), 1)
        cv2.rectangle(frame, (0, h - 72), (w, h), (10, 22, 40), -1)
        cv2.putText(frame, f"Frase: {self.frase[-70:]}", (16, h - 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
        return frame

    def _reconhecer(self, frame, desenhar=True, continuo=False):
        if self.reconhecedor is None:
            return frame
        antes = (self.ultima_letra, self.frase)
        frame, token = self.reconhecedor.processar(frame, desenhar, continuo)
        self.ultima_letra = self.reconhecedor.atual
        if token:
            label, tipo = token
            if tipo == "palavra":
                sep = "" if not self.frase or self.frase.endswith(" ") else " "
                self.frase += f"{sep}{label} "
            else:
                self.frase += label
        if (self.ultima_letra, self.frase) != antes:
            self.avisar_status()
        return frame

    def frames(self, conexao=None):
        if conexao is not None:
            import socket
            try:
                conexao.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, LIBRAS_VIDEO_BUFFER)
            except OSError:
                pass
        if self.sempre_ligada and self.mode == "libras":
            self._libras_pedido = time.time()
            yield from self._frames_libras(self.sessao_video)   # junta-se ao laço que já roda
            return
        ok, reason = self.set_mode("libras")
        if not ok:
            yield self._jpeg_error(reason)
            return
        # cada vídeo do Libras é uma sessão: o vídeo antigo, ao terminar atrasado,
        # não pode desligar a câmera de um painel que já foi reaberto
        self.sessao_video += 1
        minha = self.sessao_video
        self._libras_pedido = time.time()
        try:
            yield from self._frames_libras(minha)
        finally:
            # Cliente fechou a aba/stream sem chamar /libras_stop: desliga a câmera mesmo assim
            if self.sessao_video == minha:
                self.stop_if("libras")

    def _frames_libras(self, minha: int):
        """Vídeo MJPEG para o painel de Libras: sempre o quadro mais recente, na taxa da
        câmera. O reconhecimento roda em _laco_libras, separado; se a rede até o totem não
        der conta, o envio espera (buffer pequeno, ver frames) e pula para o quadro mais novo,
        em vez de acumular imagens velhas. Cada parte leva X-Capturado (ms) para diagnóstico."""
        self._iniciar_laco_libras(minha)
        enviado = 0
        while self.mode == "libras" and self.sessao_video == minha:
            with self._libras_novo:
                if self._libras_seq == enviado:
                    self._libras_novo.wait(timeout=1.0)
                seq, data, capturado = self._libras_seq, self._libras_jpeg, self._libras_capturado
            if seq == enviado or not data:
                continue
            enviado = seq
            self._libras_pedido = time.time()
            yield (b"--frame\r\nContent-Type: image/jpeg\r\nX-Capturado: " + str(capturado).encode()
                   + b"\r\n\r\n" + data + b"\r\n")

    def manter_libras_ligada(self) -> None:
        """Câmera do notebook sempre ligada no Libras: o painel do totem abre já com imagem,
        sem esperar a câmera iniciar. Sem ninguém vendo, o laço só mantém a câmera acordada
        (não reconhece nem codifica); ao fechar o painel, só o reconhecimento é zerado."""
        self.sempre_ligada = True
        ok, motivo = self.iniciar_libras_local()
        print(f"[Libras] câmera do notebook sempre ligada: {'ok' if ok else motivo}", flush=True)

    def _zerar_libras(self) -> None:
        """Começa o reconhecimento do zero (outra pessoa no painel), sem mexer na câmera."""
        with self.lock:
            self.ultima_letra = ""
            if self.reconhecedor is not None:
                self.reconhecedor.resetar()
        self.avisar_status()

    def liberar_libras(self) -> None:
        """Painel de Libras fechado: desliga a câmera, ou, se ela fica sempre ligada, só zera."""
        if self.sempre_ligada:
            self._zerar_libras()
        else:
            self.stop_if("libras")

    def iniciar_libras_local(self) -> tuple[bool, str]:
        """Liga a câmera do notebook no modo Libras e o laço de reconhecimento, numa sessão
        nova. O totem busca os quadros em /libras/quadro (quadro_libras)."""
        with self.lock:
            laco = self._libras_laco
            if self.sempre_ligada and self.mode == "libras" and laco is not None and laco.is_alive():
                self._libras_pedido = time.time()
                self._zerar_libras()             # câmera já ligada: só começa do zero
                return True, "ok"
            ok, reason = self.set_mode("libras")
            if ok:
                self.sessao_video += 1
                self._libras_pedido = time.time()
                self._iniciar_laco_libras(self.sessao_video)
            return ok, reason

    def quadro_libras(self, depois: int, espera: float) -> tuple[int, bytes, int]:
        """O quadro mais recente com número maior que `depois` (espera até `espera` s por ele)."""
        self._libras_pedido = time.time()
        with self._libras_novo:
            velho = time.time() * 1000 - self._libras_capturado > 1000   # laço estava ocioso
            if (self._libras_seq <= depois or velho) and self.mode == "libras":
                self._libras_novo.wait(timeout=espera)
            return self._libras_seq, self._libras_jpeg, self._libras_capturado

    def _iniciar_laco_libras(self, minha: int) -> None:
        with self.lock:
            laco = self._libras_laco
            if laco is not None and laco.is_alive() and laco.sessao == minha:
                return
            # painel reaberto: a thread da sessão anterior termina sozinha na próxima volta
            laco = threading.Thread(target=self._laco_libras, args=(minha,), daemon=True)
            laco.sessao = minha
            self._libras_laco = laco
            laco.start()

    def _laco_libras(self, minha: int) -> None:
        """Lê a câmera do notebook e reconhece cada quadro (na taxa da câmera, ~30/s)."""
        anterior = time.time()
        while True:
            with self.lock:
                if self.mode != "libras" or self.sessao_video != minha:
                    break
                ocioso = time.time() - self._libras_pedido > LIBRAS_OCIOSO_S
                if ocioso and not self.sempre_ligada and time.time() - self._libras_pedido > LIBRAS_SEM_CLIENTE_S:
                    self.stop_if("libras")       # ninguém está vendo (o totem fechou sem avisar)
                    break
                frame = self.read_frame()
                capturado = int(time.time() * 1000)
                if ocioso and self.sempre_ligada:
                    frame = None if frame is None else False   # só mantém a câmera acordada
            if frame is False:
                time.sleep(0.1)
                continue
            with self.lock:
                if frame is None:
                    data = self._imagem_erro("camera_unavailable") if self._cv2 is not None else b""
                else:
                    frame = self._reconhecer(frame, continuo=True)   # quadros regulares: rastreia a mão
                    frame = self._annotate_libras_frame(frame)
                    h, w = frame.shape[:2]
                    if w > LIBRAS_VIDEO_LARGURA:   # o totem mostra o vídeo pequeno: menos bytes pela rede
                        frame = self._cv2.resize(frame, (LIBRAS_VIDEO_LARGURA, round(h * LIBRAS_VIDEO_LARGURA / w)),
                                                 interpolation=self._cv2.INTER_AREA)
                    ok, jpg = self._cv2.imencode(".jpg", frame, [int(self._cv2.IMWRITE_JPEG_QUALITY), LIBRAS_VIDEO_QUALIDADE])
                    data = jpg.tobytes() if ok else b""
            if data:
                with self._libras_novo:
                    self._libras_jpeg, self._libras_seq = data, self._libras_seq + 1
                    self._libras_capturado = capturado
                    self._libras_novo.notify_all()
            agora = time.time()
            diag = self.libras_diag
            diag["ms_por_quadro"] = round(0.9 * diag["ms_por_quadro"] + 0.1 * (agora * 1000 - capturado), 1)
            diag["quadros_por_segundo"] = round(0.9 * diag["quadros_por_segundo"] + 0.1 / max(agora - anterior, 1e-3), 1)
            anterior = agora
            if frame is None:
                time.sleep(0.2)
        with self._libras_novo:
            self._libras_jpeg = b""
            self._libras_novo.notify_all()

    def _imagem_erro(self, msg: str) -> bytes:
        """JPEG preto com a mensagem de erro (precisa do OpenCV)."""
        import numpy as np
        frame = np.zeros((360, 640, 3), dtype=np.uint8)
        self._cv2.putText(frame, f"Erro: {msg}", (30, 180), self._cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        _, jpg = self._cv2.imencode(".jpg", frame)
        return jpg.tobytes()

    def _jpeg_error(self, msg: str) -> bytes:
        if self._cv2 is None:
            return b"--frame\r\nContent-Type: text/plain\r\n\r\nOpenCV indisponivel\r\n"
        return b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + self._imagem_erro(msg) + b"\r\n"


camera = CameraBroker(CAMERA_INDEX)


@app.post("/vision_start")
def vision_start():
    ok, reason = camera.set_mode("vision")
    status = 200 if ok else 409
    return jsonify({"active": ok, "reason": reason, "camera_mode": camera.mode}), status


@app.post("/vision_stop")
def vision_stop():
    camera.stop_if("vision")
    return jsonify({"active": False, "camera_mode": camera.mode})


@app.get("/vision_status")
def vision_status():
    return jsonify(camera.vision_status())


@app.post("/libras_start")
def libras_start():
    ok, reason = camera.iniciar_libras_local()
    status = 200 if ok else 409
    return jsonify({"active": ok, "reason": reason, "camera_mode": camera.mode}), status


@app.post("/libras_stop")
def libras_stop():
    camera.liberar_libras()   # câmera sempre ligada: só zera o reconhecimento
    return jsonify({"active": False, "camera_mode": camera.mode})


@app.get("/libras/quadro")
def libras_quadro():
    """Vídeo do Libras quadro a quadro (câmera do notebook): devolve o quadro mais recente
    com número maior que ?depois=N, esperando até 2 s por ele. O totem pede um, mostra e pede
    o próximo; funciona em qualquer navegador (o MJPEG congelava no do totem) e nunca acumula
    imagem velha. 204 = câmera ainda abrindo ou Libras desligado."""
    depois = request.args.get("depois", -1, type=int)
    seq, jpeg, capturado = camera.quadro_libras(depois, espera=2.0)
    if not jpeg or seq <= depois:
        return "", 204
    resp = Response(jpeg, mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Quadro"] = str(seq)
    resp.headers["X-Capturado"] = str(capturado)
    return resp


@app.get("/video_feed")
def video_feed():
    return Response(camera.frames(request.environ.get("werkzeug.socket")),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


# Câmera do Libras quando o painel é aberto no totem (FLEXMED_LIBRAS_CAMERA no backend/.env):
#   "notebook" (padrão): a pessoa sinaliza em frente ao notebook, que reconhece em tempo real
#              e manda o vídeo ao totem. Bem mais preciso que mandar imagens pela rede.
#   "totem":   câmera do próprio totem; as imagens vão pela rede até o notebook.
LIBRAS_CAMERA = "totem" if os.getenv("FLEXMED_LIBRAS_CAMERA", "notebook").strip().lower() == "totem" else "notebook"
# Câmera do notebook sempre ligada para o Libras (o painel abre já com imagem).
# FLEXMED_LIBRAS_SEMPRE_LIGADA=0 no .env volta a ligar só quando o painel abre.
LIBRAS_SEMPRE_LIGADA = LIBRAS_CAMERA == "notebook" and os.getenv("FLEXMED_LIBRAS_SEMPRE_LIGADA", "1") != "0"


@app.get("/libras/config")
def libras_config():
    return jsonify({"camera": LIBRAS_CAMERA})


@app.get("/libras/conexoes")
def libras_conexoes():
    from reconhecedor import conexoes_para_desenho  # type: ignore
    return jsonify(conexoes_para_desenho())


@app.post("/frame")
def frame_do_navegador():
    modo = request.args.get("mode", "vision")
    if modo not in {"vision", "libras"}:
        return jsonify({"error": "invalid_mode"}), 400
    capturado_em = request.args.get("t", type=int)
    # anúncio em exibição / sessão em andamento: a audiência do frame é atribuída a eles
    anuncio, sessao = request.args.get("anuncio"), request.args.get("sessao")
    alvos = [f"anuncio:{anuncio}" if anuncio else None, f"sessao:{sessao}" if sessao else None]
    corpo, status = camera.processar_frame_remoto(request.get_data(), modo, capturado_em,
                                                  alvos=[a for a in alvos if a],
                                                  contexto="uso" if sessao else "standby")
    return jsonify(corpo), status


@app.get("/status")
def libras_status():
    # ?versao=N&espera=S: segura a resposta até a letra ou a frase mudarem (no máximo S s,
    # até 10). O totem deixa uma consulta aberta e recebe a letra assim que ela é confirmada,
    # em vez de consultar várias vezes por segundo pela rede lenta.
    versao = request.args.get("versao", type=int)
    espera = min(request.args.get("espera", 0, type=float), 10.0)
    if versao is not None and espera > 0:
        camera.esperar_status(versao, espera)
    return jsonify({
        "active": camera.mode == "libras",
        "ultima_letra": camera.ultima_letra,
        "frase": camera.frase,
        "camera_mode": camera.mode,
        "versao": camera.status_versao,
        "diagnostico": camera.libras_diag,
    })


@app.post("/clear")
def clear_phrase():
    camera.frase = ""
    camera.ultima_letra = ""
    if camera.reconhecedor is not None:
        camera.reconhecedor.ultimo_adicionado = None
    camera.avisar_status()
    return jsonify({"frase": camera.frase})


@app.post("/backspace")
def backspace_phrase():
    camera.frase = camera.frase[:-1]
    camera.avisar_status()
    return jsonify({"frase": camera.frase})


# ─────────────────────────────────────────────────────────────────────────────
# Frontend (totem e admin) servido pelo próprio backend: um único endereço/HTTPS
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/")
def frontend_index():
    return redirect("/index.html")


# ─────────────────────────────────────────────────────────────────────────────
# Fotos dos produtos pelo notebook: /foto/<caminho no Storage>?w=480
# O totem baixava cada foto do Supabase pela internet do hotspot (~0,8 s e ~43 KB cada).
# Aqui a foto é baixada uma vez, reduzida (WebP) e guardada em disco; o totem a recebe pela
# rede local, pequena e com cache longo. aquecer_fotos() baixa o catálogo todo ao subir.
# ─────────────────────────────────────────────────────────────────────────────
CACHE_FOTOS = DB_PATH.parent / "cache_fotos"
FOTO_LARGURAS = {240, 360, 480, 720, 1080}


def _foto_em_cache(caminho: str, largura: int) -> Path | None:
    destino = CACHE_FOTOS / str(largura) / (caminho.replace("/", "__").rsplit(".", 1)[0] + ".webp")
    if destino.exists():
        return destino
    import io
    import urllib.request
    from PIL import Image
    try:
        url = f"{sb.SUPABASE_URL}/storage/v1/object/public/{caminho}"
        with urllib.request.urlopen(url, timeout=20) as r:
            original = Image.open(io.BytesIO(r.read()))
            original.load()
    except Exception:
        return None
    if original.mode not in ("RGB", "RGBA"):
        original = original.convert("RGBA" if "A" in original.getbands() else "RGB")
    original.thumbnail((largura, largura * 2), Image.LANCZOS)
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(f".{threading.get_ident()}.tmp")
    original.save(temporario, "WEBP", quality=74, method=4)
    os.replace(temporario, destino)          # nunca serve um arquivo pela metade
    return destino


@app.get("/foto/<path:caminho>")
def foto_produto(caminho: str):
    if not re.fullmatch(r"[A-Za-z0-9_\-/]+\.(?:webp|png|jpe?g)", caminho, re.I) or ".." in caminho:
        abort(404)
    largura = request.args.get("w", 480, type=int)
    if largura not in FOTO_LARGURAS:
        largura = 480
    arquivo = _foto_em_cache(caminho, largura)
    if arquivo is None:
        abort(404)
    resp = send_file(arquivo, mimetype="image/webp", conditional=True)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


def aquecer_fotos(largura: int = 480) -> None:
    """Baixa e reduz as fotos de todo o catálogo em segundo plano (só as que faltam no disco)."""
    def trabalhar():
        from concurrent.futures import ThreadPoolExecutor
        try:
            items, _ = sb.listar("", "", True)
        except Exception as exc:
            print(f"[Fotos] catálogo indisponível: {exc}", flush=True)
            return
        caminhos = []
        for p in items:
            m = re.search(r"/storage/v1/object/public/(.+)$", str(p.get("imgUrl") or p.get("img_url") or ""))
            if m:
                caminhos.append(m.group(1))
        inicio = time.time()
        with ThreadPoolExecutor(max_workers=6) as pool:
            prontas = sum(1 for f in pool.map(lambda c: _foto_em_cache(c, largura), caminhos) if f)
        print(f"[Fotos] {prontas}/{len(caminhos)} fotos prontas no notebook ({time.time() - inicio:.0f} s)", flush=True)
    threading.Thread(target=trabalhar, daemon=True).start()


@app.after_request
def comprimir_json(resp):
    """Respostas JSON da API comprimidas (gzip): a lista de produtos cai de ~45 KB para ~8 KB."""
    if (resp.mimetype == "application/json" and not resp.direct_passthrough and resp.status_code == 200
            and "gzip" in request.headers.get("Accept-Encoding", "") and "Content-Encoding" not in resp.headers):
        import gzip
        dados = resp.get_data()
        if len(dados) > 2048:
            resp.set_data(gzip.compress(dados, 5))
            resp.headers["Content-Encoding"] = "gzip"
            resp.headers["Vary"] = "Accept-Encoding"
    return resp


# Arquivos de texto do frontend vão comprimidos (gzip): o admin cai de ~400 KB para ~90 KB,
# o que pesa muito pela rede lenta do totem. A versão comprimida fica em memória e só é
# refeita quando o arquivo muda.
COMPRIMIR = {".html", ".js", ".css", ".json", ".svg"}
_comprimidos: dict[str, tuple[float, bytes]] = {}


@app.get("/<path:filename>")
def frontend_file(filename: str):
    import gzip
    import mimetypes
    caminho = FRONTEND_DIR / filename
    if not caminho.is_file() or not caminho.resolve().is_relative_to(FRONTEND_DIR.resolve()):
        abort(404)
    if caminho.suffix.lower() in COMPRIMIR and "gzip" in request.headers.get("Accept-Encoding", ""):
        mtime = caminho.stat().st_mtime
        guardado = _comprimidos.get(filename)
        if not guardado or guardado[0] != mtime:
            guardado = (mtime, gzip.compress(caminho.read_bytes(), 6))
            _comprimidos[filename] = guardado
        resp = Response(guardado[1], mimetype=mimetypes.guess_type(filename)[0] or "application/octet-stream")
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Vary"] = "Accept-Encoding"
        resp.set_etag(f"{mtime}-gz")
        resp.last_modified = datetime.fromtimestamp(mtime, timezone.utc)
        resp = resp.make_conditional(request)
    else:
        resp = send_from_directory(FRONTEND_DIR, filename)
    # Com ?v= (o index e o admin trocam o número a cada mudança) o navegador guarda o arquivo
    # e nem pergunta de novo; o HTML e o resto sempre conferem com o servidor
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") else "no-cache"
    return resp


init_db()
metricas.configurar(db, lambda: camera.motor)
app.register_blueprint(metricas.bp)
presenca.configurar(db)
app.register_blueprint(presenca.bp)
nuvem.configurar(db)
app.register_blueprint(nuvem.bp)
vitrine.configurar(db)
app.register_blueprint(vitrine.bp)
loja.configurar(db)
app.register_blueprint(loja.bp)
app.register_blueprint(comportamento.bp)
taxonomia.configurar(db)
app.register_blueprint(taxonomia.bp)
app.register_blueprint(marketing.bp)

def servidor_https(wsgi_app, host: str, port: int, cert: str, key: str):
    """Servidor HTTPS que não trava com uma conexão parada.

    O Werkzeug faz o handshake TLS no accept(), na thread principal: um navegador que abre
    http:// (ou uma pré-conexão que nunca completa o TLS) bloqueia o servidor inteiro. Aqui a
    conexão é aceita crua e cada thread decide pelo primeiro byte: TLS (0x16) faz o handshake
    com limite de tempo; HTTP comum recebe um redirecionamento para https://.
    """
    import io
    import socket
    import ssl
    from werkzeug.serving import ThreadedWSGIServer, WSGIRequestHandler, load_ssl_context

    contexto = load_ssl_context(cert, key)
    CORPO_MAX_KEEPALIVE = 8 * 1024 * 1024    # uploads maiores (vídeo de campanha) seguem fechando a conexão
    # Socket que nunca tem nada para ler (o outro lado do par nunca escreve). Veja run_wsgi.
    sem_dados, _ = socket.socketpair()

    class ManterConexao(WSGIRequestHandler):
        """Keep-alive: a conexão TLS é reaproveitada entre requisições.

        O Werkzeug 3 fecha toda conexão ("Connection: close") e, depois de cada resposta,
        "drena" o socket com rfile.read(10 MB), que fica esperando até chegar 10 MB ou a
        conexão fechar. Com keep-alive isso trava na requisição seguinte (o próprio Werkzeug
        avisa no comentário). Pela rede do totem (hotspot, ~0,8 s de ida e volta), fechar a
        conexão custava TCP + TLS a cada quadro da câmera: segundos por imagem.

        Aqui: o corpo é lido inteiro antes de chamar o Werkzeug, e durante a resposta ele
        enxerga um socket sem dados (o dreno passa direto). Depois o socket real volta e o
        laço do http.server lê a próxima requisição na mesma conexão.
        """
        timeout = 30                         # conexão parada por 30 s é fechada (libera a thread)

        def make_environ(self):
            environ = super().make_environ()
            # durante run_wsgi self.connection é o socket sem dados; o Flask recebe o real
            environ["werkzeug.socket"] = self._conexao_real
            return environ

        def run_wsgi(self):
            self._conexao_real = self.connection
            try:
                tamanho = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                tamanho = -1
            self._manter = (self.request_version == "HTTP/1.1"
                            and not self.headers.get("Transfer-Encoding")
                            and self.headers.get("Connection", "").lower() != "close"
                            and 0 <= tamanho <= CORPO_MAX_KEEPALIVE)
            if not self._manter:
                return super().run_wsgi()    # comportamento original do Werkzeug: fecha a conexão
            corpo = self.rfile.read(tamanho) if tamanho else b""
            rfile, conexao = self.rfile, self.connection
            self.rfile, self.connection = io.BytesIO(corpo), sem_dados
            try:
                super().run_wsgi()
            finally:
                self.rfile, self.connection = rfile, conexao

        def send_header(self, keyword, value):
            if keyword.lower() == "connection" and value.lower() == "close" and getattr(self, "_manter", False):
                value = "keep-alive"         # BaseHTTPRequestHandler então mantém o laço de requisições
            super().send_header(keyword, value)

    class Servidor(ThreadedWSGIServer):
        def finish_request(self, conexao, endereco):
            conexao.settimeout(10)
            try:
                primeiro = conexao.recv(1, socket.MSG_PEEK)
                if not primeiro:
                    return
                if primeiro != b"\x16":
                    redirecionar_para_https(conexao)
                    return
                conexao = contexto.wrap_socket(conexao, server_side=True)
                conexao.settimeout(None)
            except (OSError, ssl.SSLError):
                return                      # cliente sumiu ou falhou o TLS: só esta conexão cai
            try:
                super().finish_request(conexao, endereco)
            finally:
                # o socket TLS substituiu o original (que o servidor fecharia): fecha aqui
                try:
                    conexao.close()
                except OSError:
                    pass

    def redirecionar_para_https(conexao):
        dados = conexao.recv(4096).decode("latin-1", "replace")
        linhas = dados.split("\r\n")
        partes = linhas[0].split(" ")
        caminho = partes[1] if len(partes) > 1 and partes[1].startswith("/") else "/"
        host_hdr = next((l.split(":", 1)[1].strip() for l in linhas[1:] if l.lower().startswith("host:")), f"localhost:{port}")
        destino = f"https://{host_hdr}{caminho}"
        conexao.sendall((f"HTTP/1.1 301 Moved Permanently\r\nLocation: {destino}\r\n"
                         "Content-Length: 0\r\nConnection: close\r\n\r\n").encode("latin-1"))

    srv = Servidor(host, port, wsgi_app, handler=ManterConexao)
    srv.ssl_context = contexto              # o Werkzeug usa isto para marcar wsgi.url_scheme = https
    return srv


if __name__ == "__main__":
    https = CERT_FILE.exists() and KEY_FILE.exists() and os.getenv("FLEXMED_HTTPS", "1") != "0"
    print(f"FlexMed backend iniciado em {'https' if https else 'http'}://{HOST}:{PORT}")
    print(f"Banco SQLite: {DB_PATH}")
    print("Câmera compartilhada: vision_start somente em standby; libras_start pausa vision.")
    # HTTP/1.1 nas respostas. A conexão só fica aberta entre requisições no modo HTTPS
    # (servidor_https › ManterConexao): o Werkzeug 3 sozinho fecha a conexão sempre.
    from werkzeug.serving import WSGIRequestHandler
    WSGIRequestHandler.protocol_version = "HTTP/1.1"
    if LIBRAS_SEMPRE_LIGADA:
        camera.manter_libras_ligada()
    if sb.configurado():
        aquecer_fotos()
    if not https:
        app.run(host=HOST, port=PORT, debug=False, threaded=True)
    else:
        servidor_https(app, HOST, PORT, str(CERT_FILE), str(KEY_FILE)).serve_forever()
