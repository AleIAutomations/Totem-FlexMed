"""Recomendações da página do produto.

- "Leve junto": produtos que complementam o que a pessoa está vendo
  (ex.: protetor solar -> hidratante; shampoo -> condicionador; antigripal ->
  vitamina C). Primeiro por palavras do nome, depois por categorias afins.
- "Parecidos": outros da mesma categoria, os do mesmo tipo primeiro.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Callable

# Palavra no nome do produto -> termos a buscar para levar junto
COMPLEMENTOS_POR_NOME = [
    (r"protetor solar|bloqueador|fps", ["hidratante", "protetor labial", "pós-sol"]),
    (r"shampoo", ["condicionador", "creme para pentear"]),
    (r"condicionador", ["shampoo", "creme para pentear"]),
    (r"escova dental|escova de dente", ["creme dental", "fio dental", "enxaguante"]),
    (r"creme dental|pasta de dente", ["escova dental", "fio dental", "enxaguante"]),
    (r"fralda", ["lenço umedecido", "pomada", "sabonete"]),
    (r"sabonete", ["hidratante", "desodorante"]),
    (r"desodorante", ["sabonete", "hidratante"]),
    (r"curativo|band|gaze|esparadrapo", ["antisséptico", "soro fisiológico", "algodão"]),
    (r"antigrip|gripe|resfriado", ["vitamina c", "soro fisiológico", "pastilha"]),
    (r"xarope|tosse", ["pastilha", "vitamina c", "mel"]),
    (r"antibiotic|amoxicilina|azitromicina|cefalexina", ["probiótico", "protetor gástrico"]),
    (r"repelente", ["protetor solar", "pós-sol"]),
    (r"whey|proteina|creatina", ["coqueteleira", "barra de proteína"]),
]

# Categoria principal -> termos de produtos que costumam ir junto
COMPLEMENTOS_POR_CATEGORIA = {
    "analgesico": ["vitamina c", "pastilha", "antigripal", "soro fisiológico"],
    "alergias": ["soro fisiológico", "vitamina c", "pastilha", "lenço"],
    "antibiotico": ["probiótico", "simeticona", "vitamina c"],
    "gastro": ["probiótico", "simeticona", "sal de frutas"],
    "coracao": ["ômega 3", "coenzima", "magnésio"],
    "diabetes": ["adoçante", "hidratante", "ômega 3"],
    "sistema_nervoso": ["melatonina", "magnésio", "ômega 3"],
    "saude_mulher": ["absorvente", "sabonete íntimo", "vitamina d"],
    "dermato": ["protetor solar", "água micelar", "hidratante labial", "sabonete facial"],
    "cuidados": ["hidratante", "desodorante", "protetor solar"],
    "infantil": ["lenço umedecido", "assadura", "sabonete infantil", "repelente"],
    "vitaminas": ["colágeno", "ômega 3", "vitamina c", "vitamina d"],
    "primeiros_socorros": ["antisséptico", "gaze", "esparadrapo", "soro fisiológico"],
    "outros": ["vitamina c", "hidratante"],
}


# Nunca sugerir para "levar junto" (fora de contexto ou exige decisão própria)
NAO_SUGERIR = re.compile(r"nicotin|fumagum|nicorette|preservativo|teste de gravidez|anticoncepc")

# Palavras genéricas que não identificam marca/linha do produto
GENERICAS = set("""
com sem para mais kids baby infantil adulto creme gel spray loção locao liquido liquida
comprimidos comprimido capsulas capsula gotas sabor unidades unidade frasco tubo pote
""".split())


def _norm(texto: str) -> str:
    return unicodedata.normalize("NFD", (texto or "").lower()).encode("ascii", "ignore").decode()


def recomendar(produto: dict[str, Any], listar: Callable[..., tuple[list[dict[str, Any]], int]],
               limite: int = 8) -> dict[str, list[dict[str, Any]]]:
    """`listar` é supabase_products.listar."""
    pid = str(produto["id"])
    nome = _norm(produto.get("nome", ""))
    categoria = produto.get("categoria") or ""
    tipo = produto.get("tipo") or ""

    # Parecidos: mesma categoria, mesmo tipo primeiro
    parecidos = [p for p in listar(categoria=categoria, limit=40)[0] if str(p["id"]) != pid] if categoria else []
    parecidos.sort(key=lambda p: (p.get("tipo") != tipo, p.get("nome", "")))
    parecidos = parecidos[:limite]

    # Leve junto: complementos pelo nome, depois por categorias afins
    ja = {pid} | {str(p["id"]) for p in parecidos}
    junto: list[dict[str, Any]] = []

    tipo_norm = _norm(tipo)
    # palavras que identificam marca/linha ("Palmolive", "Naturals"): mesma marca primeiro
    marca = {w for w in re.findall(r"[a-z]{4,}", nome) if w not in GENERICAS}

    def afinidade(p: dict[str, Any]) -> tuple[int, float]:
        mesmas = len(marca & set(re.findall(r"[a-z]{4,}", _norm(p.get("nome", "")))))
        return (-mesmas, p.get("precoValor") or 9e9)   # mesma marca, depois mais barato

    def adicionar(itens: list[dict[str, Any]], maximo: int) -> None:
        # até `maximo` itens novos, de outro tipo (não é "levar junto" mais do mesmo)
        for p in sorted(itens, key=afinidade):
            if len(junto) >= limite or maximo <= 0:
                return
            if (str(p["id"]) not in ja and _norm(p.get("tipo") or "") != tipo_norm
                    and not NAO_SUGERIR.search(_norm(p.get("nome", "")))):
                ja.add(str(p["id"]))
                junto.append(p)
                maximo -= 1

    termos = [t for padrao, ts in COMPLEMENTOS_POR_NOME if re.search(padrao, nome) for t in ts]
    termos += COMPLEMENTOS_POR_CATEGORIA.get(categoria, ["vitamina c"])
    for termo in dict.fromkeys(termos):     # sem repetir termos
        if len(junto) >= limite:
            break
        adicionar(listar(q=termo, limit=8)[0], 2)

    return {"levar_junto": junto, "parecidos": parecidos}
