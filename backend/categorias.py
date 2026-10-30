"""Categorias principais do catálogo (os chips do totem) e a classificação dos
produtos importados nelas.

As fontes (ex.: Ultrafarma) têm uma árvore própria e detalhada
(departamento > categoria > tipo); aqui ela é condensada em poucas categorias
úteis numa farmácia. O tipo específico continua salvo em products.tipo.
"""
from __future__ import annotations

import unicodedata

# (slug, nome) — a ordem é a dos chips no totem
CATEGORIAS = [
    ("analgesico", "Analgésicos"),
    ("antibiotico", "Antibióticos"),
    ("alergias", "Alergias e Gripes"),
    ("vitaminas", "Vitaminas e Suplementos"),
    ("diabetes", "Diabetes"),
    ("coracao", "Coração e Pressão"),
    ("sistema_nervoso", "Sistema Nervoso"),
    ("gastro", "Estômago e Intestino"),
    ("saude_mulher", "Saúde da Mulher"),
    ("dermato", "Dermocosméticos"),
    ("infantil", "Infantil"),
    ("cuidados", "Higiene e Cuidados"),
    ("primeiros_socorros", "Primeiros Socorros"),
    ("outros", "Outros"),
]
NOMES = dict(CATEGORIAS)

# Nichos (primeiro nível de navegação no totem) e as categorias de cada um
NICHOS = [
    ("medicamentos", "Medicamentos", ["analgesico", "antibiotico", "alergias", "diabetes", "coracao",
                                      "sistema_nervoso", "gastro", "saude_mulher"]),
    ("beleza", "Beleza", ["dermato"]),
    ("higiene", "Higiene e Cuidados", ["cuidados"]),
    ("infantil", "Infantil", ["infantil"]),
    ("bem_estar", "Saúde e Bem-estar", ["vitaminas", "primeiros_socorros", "outros"]),
]
NICHO_DA_CATEGORIA = {cat: slug for slug, _, cats in NICHOS for cat in cats}
CATEGORIAS_DO_NICHO = {slug: cats for slug, _, cats in NICHOS}

# Regras em ordem de prioridade: (categoria, palavras-chave). A primeira regra
# com alguma palavra presente no texto (departamento + categoria + tipo) vence.
REGRAS = [
    ("infantil", ["dept:infantil", "infantil", "bebe", "pediatr"]),
    ("antibiotico", ["antibiotic"]),
    ("analgesico", ["dor e contusao", "analgesic", "antitermic", "anti-inflamator", "antiinflamator",
                    "enxaqueca", "relaxante muscular", "relaxantes muscular"]),
    ("alergias", ["alergia", "antialerg", "gripe", "antigrip", "resfriado", "descongestion",
                  "asma", "respirator", "tosse", "garganta", "dermatite"]),
    ("diabetes", ["diabete", "alimentos diet", "adocante", "glicem"]),
    ("coracao", ["pressao alta", "anti-hipertens", "antihipertens", "circulacao", "cardiovascul",
                 "colesterol", "triglicer", "trombose", "varize"]),
    ("sistema_nervoso", ["sistema nervoso", "calmante", "ansied", "depressao", "antipsicot",
                         "convulsao", "epilepsia", "insonia", "distubios cerebrais", "disturbios cerebrais"]),
    ("gastro", ["gastrointestin", "antiacid", "intestin", "hepatic", "figado", "laxant", "azia",
                "enjoo", "estomago"]),
    ("saude_mulher", ["saude da mulher", "anticoncepc", "ovulos vaginais", "menopausa", "gravidez",
                      "teste de gravidez"]),
    ("vitaminas", ["vitamina", "suplement", "sports nutrition", "articulac", "colageno", "anemia",
                   "omega", "minerais", "dept:saude e bem-estar>alimentos", "proteina", "whey"]),
    ("primeiros_socorros", ["primeiros-socorros", "primeiros socorros", "curativo", "antissept",
                            "esparadrapo", "gaze", "termometro"]),
    ("dermato", ["dept:beleza", "dermocosmet", "protetor solar", "bloqueador", "cuidados com o sol",
                 "antiidade", "anti-idade", "acne"]),
    ("cuidados", ["dept:cuidados diarios", "higiene", "sabonete", "shampoo", "condicionador",
                  "desodorante", "creme dental", "escova", "enxaguator", "absorvente", "fralda",
                  "preservativo", "lubrificante intimo", "barba", "cabelo", "repelente", "talco"]),
]


def _norm(texto: str | None) -> str:
    texto = unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode()
    return " ".join(texto.lower().split())


def classificar(departamento: str = "", grupo: str = "", tipo: str = "", nome: str = "") -> str:
    """Devolve o slug da categoria principal de um produto."""
    dep = _norm(departamento)
    # 1º pela árvore da fonte; o nome só desempata quando ela não basta
    # (ex.: "Água Micelar ... Vitamina C" é dermocosmético, não vitamina)
    arvore = " | ".join([f"dept:{dep}", f"dept:{dep}>{_norm(grupo)}", _norm(grupo), _norm(tipo)])
    for texto in (arvore, _norm(nome)):
        for slug, palavras in REGRAS:
            if any(p in texto for p in palavras):
                return slug
    return "outros"
