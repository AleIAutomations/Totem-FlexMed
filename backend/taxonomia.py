"""Categorias (nichos) e subcategorias do catálogo, editáveis no admin.

No totem a navegação tem dois níveis:
  categoria  = nicho no topo (Medicamentos, Beleza...)      -> tabela local `loja_nichos`
  subcategoria = categoria do produto (Analgésicos...)       -> Supabase `categorias` (slug, nome)
                                                                + local `loja_categoria_meta` (nicho, ícone, ordem, ativo)
Os produtos guardam a subcategoria em products.categoria (slug) e categoriaId.
No primeiro uso, as tabelas locais são preenchidas com a árvore padrão de categorias.py.

Rotas:
  GET    /api/nichos                          nichos ativos, em ordem (o totem usa)
  GET    /api/loja/taxonomia                  árvore completa para o admin (com totais de produtos)
  POST   /api/loja/nichos                     cria nicho        PUT/DELETE /api/loja/nichos/<slug>
  POST   /api/loja/categorias                 cria subcategoria PUT/DELETE /api/loja/categorias/<slug>?mover_para=
  POST   /api/loja/taxonomia/ordem            nova ordem de nichos e subcategorias
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Callable

from flask import Blueprint, jsonify, request

import categorias as padrao
import supabase_products as sb

bp = Blueprint("taxonomia", __name__)
_db: Callable[[], Any] | None = None

# ícones disponíveis no totem (frontend/script.js › icon())
ICONES = ["pill", "shield", "leaf", "drop", "sun", "smile", "hand", "palette", "spark", "star", "target", "doc", "box",
          "tag", "info", "home", "store", "snow", "pin", "bot", "cart", "search", "bar", "check"]
ICONES_PADRAO = {"medicamentos": "pill", "beleza": "palette", "higiene": "hand", "infantil": "smile", "bem_estar": "leaf",
                 "analgesico": "pill", "antibiotico": "shield", "vitaminas": "leaf", "diabetes": "drop", "dermato": "sun",
                 "cuidados": "hand", "alergias": "spark", "coracao": "target",
                 "primeiros_socorros": "box", "outros": "tag"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS loja_nichos (
    slug TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    icone TEXT DEFAULT 'tag',
    ordem INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS loja_categoria_meta (
    slug TEXT PRIMARY KEY,                -- categorias.slug no Supabase
    nicho TEXT,
    icone TEXT DEFAULT 'tag',
    ordem INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1
);
"""


def configurar(db: Callable[[], Any]) -> None:
    global _db
    _db = db
    with _db() as conn:
        conn.executescript(SCHEMA)
        if not conn.execute("SELECT 1 FROM loja_nichos LIMIT 1").fetchone():
            conn.executemany("INSERT INTO loja_nichos (slug, nome, icone, ordem) VALUES (?,?,?,?)",
                             [(s, n, ICONES_PADRAO.get(s, "tag"), i) for i, (s, n, _) in enumerate(padrao.NICHOS)])
            ordem = {s: i for i, (s, _) in enumerate(padrao.CATEGORIAS)}
            conn.executemany("INSERT OR IGNORE INTO loja_categoria_meta (slug, nicho, icone, ordem) VALUES (?,?,?,?)",
                             [(c, n, ICONES_PADRAO.get(c, "tag"), ordem.get(c, 99)) for c, n in padrao.NICHO_DA_CATEGORIA.items()])


def slugificar(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:40] or "categoria"


def _nichos(conn, so_ativos: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT * FROM loja_nichos" + (" WHERE ativo=1" if so_ativos else "") + " ORDER BY ordem, nome"
    return [{**dict(r), "ativo": bool(r["ativo"])} for r in conn.execute(sql)]


def meta_categorias() -> dict[str, dict[str, Any]]:
    with _db() as conn:
        return {r["slug"]: dict(r) for r in conn.execute("SELECT * FROM loja_categoria_meta")}


def nicho_da_categoria(slug: str) -> str:
    m = meta_categorias().get(slug)
    return (m or {}).get("nicho") or padrao.NICHO_DA_CATEGORIA.get(slug, "bem_estar")


def nomes() -> dict[str, str]:
    """slug -> nome legível de nichos e subcategorias (relatórios)."""
    saida = dict(padrao.NOMES)
    with _db() as conn:
        saida.update({n["slug"]: n["nome"] for n in _nichos(conn)})
    try:
        saida.update({c["slug"]: c["nome"] for c in sb.listar_categorias()})
    except Exception:
        pass
    return saida


def categorias_do_nicho(nicho: str) -> list[str]:
    with _db() as conn:
        slugs = [r["slug"] for r in conn.execute("SELECT slug FROM loja_categoria_meta WHERE nicho=? AND ativo=1", (nicho,))]
    return slugs or padrao.CATEGORIAS_DO_NICHO.get(nicho, [nicho])


def enriquecer(cats: list[dict[str, Any]], so_ativas: bool = True) -> list[dict[str, Any]]:
    """Categorias do Supabase + nicho/ícone/ordem/ativo locais, na ordem do totem."""
    meta = meta_categorias()
    with _db() as conn:
        nichos = {n["slug"]: n for n in _nichos(conn)}
    saida = []
    for c in cats:
        m = meta.get(c["slug"], {})
        nicho = m.get("nicho") or padrao.NICHO_DA_CATEGORIA.get(c["slug"], "bem_estar")
        ativo = bool(m.get("ativo", 1)) and nichos.get(nicho, {}).get("ativo", True)
        if so_ativas and not ativo:
            continue
        saida.append({**c, "nicho": nicho, "nicho_nome": nichos.get(nicho, {}).get("nome", nicho),
                      "icone": m.get("icone") or "tag", "ordem": m.get("ordem", 99), "ativo": ativo})
    ordem_nicho = {s: n["ordem"] for s, n in nichos.items()}
    return sorted(saida, key=lambda c: (ordem_nicho.get(c["nicho"], 99), c["ordem"], c["nome"]))


# ─── rotas ───────────────────────────────────────────────────────────────────
@bp.get("/api/nichos")
def listar_nichos():
    with _db() as conn:
        return jsonify(_nichos(conn, so_ativos=True))


@bp.get("/api/loja/taxonomia")
def arvore():
    cats = enriquecer(sb.listar_categorias(), so_ativas=False) if sb.configurado() else []
    with _db() as conn:
        nichos = _nichos(conn)
    por_nicho = {n["slug"]: [] for n in nichos}
    soltas = []
    for c in cats:
        (por_nicho[c["nicho"]] if c["nicho"] in por_nicho else soltas).append(c)
    return jsonify({"icones": ICONES, "nichos": [{**n, "categorias": por_nicho[n["slug"]],
                                                   "produtos": sum(c["total"] for c in por_nicho[n["slug"]])} for n in nichos],
                    "sem_nicho": soltas})


def _icone(valor: Any) -> str:
    return valor if valor in ICONES else "tag"


@bp.post("/api/loja/nichos")
def criar_nicho():
    p = request.get_json(silent=True) or {}
    nome = str(p.get("nome") or "").strip()[:40]
    if not nome:
        return jsonify({"error": "nome_obrigatorio"}), 400
    slug = slugificar(nome)
    with _db() as conn:
        if conn.execute("SELECT 1 FROM loja_nichos WHERE slug=?", (slug,)).fetchone():
            return jsonify({"error": "ja_existe"}), 400
        ordem = conn.execute("SELECT COALESCE(MAX(ordem), -1) + 1 FROM loja_nichos").fetchone()[0]
        conn.execute("INSERT INTO loja_nichos (slug, nome, icone, ordem) VALUES (?,?,?,?)", (slug, nome, _icone(p.get("icone")), ordem))
    return jsonify({"slug": slug}), 201


@bp.put("/api/loja/nichos/<slug>")
def alterar_nicho(slug: str):
    p = request.get_json(silent=True) or {}
    with _db() as conn:
        atual = conn.execute("SELECT * FROM loja_nichos WHERE slug=?", (slug,)).fetchone()
        if not atual:
            return jsonify({"error": "nao_encontrado"}), 404
        conn.execute("UPDATE loja_nichos SET nome=?, icone=?, ativo=? WHERE slug=?",
                     (str(p.get("nome") or atual["nome"]).strip()[:40], _icone(p.get("icone", atual["icone"])),
                      1 if p.get("ativo", bool(atual["ativo"])) else 0, slug))
    return jsonify({"ok": True})


@bp.delete("/api/loja/nichos/<slug>")
def remover_nicho(slug: str):
    """As subcategorias do nicho vão para `mover_para` (obrigatório se houver alguma)."""
    destino = request.args.get("mover_para") or ""
    with _db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM loja_categoria_meta WHERE nicho=?", (slug,)).fetchone()[0]
        if n and not conn.execute("SELECT 1 FROM loja_nichos WHERE slug=? AND slug<>?", (destino, slug)).fetchone():
            return jsonify({"error": "escolha_destino"}), 400
        conn.execute("UPDATE loja_categoria_meta SET nicho=? WHERE nicho=?", (destino, slug))
        conn.execute("DELETE FROM loja_nichos WHERE slug=?", (slug,))
    return jsonify({"ok": True, "movidas": n})


@bp.post("/api/loja/categorias")
def criar_categoria():
    p = request.get_json(silent=True) or {}
    nome = str(p.get("nome") or "").strip()[:60]
    nicho = p.get("nicho")
    if not nome:
        return jsonify({"error": "nome_obrigatorio"}), 400
    with _db() as conn:
        if not conn.execute("SELECT 1 FROM loja_nichos WHERE slug=?", (nicho,)).fetchone():
            return jsonify({"error": "nicho_invalido"}), 400
    slug = slugificar(nome)
    if any(c["slug"] == slug for c in sb.listar_categorias()):
        return jsonify({"error": "ja_existe"}), 400
    cid = sb.garantir_categoria(slug, nome)
    with _db() as conn:
        ordem = conn.execute("SELECT COALESCE(MAX(ordem), -1) + 1 FROM loja_categoria_meta WHERE nicho=?", (nicho,)).fetchone()[0]
        conn.execute("INSERT OR REPLACE INTO loja_categoria_meta (slug, nicho, icone, ordem, ativo) VALUES (?,?,?,?,1)",
                     (slug, nicho, _icone(p.get("icone")), ordem))
    return jsonify({"slug": slug, "id": cid}), 201


@bp.put("/api/loja/categorias/<slug>")
def alterar_categoria(slug: str):
    p = request.get_json(silent=True) or {}
    if p.get("nome"):
        sb._rest("PATCH", params={"slug": f"eq.{slug}"}, json={"nome": str(p["nome"]).strip()[:60]}, tabela="categorias")
    with _db() as conn:
        atual = conn.execute("SELECT * FROM loja_categoria_meta WHERE slug=?", (slug,)).fetchone()
        atual = dict(atual) if atual else {"nicho": padrao.NICHO_DA_CATEGORIA.get(slug, "bem_estar"), "icone": "tag", "ordem": 99, "ativo": 1}
        nicho = p.get("nicho", atual["nicho"])
        if not conn.execute("SELECT 1 FROM loja_nichos WHERE slug=?", (nicho,)).fetchone():
            return jsonify({"error": "nicho_invalido"}), 400
        conn.execute("INSERT OR REPLACE INTO loja_categoria_meta (slug, nicho, icone, ordem, ativo) VALUES (?,?,?,?,?)",
                     (slug, nicho, _icone(p.get("icone", atual["icone"])), atual["ordem"],
                      1 if p.get("ativo", bool(atual["ativo"])) else 0))
    return jsonify({"ok": True})


@bp.delete("/api/loja/categorias/<slug>")
def remover_categoria(slug: str):
    """Os produtos da subcategoria vão para `mover_para` antes de apagá-la."""
    destino = request.args.get("mover_para") or ""
    cats = {c["slug"]: c for c in sb.listar_categorias()}
    if slug not in cats:
        return jsonify({"error": "nao_encontrado"}), 404
    if cats[slug]["total"]:
        if destino not in cats or destino == slug:
            return jsonify({"error": "escolha_destino"}), 400
        sb._rest("PATCH", params={"categoria": f"eq.{slug}"}, json={"categoria": destino, "categoriaId": cats[destino]["id"]})
    sb._rest("DELETE", params={"slug": f"eq.{slug}"}, tabela="categorias")
    with _db() as conn:
        conn.execute("DELETE FROM loja_categoria_meta WHERE slug=?", (slug,))
    try:
        import loja
        loja._invalidar_catalogo()
    except Exception:
        pass
    return jsonify({"ok": True, "movidos": cats[slug]["total"]})


@bp.post("/api/loja/taxonomia/ordem")
def reordenar():
    p = request.get_json(silent=True) or {}
    with _db() as conn:
        for i, slug in enumerate(p.get("nichos") or []):
            conn.execute("UPDATE loja_nichos SET ordem=? WHERE slug=?", (i, slug))
        for nicho, slugs in (p.get("categorias") or {}).items():
            for i, slug in enumerate(slugs):
                conn.execute("""INSERT INTO loja_categoria_meta (slug, nicho, ordem) VALUES (?,?,?)
                                ON CONFLICT(slug) DO UPDATE SET nicho=excluded.nicho, ordem=excluded.ordem""", (slug, nicho, i))
    return jsonify({"ok": True})
