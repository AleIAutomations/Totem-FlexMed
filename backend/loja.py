"""Loja do totem: catálogo completo, estoque, lotes/validade, movimentações e pedidos.

O cadastro "de vitrine" do produto (nome, preço, foto, descrição, categoria) fica no
Supabase (`products`, ver supabase_products.py). Aqui fica o que é de gestão da loja,
gravado no SQLite local (funciona sem internet) e enviado ao Supabase pelo nuvem.py:

  produto_estoque     SKU, EAN, marca, custo médio, saldo, mínimo/máximo, controle ligado
  estoque_lotes       saldo por lote e validade (saídas consomem o que vence primeiro)
  estoque_movimentos  toda entrada, saída, perda, devolução, ajuste (contagem) e venda
  pedidos/pedido_itens pedidos feitos no totem e retirados no balcão
  loja_config         esconder esgotados no totem, alerta de validade, mínimo padrão

Disponível = saldo - reservado (itens de pedidos ainda não entregues). A venda baixa
o estoque quando o pedido é marcado como entregue.

Rotas: /api/loja/* (cadastro completo, imagem, config), /api/estoque/* (gestão),
/api/pedidos/* (totem e balcão).
"""
from __future__ import annotations

import csv
import io
import json
import re
import secrets
import threading
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Callable

from flask import Blueprint, Response, jsonify, request
from werkzeug.utils import secure_filename

import supabase_products as sb

bp = Blueprint("loja", __name__)
_db: Callable[[], Any] | None = None

TIPOS_MOV = {"entrada": 1, "devolucao": 1, "saida": -1, "perda": -1, "venda": -1, "ajuste": 0}
STATUS_PEDIDO = ["novo", "separando", "pronto", "entregue", "cancelado"]
ABERTOS = ("novo", "separando", "pronto")
PROXIMOS = {"novo": {"separando", "pronto", "entregue", "cancelado"}, "separando": {"pronto", "entregue", "cancelado"},
            "pronto": {"entregue", "cancelado"}, "entregue": set(), "cancelado": set()}
CONFIG_PADRAO = {"ocultar_esgotados": False, "dias_alerta_validade": 60, "estoque_minimo_padrao": 5,
                 "estoque_maximo_padrao": 30}

SCHEMA = """
CREATE TABLE IF NOT EXISTS produto_estoque (
    product_id TEXT PRIMARY KEY,          -- id do produto no Supabase
    sku TEXT UNIQUE,
    ean TEXT,                             -- código de barras (EAN-8/13/GTIN-14)
    marca TEXT DEFAULT '',
    fabricante TEXT DEFAULT '',
    fornecedor TEXT DEFAULT '',
    unidade TEXT DEFAULT 'un',
    custo REAL,                           -- custo médio ponderado
    estoque INTEGER DEFAULT 0,            -- saldo físico
    estoque_minimo INTEGER DEFAULT 5,
    estoque_maximo INTEGER DEFAULT 30,
    controla_estoque INTEGER DEFAULT 1,
    galeria TEXT DEFAULT '[]',            -- fotos extras (a principal é imgUrl no Supabase)
    atualizado REAL
);
CREATE INDEX IF NOT EXISTS idx_estoque_ean ON produto_estoque (ean);

CREATE TABLE IF NOT EXISTS estoque_lotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    lote TEXT DEFAULT '',                 -- '' = sem lote informado
    validade TEXT,                        -- AAAA-MM-DD
    quantidade INTEGER DEFAULT 0,
    criado REAL,
    atualizado REAL,
    UNIQUE (product_id, lote)
);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    sku TEXT,
    nome TEXT,
    tipo TEXT NOT NULL,                   -- entrada | saida | perda | devolucao | ajuste | venda
    quantidade INTEGER NOT NULL,          -- com sinal (+ entra, - sai)
    saldo_apos INTEGER NOT NULL,
    custo_unit REAL,
    lote TEXT,
    motivo TEXT DEFAULT '',
    pedido_id TEXT,
    usuario TEXT DEFAULT '',
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_ts ON estoque_movimentos (ts);
CREATE INDEX IF NOT EXISTS idx_mov_prod ON estoque_movimentos (product_id, ts);

CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY,
    codigo TEXT NOT NULL,                 -- curto, mostrado no totem e chamado no balcão
    sessao_id TEXT,
    status TEXT DEFAULT 'novo',           -- novo | separando | pronto | entregue | cancelado
    itens INTEGER DEFAULT 0,
    total REAL DEFAULT 0,
    observacao TEXT DEFAULT '',
    criado REAL NOT NULL,
    atualizado REAL NOT NULL,
    entregue_em REAL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos (criado);

CREATE TABLE IF NOT EXISTS pedido_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    nome TEXT,
    sku TEXT,
    qtd INTEGER NOT NULL,
    preco_unit REAL,
    faltou INTEGER DEFAULT 0              -- não havia saldo suficiente quando o pedido foi feito
);
CREATE INDEX IF NOT EXISTS idx_itens_pedido ON pedido_itens (pedido_id);

CREATE TABLE IF NOT EXISTS loja_config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
"""


def configurar(db: Callable[[], Any]) -> None:
    global _db
    _db = db
    with _db() as conn:
        conn.executescript(SCHEMA)


# ─── catálogo do Supabase (cache curto: o estoque cruza com ele toda hora) ────
_cache: dict[str, Any] = {"em": 0.0, "itens": []}
_cache_lock = threading.Lock()


def _catalogo(forcar: bool = False) -> list[dict[str, Any]]:
    with _cache_lock:
        if forcar or time.time() - _cache["em"] > 20:
            itens, _ = sb.listar(only_active=False) if sb.configurado() else ([], 0)
            _cache.update(em=time.time(), itens=itens)
        return _cache["itens"]


def _invalidar_catalogo() -> None:
    _cache["em"] = 0.0


def _produto(pid: str) -> dict[str, Any] | None:
    return next((p for p in _catalogo() if str(p["id"]) == str(pid)), None)


# ─── utilitários ─────────────────────────────────────────────────────────────
def config() -> dict[str, Any]:
    with _db() as conn:
        salvo = {r["chave"]: json.loads(r["valor"]) for r in conn.execute("SELECT * FROM loja_config")}
    return {**CONFIG_PADRAO, **{k: v for k, v in salvo.items() if k in CONFIG_PADRAO}}


def ean_valido(ean: str) -> bool:
    """Dígito verificador GS1 (EAN-8, EAN-13, GTIN-14)."""
    if not re.fullmatch(r"\d{8}|\d{12,14}", ean or ""):
        return False
    digitos = [int(d) for d in ean]
    soma = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digitos[:-1])))
    return (10 - soma % 10) % 10 == digitos[-1]


def ean_do_texto(texto: str | None) -> str | None:
    """Produtos importados trazem "EAN: 7891234567895" na descrição."""
    m = re.search(r"\bEAN\D{0,3}(\d{8,14})\b", texto or "", re.I)
    return m.group(1) if m and ean_valido(m.group(1)) else None


def _prefixo_sku(categoria: str | None) -> str:
    letras = re.sub(r"[^A-Za-z]", "", (categoria or "GER").upper())
    return (letras[:3] or "GER").ljust(3, "X")


def _gerar_sku(conn, categoria: str | None) -> str:
    prefixo = _prefixo_sku(categoria)
    ultimos = [int(r["sku"].split("-")[1]) for r in conn.execute(
        "SELECT sku FROM produto_estoque WHERE sku LIKE ?", (f"{prefixo}-%",)) if r["sku"].split("-")[1].isdigit()]
    return f"{prefixo}-{(max(ultimos) + 1) if ultimos else 1:05d}"


def _registro(conn, pid: str) -> Any:
    return conn.execute("SELECT * FROM produto_estoque WHERE product_id=?", (pid,)).fetchone()


def _garantir_registro(conn, pid: str, produto: dict[str, Any] | None = None, controla: bool = False) -> Any:
    """Cria o registro de estoque do produto (SKU automático, EAN da descrição, saldo do Supabase).
    O controle só nasce ligado quando pedido: um produto controlado com saldo 0 vira "Esgotado" no totem."""
    r = _registro(conn, pid)
    if r:
        return r
    produto = produto or _produto(pid) or {}
    cfg = config()
    saldo = max(int(produto.get("estoque") or 0), 0)
    agora = time.time()
    conn.execute(
        """INSERT INTO produto_estoque (product_id, sku, ean, estoque, estoque_minimo, estoque_maximo,
           controla_estoque, atualizado) VALUES (?,?,?,?,?,?,?,?)""",
        (pid, _gerar_sku(conn, produto.get("categoria")), ean_do_texto(produto.get("uso")), saldo,
         cfg["estoque_minimo_padrao"], max(cfg["estoque_maximo_padrao"], saldo), 1 if controla else 0, agora))
    if saldo:
        conn.execute("INSERT INTO estoque_lotes (product_id, lote, quantidade, criado, atualizado) VALUES (?,?,?,?,?)",
                     (pid, "", saldo, agora, agora))
    return _registro(conn, pid)


def _reservados(conn) -> dict[str, int]:
    marcas = ",".join("?" * len(ABERTOS))
    return {r["product_id"]: r["qtd"] for r in conn.execute(
        f"""SELECT i.product_id, SUM(i.qtd) AS qtd FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
            WHERE p.status IN ({marcas}) GROUP BY i.product_id""", ABERTOS)}


def _vendas(conn, dias: int) -> dict[str, dict[str, float]]:
    desde = time.time() - dias * 86400
    saida: dict[str, dict[str, float]] = defaultdict(lambda: {"qtd": 0, "valor": 0.0})
    for r in conn.execute(
            """SELECT i.product_id, i.qtd, i.preco_unit FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
               WHERE p.status='entregue' AND p.entregue_em>=?""", (desde,)):
        saida[r["product_id"]]["qtd"] += r["qtd"]
        saida[r["product_id"]]["valor"] += r["qtd"] * (r["preco_unit"] or 0)
    return saida


def _status(controla: bool, disponivel: int, minimo: int) -> str:
    if not controla:
        return "sem_controle"
    if disponivel <= 0:
        return "zerado"
    return "baixo" if disponivel <= minimo else "ok"


# ─── movimentação (o único caminho que altera saldo) ─────────────────────────
class ErroEstoque(ValueError):
    pass


def movimentar(conn, pid: str, tipo: str, quantidade: int, motivo: str = "", lote: str = "",
               validade: str | None = None, custo_unit: float | None = None, pedido_id: str | None = None,
               usuario: str = "", parcial: bool = False) -> dict[str, Any]:
    """Aplica uma movimentação. `ajuste` recebe o saldo contado (não a diferença).
    `parcial` (vendas): baixa só o que houver em vez de recusar."""
    if tipo not in TIPOS_MOV:
        raise ErroEstoque("tipo_invalido")
    quantidade = int(quantidade)
    if quantidade < 0 or (quantidade == 0 and tipo != "ajuste"):
        raise ErroEstoque("quantidade_invalida")
    reg = _garantir_registro(conn, pid)
    saldo = reg["estoque"]
    delta = quantidade - saldo if tipo == "ajuste" else TIPOS_MOV[tipo] * quantidade
    if saldo + delta < 0:
        if not parcial:
            raise ErroEstoque("estoque_insuficiente")
        delta = -saldo
    agora = time.time()
    lote = (lote or "").strip()[:40]

    if delta > 0:
        existente = conn.execute("SELECT id FROM estoque_lotes WHERE product_id=? AND lote=?", (pid, lote)).fetchone()
        if existente:
            conn.execute("UPDATE estoque_lotes SET quantidade=quantidade+?, validade=COALESCE(?, validade), atualizado=? "
                         "WHERE id=?", (delta, validade or None, agora, existente["id"]))
        else:
            conn.execute("INSERT INTO estoque_lotes (product_id, lote, validade, quantidade, criado, atualizado) "
                         "VALUES (?,?,?,?,?,?)", (pid, lote, validade or None, delta, agora, agora))
    elif delta < 0:
        # FEFO: sai primeiro o que vence primeiro (sem validade por último); lote indicado tem preferência
        falta = -delta
        lotes = conn.execute(
            """SELECT * FROM estoque_lotes WHERE product_id=? AND quantidade>0
               ORDER BY (lote=?) DESC, validade IS NULL, validade, id""", (pid, lote)).fetchall()
        for l in lotes:
            tira = min(falta, l["quantidade"])
            conn.execute("UPDATE estoque_lotes SET quantidade=quantidade-?, atualizado=? WHERE id=?", (tira, agora, l["id"]))
            falta -= tira
            if not falta:
                break

    custo = reg["custo"]
    if delta > 0 and custo_unit is not None and tipo == "entrada":   # custo médio ponderado
        custo = ((custo or custo_unit) * saldo + custo_unit * delta) / (saldo + delta) if saldo + delta else custo_unit
    novo = saldo + delta
    conn.execute("UPDATE produto_estoque SET estoque=?, custo=?, atualizado=? WHERE product_id=?",
                 (novo, round(custo, 4) if custo is not None else None, agora, pid))
    produto = _produto(pid) or {}
    cur = conn.execute(
        """INSERT INTO estoque_movimentos (product_id, sku, nome, tipo, quantidade, saldo_apos, custo_unit, lote,
           motivo, pedido_id, usuario, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (pid, reg["sku"], produto.get("nome", ""), tipo, delta, novo, custo_unit, lote or None,
         str(motivo or "")[:200], pedido_id, str(usuario or "")[:40], agora))
    return {"id": cur.lastrowid, "delta": delta, "saldo": novo}


# ─── visão consolidada do estoque ────────────────────────────────────────────
def _linhas_estoque(conn) -> list[dict[str, Any]]:
    cfg = config()
    regs = {r["product_id"]: r for r in conn.execute("SELECT * FROM produto_estoque")}
    reservados = _reservados(conn)
    vendas30 = _vendas(conn, 30)
    limite_validade = (date.today() + timedelta(days=cfg["dias_alerta_validade"])).isoformat()
    validades: dict[str, dict[str, Any]] = {}
    for l in conn.execute("SELECT product_id, MIN(validade) AS v, SUM(quantidade) AS q FROM estoque_lotes "
                          "WHERE quantidade>0 AND validade IS NOT NULL GROUP BY product_id"):
        validades[l["product_id"]] = {"proxima": l["v"]}
    hoje = date.today().isoformat()
    saida = []
    for p in _catalogo():
        pid = str(p["id"])
        r = regs.get(pid)
        controla = bool(r and r["controla_estoque"])
        saldo = r["estoque"] if r else max(int(p.get("estoque") or 0), 0)
        reservado = reservados.get(pid, 0)
        disponivel = saldo - reservado
        minimo = r["estoque_minimo"] if r else cfg["estoque_minimo_padrao"]
        maximo = r["estoque_maximo"] if r else cfg["estoque_maximo_padrao"]
        custo = r["custo"] if r else None
        preco = p.get("precoValor")
        venda_dia = vendas30.get(pid, {"qtd": 0})["qtd"] / 30
        prox = validades.get(pid, {}).get("proxima")
        saida.append({
            "id": pid, "nome": p.get("nome"), "imgUrl": p.get("imgUrl"), "categoria": p.get("categoria"),
            "tipo": p.get("tipo"), "active": p.get("active", True), "receita": p.get("receita"),
            "local": p.get("local") or "", "preco": preco, "precoOriginal": p.get("precoOriginal"),
            "fonte": p.get("fonte"),
            "sku": r["sku"] if r else None, "ean": (r["ean"] if r else None) or None,
            "ean_sugerido": None if r and r["ean"] else ean_do_texto(p.get("uso")),
            "marca": r["marca"] if r else "", "fabricante": r["fabricante"] if r else "",
            "fornecedor": r["fornecedor"] if r else "", "unidade": r["unidade"] if r else "un",
            "custo": custo, "margem": round((preco - custo) / preco * 100, 1) if preco and custo else None,
            "controla": controla, "estoque": saldo, "reservado": reservado, "disponivel": disponivel,
            "minimo": minimo, "maximo": maximo, "status": _status(controla, disponivel, minimo),
            "validade_proxima": prox, "vencido": bool(prox and prox < hoje),
            "vencendo": bool(prox and hoje <= prox <= limite_validade),
            "vendas_30d": int(vendas30.get(pid, {"qtd": 0})["qtd"]),
            "cobertura_dias": round(disponivel / venda_dia) if venda_dia and controla else None,
            "sugestao_compra": max(maximo - disponivel, 0) if controla and disponivel <= minimo else 0,
            "galeria": json.loads(r["galeria"] or "[]") if r else [],
        })
    return saida


def mesclar_no_catalogo(itens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Para o totem: saldo disponível e selos (esgotado / últimas unidades) nos produtos da API."""
    if _db is None or not itens:
        return itens
    with _db() as conn:
        ids = [str(i["id"]) for i in itens]
        marcas = ",".join("?" * len(ids))
        regs = {r["product_id"]: r for r in conn.execute(
            f"SELECT * FROM produto_estoque WHERE product_id IN ({marcas})", ids)}
        reservados = _reservados(conn) if regs else {}
    for i in itens:
        r = regs.get(str(i["id"]))
        if not r:
            continue
        i["sku"] = r["sku"]
        i["marca"] = r["marca"]
        i["galeria"] = json.loads(r["galeria"] or "[]")
        i["controlaEstoque"] = bool(r["controla_estoque"])
        if r["controla_estoque"]:
            disponivel = max(r["estoque"] - reservados.get(r["product_id"], 0), 0)
            i["estoque"] = disponivel
            i["estoqueMax"] = max(r["estoque_maximo"], disponivel)
            i["esgotado"] = disponivel <= 0
            i["ultimasUnidades"] = 0 < disponivel <= min(r["estoque_minimo"], 5)
    return itens


def ids_ocultos() -> list[str]:
    """Esgotados que o totem deve esconder (config ocultar_esgotados)."""
    if _db is None or not config()["ocultar_esgotados"]:
        return []
    with _db() as conn:
        reservados = _reservados(conn)
        return [r["product_id"] for r in conn.execute(
            "SELECT product_id, estoque FROM produto_estoque WHERE controla_estoque=1")
            if r["estoque"] - reservados.get(r["product_id"], 0) <= 0]


# ─── rotas: configuração ─────────────────────────────────────────────────────
@bp.get("/api/loja/config")
def ler_config():
    return jsonify(config())


@bp.post("/api/loja/config")
def salvar_config():
    p = request.get_json(silent=True) or {}
    atual = config()
    novos = {
        "ocultar_esgotados": bool(p.get("ocultar_esgotados", atual["ocultar_esgotados"])),
        "dias_alerta_validade": max(7, min(int(p.get("dias_alerta_validade", atual["dias_alerta_validade"])), 365)),
        "estoque_minimo_padrao": max(0, min(int(p.get("estoque_minimo_padrao", atual["estoque_minimo_padrao"])), 999)),
        "estoque_maximo_padrao": max(1, min(int(p.get("estoque_maximo_padrao", atual["estoque_maximo_padrao"])), 9999)),
    }
    with _db() as conn:
        conn.executemany("INSERT OR REPLACE INTO loja_config (chave, valor) VALUES (?,?)",
                         [(k, json.dumps(v)) for k, v in novos.items()])
    return jsonify(novos)


# ─── rotas: cadastro completo do produto (Supabase + loja) ───────────────────
CAMPOS_LOJA = ("sku", "ean", "marca", "fabricante", "fornecedor", "unidade", "custo", "estoque_minimo",
               "estoque_maximo", "controla_estoque", "galeria")


def _validar_loja(conn, pid: str | None, p: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    d: dict[str, Any] = {}
    if "sku" in p:
        sku = re.sub(r"[^A-Za-z0-9._-]", "", str(p["sku"] or "")).upper()[:32]
        if sku:
            outro = conn.execute("SELECT product_id FROM produto_estoque WHERE sku=? AND product_id<>?",
                                 (sku, pid or "")).fetchone()
            if outro:
                return {}, "sku_duplicado"
            d["sku"] = sku
    if "ean" in p:
        ean = re.sub(r"\D", "", str(p["ean"] or ""))
        if ean and not ean_valido(ean):
            return {}, "ean_invalido"
        d["ean"] = ean or None
    for campo in ("marca", "fabricante", "fornecedor"):
        if campo in p:
            d[campo] = str(p[campo] or "").strip()[:80]
    if "unidade" in p:
        d["unidade"] = str(p["unidade"] or "un").strip()[:10] or "un"
    if "custo" in p:
        d["custo"] = sb.preco_para_valor(p["custo"]) if p["custo"] not in (None, "") else None
    for campo in ("estoque_minimo", "estoque_maximo"):
        if campo in p and p[campo] not in (None, ""):
            d[campo] = max(0, min(int(p[campo]), 99999))
    if "controla_estoque" in p:
        d["controla_estoque"] = 1 if p["controla_estoque"] else 0
    if "galeria" in p:
        d["galeria"] = json.dumps([str(u)[:500] for u in (p["galeria"] or []) if str(u).startswith("http")][:8])
    return d, None


def _salvar_loja(conn, pid: str, dados: dict[str, Any], produto: dict[str, Any] | None = None) -> None:
    _garantir_registro(conn, pid, produto, controla=bool(dados.get("controla_estoque")))
    if dados:
        conn.execute(f"UPDATE produto_estoque SET {', '.join(f'{k}=?' for k in dados)}, atualizado=? WHERE product_id=?",
                     (*dados.values(), time.time(), pid))


@bp.post("/api/loja/produtos")
def criar_produto():
    p = request.get_json(silent=True) or {}
    if not str(p.get("nome") or "").strip():
        return jsonify({"error": "nome_obrigatorio"}), 400
    with _db() as conn:
        dados, erro = _validar_loja(conn, None, p)
    if erro:
        return jsonify({"error": erro}), 400
    produto = sb.criar({k: v for k, v in p.items() if k not in CAMPOS_LOJA} | {"fonte": "manual", "estoque": 0})
    _invalidar_catalogo()
    pid = str(produto["id"])
    with _db() as conn:
        _salvar_loja(conn, pid, dados, produto)
        if not dados.get("sku"):
            conn.execute("UPDATE produto_estoque SET sku=? WHERE product_id=? AND sku IS NULL",
                         (_gerar_sku(conn, produto.get("categoria")), pid))
        inicial = int(p.get("estoque_inicial") or 0)
        if inicial > 0:
            movimentar(conn, pid, "entrada", inicial, "Estoque inicial do cadastro", p.get("lote") or "",
                       p.get("validade") or None, dados.get("custo"), usuario=p.get("usuario") or "")
    return jsonify(_detalhe(pid)), 201


@bp.put("/api/loja/produtos/<pid>")
def alterar_produto(pid: str):
    p = request.get_json(silent=True) or {}
    with _db() as conn:
        dados, erro = _validar_loja(conn, pid, p)
    if erro:
        return jsonify({"error": erro}), 400
    vitrine = {k: v for k, v in p.items() if k not in CAMPOS_LOJA and k not in ("estoque", "estoque_inicial")}
    if vitrine and sb.atualizar(pid, vitrine) is None:
        return jsonify({"error": "produto_nao_encontrado"}), 404
    _invalidar_catalogo()
    with _db() as conn:
        _salvar_loja(conn, pid, dados)
    return jsonify(_detalhe(pid))


@bp.delete("/api/loja/produtos/<pid>")
def remover_produto(pid: str):
    sb.remover(pid)
    _invalidar_catalogo()
    with _db() as conn:   # o histórico de movimentos fica (auditoria)
        conn.execute("DELETE FROM produto_estoque WHERE product_id=?", (pid,))
        conn.execute("DELETE FROM estoque_lotes WHERE product_id=?", (pid,))
    return jsonify({"ok": True})


@bp.post("/api/loja/imagem")
def enviar_imagem():
    """Foto enviada do computador: padroniza (fundo branco, recorte, nitidez) e sobe ao Storage."""
    arquivo = request.files.get("file")
    if not arquivo or not (arquivo.mimetype or "").startswith("image/"):
        return jsonify({"error": "imagem_invalida"}), 400
    conteudo = arquivo.read()
    if len(conteudo) > 15 * 1024 * 1024:
        return jsonify({"error": "imagem_grande_demais"}), 400
    nome, tipo = secure_filename(arquivo.filename or "foto.png"), arquivo.mimetype
    if request.args.get("melhorar", "1") != "0":
        try:
            import imagens
            conteudo, nome, tipo = imagens.melhorar(conteudo), "foto.webp", "image/webp"
        except Exception as exc:   # foto que o melhorador não abre: sobe a original
            print(f"[Loja] melhorador falhou ({exc}); enviando a original", flush=True)
    return jsonify({"url": sb.enviar_imagem(conteudo, nome, tipo)})


# ─── rotas: estoque ──────────────────────────────────────────────────────────
def _detalhe(pid: str) -> dict[str, Any] | None:
    with _db() as conn:
        linha = next((l for l in _linhas_estoque(conn) if l["id"] == pid), None)
        if linha is None:
            return None
        produto = _produto(pid) or {}
        lotes = [dict(r) for r in conn.execute(
            "SELECT * FROM estoque_lotes WHERE product_id=? AND quantidade>0 ORDER BY validade IS NULL, validade", (pid,))]
        movs = [dict(r) for r in conn.execute(
            "SELECT * FROM estoque_movimentos WHERE product_id=? ORDER BY ts DESC LIMIT 60", (pid,))]
    return {**linha, "produto": produto, "lotes": lotes, "movimentos": movs}


@bp.get("/api/estoque")
def listar_estoque():
    filtro = request.args.get("filtro", "todos")
    q = (request.args.get("q") or "").strip().lower()
    categoria = request.args.get("categoria") or ""
    with _db() as conn:
        linhas = _linhas_estoque(conn)
    if q:
        linhas = [l for l in linhas if q in (l["nome"] or "").lower() or q in (l["sku"] or "").lower()
                  or q in (l["ean"] or l["ean_sugerido"] or "") or q in (l["marca"] or "").lower()]
    if categoria:
        linhas = [l for l in linhas if l["categoria"] == categoria]
    filtros = {
        "controlados": lambda l: l["controla"], "sem_controle": lambda l: not l["controla"],
        "baixo": lambda l: l["status"] == "baixo", "zerado": lambda l: l["status"] == "zerado",
        "alerta": lambda l: l["status"] in ("baixo", "zerado") or l["vencido"] or l["vencendo"],
        "vencendo": lambda l: l["vencido"] or l["vencendo"], "repor": lambda l: l["sugestao_compra"] > 0,
        "inativos": lambda l: not l["active"],
    }
    if filtro in filtros:
        linhas = [l for l in linhas if filtros[filtro](l)]
    ordem = request.args.get("ordem", "nome")
    chaves = {"nome": lambda l: (l["nome"] or "").lower(), "disponivel": lambda l: (l["disponivel"], l["nome"] or ""),
              "validade": lambda l: (l["validade_proxima"] or "9999", l["nome"] or ""),
              "vendas": lambda l: (-l["vendas_30d"], l["nome"] or ""), "sku": lambda l: l["sku"] or "~"}
    linhas.sort(key=chaves.get(ordem, chaves["nome"]))
    limite = max(1, min(request.args.get("limite", 50, type=int), 500))
    offset = max(request.args.get("offset", 0, type=int), 0)
    return jsonify({"total": len(linhas), "itens": linhas[offset:offset + limite]})


@bp.get("/api/estoque/resumo")
def resumo():
    with _db() as conn:
        linhas = _linhas_estoque(conn)
        abertos = conn.execute(f"SELECT status, COUNT(*) AS n FROM pedidos WHERE status IN ({','.join('?' * len(ABERTOS))}) "
                               "GROUP BY status", ABERTOS).fetchall()
        hoje = time.mktime(date.today().timetuple())
        vendas_hoje = conn.execute("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS v FROM pedidos "
                                   "WHERE status='entregue' AND entregue_em>=?", (hoje,)).fetchone()
        movs_hoje = conn.execute("SELECT COUNT(*) FROM estoque_movimentos WHERE ts>=?", (hoje,)).fetchone()[0]
    ctrl = [l for l in linhas if l["controla"]]
    return jsonify({
        "produtos": len(linhas), "ativos": sum(1 for l in linhas if l["active"]), "controlados": len(ctrl),
        "unidades": sum(max(l["estoque"], 0) for l in ctrl),
        "valor_custo": round(sum(max(l["estoque"], 0) * (l["custo"] or 0) for l in ctrl), 2),
        "valor_venda": round(sum(max(l["estoque"], 0) * (l["preco"] or 0) for l in ctrl), 2),
        "sem_custo": sum(1 for l in ctrl if l["custo"] is None),
        "baixo": sum(1 for l in linhas if l["status"] == "baixo"),
        "zerado": sum(1 for l in linhas if l["status"] == "zerado"),
        "vencidos": sum(1 for l in linhas if l["vencido"]), "vencendo": sum(1 for l in linhas if l["vencendo"]),
        "repor": sum(1 for l in linhas if l["sugestao_compra"] > 0),
        "sem_ean": sum(1 for l in ctrl if not l["ean"]),
        "pedidos_abertos": {r["status"]: r["n"] for r in abertos},
        "vendas_hoje": {"pedidos": vendas_hoje["n"], "valor": round(vendas_hoje["v"], 2)},
        "movimentos_hoje": movs_hoje, "config": config(),
    })


@bp.get("/api/estoque/<pid>")
def detalhe(pid: str):
    d = _detalhe(pid)
    return (jsonify(d), 200) if d else (jsonify({"error": "produto_nao_encontrado"}), 404)


@bp.post("/api/estoque/<pid>/movimentos")
def novo_movimento(pid: str):
    p = request.get_json(silent=True) or {}
    if _produto(pid) is None:
        return jsonify({"error": "produto_nao_encontrado"}), 404
    validade = p.get("validade") or None
    if validade and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", validade):
        return jsonify({"error": "validade_invalida"}), 400
    try:
        with _db() as conn:
            _garantir_registro(conn, pid, controla=True)   # movimentar um produto liga o controle dele
            conn.execute("UPDATE produto_estoque SET controla_estoque=1 WHERE product_id=?", (pid,))
            r = movimentar(conn, pid, p.get("tipo"), int(p.get("quantidade") or 0), p.get("motivo") or "",
                           p.get("lote") or "", validade,
                           sb.preco_para_valor(p["custo_unit"]) if p.get("custo_unit") not in (None, "") else None,
                           usuario=p.get("usuario") or "")
    except (ErroEstoque, ValueError) as exc:
        return jsonify({"error": str(exc) if isinstance(exc, ErroEstoque) else "quantidade_invalida"}), 400
    return jsonify({**r, "produto": _detalhe(pid)})


@bp.post("/api/estoque/em-massa")
def em_massa():
    """Ações em vários produtos: controlar, parar de controlar, definir mínimo/máximo."""
    p = request.get_json(silent=True) or {}
    ids, acao = [str(i) for i in (p.get("ids") or [])][:1000], p.get("acao")
    if acao == "ean_sugerido":   # todos os produtos sem EAN que têm um EAN válido na descrição
        with _db() as conn:
            regs = {r["product_id"]: r for r in conn.execute("SELECT product_id, ean FROM produto_estoque")}
            usados = {r["ean"] for r in regs.values() if r["ean"]}
            n = 0
            for prod in _catalogo():
                pid, ean = str(prod["id"]), ean_do_texto(prod.get("uso"))
                if not ean or ean in usados or (regs.get(pid) and regs[pid]["ean"]):
                    continue
                reg = regs.get(pid) or _garantir_registro(conn, pid, prod)
                if not reg["ean"]:
                    conn.execute("UPDATE produto_estoque SET ean=?, atualizado=? WHERE product_id=?", (ean, time.time(), pid))
                usados.add(ean)
                n += 1
        return jsonify({"ok": True, "alterados": n})
    if not ids or acao not in {"controlar", "parar", "minimo", "maximo"}:
        return jsonify({"error": "acao_invalida"}), 400
    with _db() as conn:
        for pid in ids:
            _garantir_registro(conn, pid, controla=acao == "controlar")
            if acao in ("controlar", "parar"):
                conn.execute("UPDATE produto_estoque SET controla_estoque=?, atualizado=? WHERE product_id=?",
                             (1 if acao == "controlar" else 0, time.time(), pid))
            else:
                coluna = "estoque_minimo" if acao == "minimo" else "estoque_maximo"
                conn.execute(f"UPDATE produto_estoque SET {coluna}=?, atualizado=? WHERE product_id=?",
                             (max(0, int(p.get("valor") or 0)), time.time(), pid))
    return jsonify({"ok": True, "alterados": len(ids)})


@bp.get("/api/estoque/movimentos")
def historico_movimentos():
    dias = max(1, min(request.args.get("dias", 30, type=int), 365))
    tipo = request.args.get("tipo") or ""
    q = f"%{(request.args.get('q') or '').strip().lower()}%"
    sql = ("SELECT * FROM estoque_movimentos WHERE ts>=? AND (lower(nome) LIKE ? OR lower(COALESCE(sku,'')) LIKE ? "
           "OR lower(COALESCE(motivo,'')) LIKE ?)")
    params: list[Any] = [time.time() - dias * 86400, q, q, q]
    if tipo in TIPOS_MOV:
        sql += " AND tipo=?"
        params.append(tipo)
    with _db() as conn:
        linhas = [dict(r) for r in conn.execute(sql + " ORDER BY ts DESC LIMIT 1000", params)]
    totais = Counter()
    for m in linhas:
        totais[m["tipo"]] += abs(m["quantidade"])
    return jsonify({"itens": linhas, "totais": dict(totais)})


@bp.get("/api/estoque/lotes")
def lotes_validade():
    """Lotes com saldo e validade, do que vence primeiro ao que vence por último."""
    cfg = config()
    hoje, limite = date.today(), date.today() + timedelta(days=cfg["dias_alerta_validade"])
    with _db() as conn:
        lotes = [dict(r) for r in conn.execute(
            """SELECT l.*, e.sku FROM estoque_lotes l LEFT JOIN produto_estoque e ON e.product_id = l.product_id
               WHERE l.quantidade>0 ORDER BY l.validade IS NULL, l.validade""")]
    for l in lotes:
        p = _produto(l["product_id"]) or {}
        l["nome"], l["imgUrl"], l["preco"] = p.get("nome"), p.get("imgUrl"), p.get("precoValor")
        v = date.fromisoformat(l["validade"]) if l["validade"] else None
        l["dias"] = (v - hoje).days if v else None
        l["situacao"] = "sem_validade" if not v else "vencido" if v < hoje else "vencendo" if v <= limite else "ok"
    return jsonify({"dias_alerta": cfg["dias_alerta_validade"], "itens": lotes})


@bp.get("/api/estoque/relatorio")
def relatorio():
    """Curva ABC (faturamento dos pedidos entregues), giro e valor parado."""
    dias = max(7, min(request.args.get("dias", 90, type=int), 365))
    with _db() as conn:
        vendas = _vendas(conn, dias)
        linhas = {l["id"]: l for l in _linhas_estoque(conn)}
    total = sum(v["valor"] for v in vendas.values())
    acumulado, curva = 0.0, []
    for pid, v in sorted(vendas.items(), key=lambda kv: -kv[1]["valor"]):
        acumulado += v["valor"]
        pct = acumulado / total * 100 if total else 0
        l = linhas.get(pid, {})
        curva.append({"id": pid, "nome": l.get("nome") or pid, "sku": l.get("sku"), "qtd": int(v["qtd"]),
                      "valor": round(v["valor"], 2), "participacao": round(v["valor"] / total * 100, 1) if total else 0,
                      # A = até 80% do faturamento acumulado (o 1º item é sempre A), B = até 95%, C = o resto
                      "classe": "A" if pct <= 80 or not curva else "B" if pct <= 95 else "C"})
    parados = sorted([l for l in linhas.values() if l["controla"] and l["estoque"] > 0 and l["id"] not in vendas],
                     key=lambda l: -(l["estoque"] * (l["custo"] or l["preco"] or 0)))[:20]
    return jsonify({
        "dias": dias, "faturamento": round(total, 2), "curva": curva,
        "classes": dict(Counter(c["classe"] for c in curva)),
        "parados": [{"id": l["id"], "nome": l["nome"], "sku": l["sku"], "estoque": l["estoque"],
                     "valor": round(l["estoque"] * (l["custo"] or l["preco"] or 0), 2)} for l in parados],
    })


@bp.get("/api/estoque/exportar.csv")
def exportar():
    with _db() as conn:
        linhas = _linhas_estoque(conn)
    campos = ["id", "sku", "ean", "nome", "marca", "categoria", "controla", "estoque", "reservado", "disponivel",
              "minimo", "maximo", "custo", "preco", "margem", "validade_proxima", "vendas_30d", "sugestao_compra", "local"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=campos, delimiter=";", extrasaction="ignore")
    w.writeheader()
    for l in linhas:
        w.writerow({**l, "controla": "sim" if l["controla"] else "nao"})
    nome = f"flexmed-estoque-{date.today().isoformat()}.csv"
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@bp.post("/api/estoque/importar")
def importar():
    """CSV (; ou ,) com id, sku ou ean + colunas a atualizar: estoque (contagem), minimo, maximo, custo, marca, ean."""
    texto = request.get_data(as_text=True) or ""
    if request.files.get("file"):
        texto = request.files["file"].read().decode("utf-8-sig", errors="replace")
    texto = texto.lstrip("﻿")
    if not texto.strip():
        return jsonify({"error": "arquivo_vazio"}), 400
    dialeto = ";" if texto.splitlines()[0].count(";") >= texto.splitlines()[0].count(",") else ","
    leitor = csv.DictReader(io.StringIO(texto), delimiter=dialeto)
    usuario = request.args.get("usuario", "")
    ok, erros = 0, []
    with _db() as conn:
        por_sku = {r["sku"]: r["product_id"] for r in conn.execute("SELECT sku, product_id FROM produto_estoque") if r["sku"]}
        por_ean = {r["ean"]: r["product_id"] for r in conn.execute("SELECT ean, product_id FROM produto_estoque") if r["ean"]}
        ids = {str(p["id"]) for p in _catalogo()}
        for n, linha in enumerate(leitor, start=2):
            linha = {(k or "").strip().lower(): (v or "").strip() for k, v in linha.items()}
            pid = linha.get("id") if linha.get("id") in ids else por_sku.get(linha.get("sku", "").upper()) \
                or por_ean.get(re.sub(r"\D", "", linha.get("ean", "")))
            if not pid:
                erros.append(f"linha {n}: produto não encontrado")
                continue
            try:
                dados, erro = _validar_loja(conn, pid, {k: linha[k] for k in ("marca", "custo", "ean") if linha.get(k)}
                                            | {f"estoque_{k}": linha[k] for k in ("minimo", "maximo") if linha.get(k)})
                if erro:
                    raise ErroEstoque(erro)
                _salvar_loja(conn, pid, dados)
                if linha.get("estoque") not in (None, ""):
                    movimentar(conn, pid, "ajuste", int(float(linha["estoque"].replace(",", "."))),
                               "Importação de planilha", usuario=usuario)
                ok += 1
            except (ErroEstoque, ValueError) as exc:
                erros.append(f"linha {n}: {exc}")
    return jsonify({"atualizados": ok, "erros": erros[:50]})


# ─── rotas: pedidos (totem -> balcão) ────────────────────────────────────────
def _codigo(conn) -> str:
    while True:
        codigo = "".join(secrets.choice("ACDEFHJKMNPRTUVWXY") for _ in range(2)) + str(secrets.randbelow(90) + 10)
        if not conn.execute("SELECT 1 FROM pedidos WHERE codigo=? AND criado>?", (codigo, time.time() - 86400)).fetchone():
            return codigo


def _pedido(conn, pid: str) -> dict[str, Any] | None:
    p = conn.execute("SELECT * FROM pedidos WHERE id=?", (pid,)).fetchone()
    if not p:
        return None
    itens = [dict(r) for r in conn.execute("SELECT * FROM pedido_itens WHERE pedido_id=? ORDER BY id", (pid,))]
    for i in itens:
        prod = _produto(i["product_id"]) or {}
        i["imgUrl"], i["local"] = prod.get("imgUrl"), prod.get("local")
    return {**dict(p), "lista": itens}


@bp.post("/api/pedidos")
def criar_pedido():
    p = request.get_json(silent=True) or {}
    itens = [(str(i.get("id")), max(1, min(int(i.get("qtd") or 1), 99))) for i in (p.get("itens") or [])[:50] if i.get("id")]
    if not itens:
        return jsonify({"error": "pedido_vazio"}), 400
    agora = time.time()
    with _db() as conn:
        reservados = _reservados(conn)
        regs = {r["product_id"]: r for r in conn.execute("SELECT * FROM produto_estoque")}
        pid, codigo, linhas, total, faltas = secrets.token_hex(8), _codigo(conn), [], 0.0, 0
        for prod_id, qtd in itens:
            prod = _produto(prod_id) or {}
            r = regs.get(prod_id)
            faltou = bool(r and r["controla_estoque"] and r["estoque"] - reservados.get(prod_id, 0) < qtd)
            faltas += faltou
            preco = prod.get("precoValor")
            total += (preco or 0) * qtd
            linhas.append((pid, prod_id, prod.get("nome") or prod_id, r["sku"] if r else None, qtd, preco, int(faltou)))
        conn.execute("INSERT INTO pedidos (id, codigo, sessao_id, status, itens, total, criado, atualizado) "
                     "VALUES (?,?,?,?,?,?,?,?)", (pid, codigo, str(p.get("sessao_id") or "")[:64] or None, "novo",
                                                  sum(q for _, q in itens), round(total, 2), agora, agora))
        conn.executemany("INSERT INTO pedido_itens (pedido_id, product_id, nome, sku, qtd, preco_unit, faltou) "
                         "VALUES (?,?,?,?,?,?,?)", linhas)
    return jsonify({"id": pid, "codigo": codigo, "total": round(total, 2), "itens_em_falta": faltas}), 201


@bp.get("/api/pedidos")
def listar_pedidos():
    dias = max(1, min(request.args.get("dias", 2, type=int), 90))
    status = [s for s in (request.args.get("status") or "").split(",") if s in STATUS_PEDIDO]
    sql, params = "SELECT id FROM pedidos WHERE (criado>=? OR status IN ('novo','separando','pronto'))", [time.time() - dias * 86400]
    if status:
        sql += f" AND status IN ({','.join('?' * len(status))})"
        params += status
    with _db() as conn:
        pedidos = [_pedido(conn, r["id"]) for r in conn.execute(sql + " ORDER BY criado DESC LIMIT 300", params)]
        contagem = dict(Counter(r["status"] for r in conn.execute(
            "SELECT status FROM pedidos WHERE criado>=? OR status IN ('novo','separando','pronto')", (params[0],))))
    return jsonify({"itens": pedidos, "contagem": contagem})


@bp.get("/api/pedidos/contagem")
def contagem_pedidos():
    with _db() as conn:
        novos = conn.execute("SELECT COUNT(*) FROM pedidos WHERE status='novo'").fetchone()[0]
        abertos = conn.execute("SELECT COUNT(*) FROM pedidos WHERE status IN ('novo','separando','pronto')").fetchone()[0]
        ultimo = conn.execute("SELECT MAX(criado) FROM pedidos").fetchone()[0]
        alertas = sum(1 for l in _linhas_estoque(conn) if l["status"] in ("baixo", "zerado") or l["vencido"])
    return jsonify({"novos": novos, "abertos": abertos, "ultimo": ultimo, "alertas_estoque": alertas})


@bp.patch("/api/pedidos/<pid>")
def atualizar_pedido(pid: str):
    p = request.get_json(silent=True) or {}
    novo = p.get("status")
    with _db() as conn:
        atual = conn.execute("SELECT * FROM pedidos WHERE id=?", (pid,)).fetchone()
        if not atual:
            return jsonify({"error": "pedido_nao_encontrado"}), 404
        agora = time.time()
        if novo and novo != atual["status"]:
            if novo not in PROXIMOS.get(atual["status"], set()):
                return jsonify({"error": "status_invalido"}), 400
            if novo == "entregue":   # venda: baixa o estoque dos itens controlados
                regs = {r["product_id"]: r for r in conn.execute("SELECT product_id, controla_estoque FROM produto_estoque")}
                for i in conn.execute("SELECT * FROM pedido_itens WHERE pedido_id=?", (pid,)).fetchall():
                    r = regs.get(i["product_id"])
                    if r and r["controla_estoque"]:
                        movimentar(conn, i["product_id"], "venda", i["qtd"], f"Pedido {atual['codigo']}",
                                   pedido_id=pid, usuario=p.get("usuario") or "", parcial=True)
            conn.execute("UPDATE pedidos SET status=?, atualizado=?, entregue_em=? WHERE id=?",
                         (novo, agora, agora if novo == "entregue" else None, pid))
        if "observacao" in p:
            conn.execute("UPDATE pedidos SET observacao=?, atualizado=? WHERE id=?",
                         (str(p["observacao"] or "")[:300], agora, pid))
        return jsonify(_pedido(conn, pid))


# ─── leitor de código de barras e operações em lote ─────────────────────────
def _por_codigo(conn, codigo: str) -> dict[str, Any] | None:
    """Produto pelo EAN (cadastrado ou achado na descrição) ou pelo SKU."""
    codigo = (codigo or "").strip()
    if not codigo:
        return None
    digitos = re.sub(r"\D", "", codigo)
    r = conn.execute("SELECT product_id FROM produto_estoque WHERE ean=? OR upper(sku)=?",
                     (digitos or None, codigo.upper())).fetchone()
    if r:
        return _produto(r["product_id"])
    if digitos:
        return next((p for p in _catalogo() if ean_do_texto(p.get("uso")) == digitos), None)
    return None


@bp.get("/api/estoque/codigo/<codigo>")
def buscar_codigo(codigo: str):
    digitos = re.sub(r"\D", "", codigo)
    with _db() as conn:
        p = _por_codigo(conn, codigo)
    if not p:
        return jsonify({"error": "nao_encontrado", "codigo": codigo,
                        "ean_valido": ean_valido(digitos) if digitos else False}), 404
    return jsonify(_detalhe(str(p["id"])))


@bp.post("/api/loja/produtos/lote")
def criar_lote():
    """Cadastro de vários produtos de uma vez (grade do admin ou planilha colada)."""
    itens = (request.get_json(silent=True) or {}).get("itens") or []
    usuario = (request.get_json(silent=True) or {}).get("usuario") or ""
    resultados = []
    for n, it in enumerate(itens[:200], start=1):
        nome = str(it.get("nome") or "").strip()
        if not nome:
            resultados.append({"linha": n, "ok": False, "erro": "nome_obrigatorio"})
            continue
        try:
            with _db() as conn:
                dados, erro = _validar_loja(conn, None, {k: it.get(k) for k in ("ean", "marca", "custo", "sku") if it.get(k)})
                if not erro and dados.get("ean") and _por_codigo(conn, dados["ean"]):
                    erro = "ean_ja_cadastrado"
            if erro:
                resultados.append({"linha": n, "ok": False, "erro": erro, "nome": nome})
                continue
            preco = sb.preco_para_valor(it.get("preco")) if it.get("preco") not in (None, "") else None
            produto = sb.criar({"nome": nome, "categoria": it.get("categoria") or "outros", "tipo": it.get("categoria") or "outros",
                                "uso": it.get("uso") or "", "precoValor": preco,
                                "preco": sb.formatar_preco(preco) if preco is not None else "",
                                "precoOriginal": sb.preco_para_valor(it.get("precoOriginal")) if it.get("precoOriginal") else None,
                                "local": it.get("local") or "", "fonte": "manual", "estoque": 0, "active": True})
            pid = str(produto["id"])
            inicial = int(float(str(it.get("estoque_inicial") or 0).replace(",", ".")) or 0)
            with _db() as conn:
                _salvar_loja(conn, pid, {**dados, "controla_estoque": 1}, produto)   # produto: SKU com o prefixo da categoria
                if inicial > 0:
                    movimentar(conn, pid, "entrada", inicial, "Cadastro em lote", it.get("lote") or "",
                               it.get("validade") or None, dados.get("custo"), usuario=usuario)
                sku = _registro(conn, pid)["sku"]
            resultados.append({"linha": n, "ok": True, "id": pid, "nome": nome, "sku": sku})
        except (sb.SupabaseError, ErroEstoque, ValueError) as exc:
            resultados.append({"linha": n, "ok": False, "erro": str(exc)[:120], "nome": nome})
    _invalidar_catalogo()
    return jsonify({"criados": sum(r["ok"] for r in resultados), "resultados": resultados})


@bp.post("/api/estoque/entrada-lote")
def entrada_lote():
    """Recebimento de mercadoria: várias entradas (ex.: uma nota fiscal) numa única transação."""
    p = request.get_json(silent=True) or {}
    itens, motivo = (p.get("itens") or [])[:300], str(p.get("motivo") or "Recebimento de mercadoria")[:160]
    if not itens:
        return jsonify({"error": "lista_vazia"}), 400
    try:
        with _db() as conn:
            saida = []
            for it in itens:
                pid = str(it.get("id") or "")
                if _produto(pid) is None:
                    raise ErroEstoque(f"produto_nao_encontrado:{pid}")
                _garantir_registro(conn, pid, controla=True)
                conn.execute("UPDATE produto_estoque SET controla_estoque=1 WHERE product_id=?", (pid,))
                validade = it.get("validade") or None
                if validade and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", validade):
                    raise ErroEstoque("validade_invalida")
                custo = sb.preco_para_valor(it["custo_unit"]) if it.get("custo_unit") not in (None, "") else None
                r = movimentar(conn, pid, "entrada", int(it.get("quantidade") or 0), motivo, it.get("lote") or "",
                               validade, custo, usuario=p.get("usuario") or "")
                saida.append({"id": pid, "saldo": r["saldo"]})
    except (ErroEstoque, ValueError) as exc:   # nada é gravado se uma linha falhar
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "itens": saida, "unidades": sum(int(i.get("quantidade") or 0) for i in itens)})
