"""Coleta produtos da Ultrafarma (nome, descrição, tipo, preço e foto).

Respeita o robots.txt (não acessa /api/), descobre os produtos pelo sitemap
público e faz no máximo 1 requisição por segundo. Os dados vêm do JSON-LD
(schema.org/Product) e do breadcrumb de cada página de produto.

Saída: produtos_ultrafarma.json no formato lido por
backend/supabase/importar_produtos.py.

Uso:
    python scraper_ultrafarma.py --limite 300            # amostra
    python scraper_ultrafarma.py --limite 0              # catálogo inteiro (~5 h)
    python scraper_ultrafarma.py --limite 300 --importar # coleta e grava no Supabase
"""
from __future__ import annotations

import argparse
import html
import json
import logging
import os
import random
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime

import requests
from bs4 import BeautifulSoup

BASE = "https://www.ultrafarma.com.br"
SITEMAP = f"{BASE}/sitemap.xml"
NAO_PRODUTO = ("/categoria/", "/marca/", "/pagina/", "/api/", "/busca", "/identificacao", "/checkout")
INTERVALO = 1.0  # segundos entre requisições
SAIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "produtos_ultrafarma.json")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

sessao = requests.Session()
sessao.headers["User-Agent"] = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def urls_de_produtos() -> list[str]:
    res = sessao.get(SITEMAP, timeout=60)
    res.raise_for_status()
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [loc.text.strip() for loc in ET.fromstring(res.content).findall("s:url/s:loc", ns)]
    return [u for u in urls if u.rstrip("/") != BASE and not any(p in u for p in NAO_PRODUTO)]


def _texto(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


def extrair(url: str, pagina: str) -> dict | None:
    soup = BeautifulSoup(pagina, "html.parser")
    produto = None
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            dado = json.loads(tag.string or "")
        except json.JSONDecodeError:
            continue
        if isinstance(dado, dict) and dado.get("@type") == "Product":
            produto = dado
            break
    if not produto or not produto.get("name"):
        return None

    oferta = produto.get("offers") or {}
    if isinstance(oferta, list):
        oferta = oferta[0] if oferta else {}
    imagens = produto.get("image") or []
    imagem = imagens[0] if isinstance(imagens, list) and imagens else (imagens or None)
    # O JSON-LD aponta a miniatura (thumb-, 100px); a mesma foto existe em large- (900px)
    if imagem:
        imagem = re.sub(r"/(thumb|small|medium)-", "/large-", imagem)

    # Breadcrumb: Ultrafarma > Medicamentos > Alergias e Infecções > Antialérgicos > Produto
    # O último item é sempre o próprio produto (às vezes com nome um pouco diferente
    # do JSON-LD), então é descartado sem comparar texto.
    trilha = []
    lista = soup.find(attrs={"itemtype": re.compile("BreadcrumbList")})
    if lista:
        trilha = [_texto(n) for n in lista.find_all(attrs={"itemprop": "name"})][:-1]
    trilha = [t for t in trilha if t and t != "Ultrafarma"]

    descricao = _texto(soup.select_one(".description-block")) or html.unescape(produto.get("description") or "").strip()
    regulacao = _texto(soup.select_one(".regulation-info")).lower()

    # Preço "de" (riscado) quando o produto está em promoção: "De R$ 93,46 18% OFF"
    preco_original = None
    antigo = re.search(r"De\s*R\$\s*([\d.]+,\d{2})", _texto(soup.select_one(".product-old-price-info")))
    if antigo:
        preco_original = float(antigo.group(1).replace(".", "").replace(",", "."))
    tarja = (imagem or "").lower()

    return {
        "nome": html.unescape(produto["name"]).strip(),
        "descricao": descricao[:2000],
        "tipo": trilha[-1] if trilha else "",
        "categoria": trilha[1] if len(trilha) > 1 else (trilha[0] if trilha else ""),
        "departamento": trilha[0] if trilha else "",
        "preco": float(oferta["price"]) if oferta.get("price") else None,
        "preco_original": preco_original,
        "disponivel": "InStock" in str(oferta.get("availability", "")),
        "precisa_receita": "tarja-preta" in tarja or "tarja-vermelha" in tarja or "com-retencao" in tarja
                           or "sob prescrição" in regulacao or "venda sob prescri" in descricao.lower(),
        "marca": html.unescape((produto.get("brand") or {}).get("name", "")),
        "sku": str(produto.get("sku") or ""),
        "imagem_url_original": imagem,
        "url": url,
        "data_coleta": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def coletar(limite: int, semente: int) -> list[dict]:
    urls = urls_de_produtos()
    logging.info(f"{len(urls)} produtos no sitemap")
    if limite:
        random.Random(semente).shuffle(urls)  # amostra variada, não só a letra A
        urls = urls[:limite]

    produtos, inicio = [], time.time()
    for i, url in enumerate(urls, 1):
        try:
            res = sessao.get(url, timeout=30)
            if res.status_code == 429:
                logging.warning("429 recebido: pausando 60 s")
                time.sleep(60)
                res = sessao.get(url, timeout=30)
            if res.ok:
                item = extrair(url, res.text)
                if item:
                    produtos.append(item)
            else:
                logging.debug(f"{res.status_code} {url}")
        except requests.RequestException as exc:
            logging.warning(f"falha em {url}: {exc}")
        if i % 25 == 0 or i == len(urls):
            eta = (time.time() - inicio) / i * (len(urls) - i)
            logging.info(f"{i}/{len(urls)} páginas | {len(produtos)} produtos | ETA {eta / 60:.1f} min")
            salvar(produtos)
        time.sleep(INTERVALO)
    salvar(produtos)
    return produtos


def salvar(produtos: list[dict]) -> None:
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(produtos, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limite", type=int, default=300, help="quantos produtos coletar (0 = todos)")
    parser.add_argument("--semente", type=int, default=42)
    parser.add_argument("--importar", action="store_true", help="grava no Supabase ao terminar")
    args = parser.parse_args()

    produtos = coletar(args.limite, args.semente)
    logging.info(f"{len(produtos)} produtos salvos em {SAIDA}")
    if args.importar and produtos:
        importador = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "supabase", "importar_produtos.py")
        subprocess.run([sys.executable, importador, SAIDA, "--fonte", "ultrafarma"], check=False)
