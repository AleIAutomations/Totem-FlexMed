"""Produtos no Supabase (PostgREST + Storage) usando a secret key do backend.

As colunas da tabela `products` têm os mesmos nomes do JSON da API do FlexMed
(nome, uso, preco, imgUrl, estoqueMax...), então o mapeamento é quase direto.
"""
from __future__ import annotations

import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
BUCKET = os.getenv("SUPABASE_BUCKET", "produtos")
TIMEOUT = 30
TENTATIVAS = 3  # rede/Supabase instável: repete antes de desistir

# campo da API -> aliases aceitos no payload (admin usa nomes em inglês)
CAMPOS: dict[str, tuple[str, ...]] = {
    "nome": ("name",),
    "tipo": ("cat",),
    "categoria": (),
    "uso": ("use", "descricao", "description"),
    "indicacoes": (),
    "receita": ("rx",),
    "estoque": ("stock",),
    "estoqueMax": ("stockMax",),
    "local": (),
    "locaisDisponiveis": (),
    "info": (),
    "dicaIA": (),
    "preco": ("price",),
    "precoValor": (),
    "precoOriginal": ("preco_original",),
    "categoriaId": (),
    "fonte": (),
    "fonteUrl": (),
    "imgUrl": ("imagem_url", "image_url"),
    "imgIndex": (),
    "destaque": (),
    "active": (),
}
INTEIROS = {"estoque", "estoqueMax", "imgIndex", "categoriaId"}
BOOLEANOS = {"receita", "destaque", "active"}
LISTAS = {"indicacoes", "locaisDisponiveis"}


class SupabaseError(RuntimeError):
    pass


def configurado() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    h.update(extra or {})
    return h


def _check(res: requests.Response) -> Any:
    if res.status_code >= 400:
        raise SupabaseError(f"{res.status_code}: {res.text[:300]}")
    return res.json() if res.text else None


def _request(method: str, tabela: str, params: dict[str, str] | None = None, json: Any = None,
             prefer: str = "") -> requests.Response:
    extra = {"Prefer": prefer} if prefer else {}
    for tentativa in range(TENTATIVAS):
        try:
            res = requests.request(
                method, f"{SUPABASE_URL}/rest/v1/{tabela}", params=params, json=json,
                headers=_headers(extra), timeout=TIMEOUT,
            )
            break
        except (requests.ConnectionError, requests.Timeout):
            if tentativa == TENTATIVAS - 1:
                raise
            time.sleep(2 * (tentativa + 1))
    _check(res)
    return res


def _rest(method: str, params: dict[str, str] | None = None, json: Any = None, prefer: str = "",
          tabela: str = "products") -> Any:
    res = _request(method, tabela, params, json, prefer)
    return res.json() if res.text else None


def preco_para_valor(texto: Any) -> float | None:
    """'R$ 1.234,90' -> 1234.9; textos sem número ('Sob receita') -> None."""
    if isinstance(texto, (int, float)):
        return float(texto)
    m = re.search(r"\d[\d.]*,\d{2}|\d+(?:\.\d{2})?", str(texto or ""))
    if not m:
        return None
    num = m.group(0)
    return float(num.replace(".", "").replace(",", ".")) if "," in num else float(num)


def formatar_preco(valor: float) -> str:
    return "R$ " + f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _normalizar(payload: dict[str, Any], parcial: bool) -> dict[str, Any]:
    """Converte o payload da API para colunas. Em `parcial`, só os campos enviados."""
    row: dict[str, Any] = {}
    for campo, aliases in CAMPOS.items():
        chave = next((k for k in (campo, *aliases) if k in payload), None)
        if chave is None:
            continue
        valor = payload[chave]
        if campo in INTEIROS:
            valor = int(valor) if valor not in (None, "") else (None if campo == "imgIndex" else 0)
        elif campo in BOOLEANOS:
            valor = bool(valor)
        elif campo in ("precoValor", "precoOriginal"):
            valor = preco_para_valor(valor) if valor not in (None, "") else None
        elif campo in LISTAS:
            valor = [str(v) for v in (valor or [])]
        else:
            valor = "" if valor is None else str(valor)
        row[campo] = valor
    if "preco" in row and "precoValor" not in row:
        row["precoValor"] = preco_para_valor(row["preco"])
    if not parcial:
        row.setdefault("nome", "Produto sem nome")
        row.setdefault("categoria", row.get("tipo") or "outros")
        row.setdefault("tipo", row["categoria"])
        if "estoqueMax" not in row and "estoque" in row:
            row["estoqueMax"] = row["estoque"]
        if not row.get("locaisDisponiveis") and row.get("local"):
            row["locaisDisponiveis"] = [row["local"]]
    return row


def _para_api(row: dict[str, Any]) -> dict[str, Any]:
    d = dict(row)
    d["indicacoes"] = d.get("indicacoes") or []
    d["locaisDisponiveis"] = d.get("locaisDisponiveis") or []
    d["active"] = d.get("active", True) is not False
    if d.get("precoOriginal") is not None:
        d["precoOriginal"] = float(d["precoOriginal"])
    if d.get("precoValor") is not None:
        d["precoValor"] = float(d["precoValor"])
        d["preco"] = formatar_preco(d["precoValor"])
    d["created_at"] = d.get("createdAt")
    d["updated_at"] = d.get("updatedAt")
    return d


def listar(q: str = "", categoria: str = "", only_active: bool = True,
           limit: int | None = None, offset: int = 0,
           todos_termos: list[str] | None = None,
           excluir_ids: list[str] | None = None) -> tuple[list[dict[str, Any]], int]:
    """Retorna (produtos da página, total que bate com o filtro).
    `todos_termos`: cada termo precisa aparecer (em nome, uso, categoria ou tipo)."""
    params = {"select": "*", "order": "nome.asc,id.asc"}
    if limit is not None:
        params["limit"] = str(limit)
        params["offset"] = str(offset)
    if only_active:
        params["active"] = "is.true"
    if excluir_ids:
        params["id"] = f"not.in.({','.join(excluir_ids)})"
    if categoria and "," in categoria:          # várias categorias (ex.: um nicho inteiro)
        params["categoria"] = f"in.({categoria})"
    elif categoria:
        params["categoria"] = f"ilike.{categoria}"
    if todos_termos:
        partes = []
        for t in todos_termos:
            t = re.sub(r'[,()"\\*%]', " ", t).strip()
            if t:
                like = f'"*{t}*"'
                partes.append(f"or(nome.ilike.{like},uso.ilike.{like},categoria.ilike.{like},tipo.ilike.{like})")
        if partes:
            params["and"] = f"({','.join(partes)})"
    q = re.sub(r'[,()"\\*%]', " ", q).strip()
    if q:
        like = f'"*{q}*"'
        params["or"] = f"(nome.ilike.{like},uso.ilike.{like},categoria.ilike.{like},tipo.ilike.{like})"
    res = _request("GET", "products", params=params, prefer="count=exact")
    total = res.headers.get("Content-Range", "*/0").split("/")[-1]
    itens = [_para_api(r) for r in res.json()]
    return itens, int(total) if total.isdigit() else len(itens)


def coluna_existe(coluna: str) -> bool:
    try:
        _rest("GET", params={"select": coluna, "limit": "1"})
        return True
    except SupabaseError:
        return False


def listar_categorias(somente_com_produtos: bool = False) -> list[dict[str, Any]]:
    params = {"select": "id,slug,nome,products(count)", "order": "nome.asc"}
    cats = _rest("GET", params=params, tabela="categorias")
    for c in cats:
        c["total"] = (c.pop("products", None) or [{"count": 0}])[0]["count"]
    if somente_com_produtos:
        cats = [c for c in cats if c["total"] > 0]
    return cats


def garantir_categoria(slug: str, nome: str) -> int:
    rows = _rest("POST", params={"on_conflict": "slug"}, json={"slug": slug, "nome": nome},
                 prefer="resolution=merge-duplicates,return=representation", tabela="categorias")
    return int(rows[0]["id"])


def buscar_por(coluna: str, valor: str) -> dict[str, Any] | None:
    rows = _rest("GET", params={"select": "*", coluna: f"eq.{valor}", "limit": "1"})
    return rows[0] if rows else None


def iniciar_coleta(fonte: str) -> int:
    return int(_rest("POST", json={"fonte": fonte}, prefer="return=representation", tabela="coletas")[0]["id"])


def finalizar_coleta(coleta_id: int, status: str, total: int, erro: str | None = None) -> None:
    _rest("PATCH", params={"id": f"eq.{coleta_id}"}, tabela="coletas",
          json={"status": status, "total": total, "erro": erro, "finalizada_em": datetime.now(timezone.utc).isoformat()})


def registrar_preco(product_id: str, preco: float, coleta_id: int | None) -> None:
    _rest("POST", tabela="historico_precos",
          json={"product_id": product_id, "preco": preco, "coleta_id": coleta_id})


def criar(payload: dict[str, Any]) -> dict[str, Any]:
    rows = _rest("POST", json=_normalizar(payload, parcial=False), prefer="return=representation")
    return _para_api(rows[0])


def atualizar(pid: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = _normalizar(payload, parcial=True)
    if not row:
        rows = _rest("GET", params={"select": "*", "id": f"eq.{pid}"})
    else:
        rows = _rest("PATCH", params={"id": f"eq.{pid}"}, json=row, prefer="return=representation")
    return _para_api(rows[0]) if rows else None


def remover(pid: str) -> None:
    _rest("DELETE", params={"id": f"eq.{pid}"})


def enviar_imagem(conteudo: bytes, nome_arquivo: str, content_type: str) -> str:
    """Sobe a imagem para o bucket público e devolve a URL pública."""
    ext = os.path.splitext(nome_arquivo)[1].lower() or ".png"
    caminho = f"{uuid.uuid4().hex}{ext}"
    res = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{caminho}", data=conteudo,
        headers=_headers({"Content-Type": content_type or "application/octet-stream"}),
        timeout=60,
    )
    _check(res)
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{caminho}"
