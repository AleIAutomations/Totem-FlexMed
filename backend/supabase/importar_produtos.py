"""Importa um JSON de produtos (formato do scrapping/scraper_drogasil.py) para o Supabase.

Para cada item: garante a categoria, sobe a foto para o Storage, cria ou atualiza
o produto (dedup por URL de origem, ou por nome) e registra o preço no histórico.
Cada execução fica registrada em `coletas`.

Campos lidos de cada item (os que faltarem são ignorados):
    nome, descricao, tipo, categoria (agrupamento; padrão = tipo), preco (número ou "R$ 12,90"), precisa_receita,
    imagem_local, imagem_url_original, url

Uso:
    python backend/supabase/importar_produtos.py scrapping/produtos_drogasil.json --fonte drogasil
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from pathlib import Path

import requests

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import supabase_products as sb  # noqa: E402
from categorias import NOMES, classificar  # noqa: E402
from imagens import melhor_url_ultrafarma, melhorar  # noqa: E402


def carregar_imagem(item: dict, base: Path) -> tuple[bytes, str, str] | None:
    local = item.get("imagem_local")
    if local and (base / local).exists():
        caminho = base / local
        return caminho.read_bytes(), caminho.name, mimetypes.guess_type(caminho.name)[0] or "image/jpeg"
    url = melhor_url_ultrafarma(item.get("imagem_url_original"))
    if url:
        try:
            res = requests.get(url, timeout=20, headers={"User-Agent": "FlexMed-importador"})
            if res.ok and res.headers.get("Content-Type", "").startswith("image/"):
                nome = Path(url.split("?")[0]).name or "imagem.jpg"
                return res.content, nome, res.headers["Content-Type"]
        except requests.RequestException:
            pass
    return None


def importar(arquivo: Path, fonte: str) -> None:
    itens = json.loads(arquivo.read_text(encoding="utf-8"))
    coleta_id = sb.iniciar_coleta(fonte)
    categorias: dict[str, int] = {}  # slug da categoria principal -> id
    # "precoOriginal" depende de uma migração do schema.sql; sem ela, importa sem o preço "de"
    com_preco_original = sb.coluna_existe("precoOriginal")
    if not com_preco_original:
        print('[aviso] coluna "precoOriginal" ausente: rode o schema.sql para importar os descontos')
    imagens_enviadas: dict[str, str] = {}  # URL de origem -> URL no Storage (fotos genéricas se repetem)
    total = 0
    try:
        for item in itens:
            nome = (item.get("nome") or "").strip()
            if not nome or nome == "Nome não encontrado":
                continue
            tipo = (item.get("tipo") or "").strip()
            if not tipo or tipo == "Não especificado":
                tipo = "Outros"
            # Categoria principal (chips do totem) a partir da árvore da fonte
            slug = classificar(item.get("departamento", ""), item.get("categoria", ""), tipo, nome)
            if slug not in categorias:
                categorias[slug] = sb.garantir_categoria(slug, NOMES[slug])
            categoria_id = categorias[slug]

            preco = sb.preco_para_valor(item.get("preco"))
            preco = preco if preco else None  # o scraper usa 0.0 quando não acha o preço
            original = sb.preco_para_valor(item.get("preco_original"))
            original = original if original and preco and original > preco else None
            dados = {
                "nome": nome,
                "tipo": tipo,
                "categoria": slug,
                "categoriaId": categoria_id,
                "receita": bool(item.get("precisa_receita")),
                "precoValor": preco,
                "precoOriginal": original,  # preço "de" (promoção); None = sem desconto
                "preco": sb.formatar_preco(preco) if preco else "",
                "fonte": fonte,
                "imgIndex": None,  # a coluna tem padrão 1 (imagem local de demonstração)
            }
            if not com_preco_original:
                dados.pop("precoOriginal")
            if item.get("descricao"):
                dados["uso"] = item["descricao"].strip()
            if item.get("url"):
                dados["fonteUrl"] = item["url"]

            existente = (sb.buscar_por("fonteUrl", item["url"]) if item.get("url") else None) \
                or sb.buscar_por("nome", nome)
            origem = item.get("imagem_url_original") or item.get("imagem_local")
            if origem in imagens_enviadas:
                dados["imgUrl"] = imagens_enviadas[origem]
            elif not (existente and existente.get("imgUrl")):
                imagem = carregar_imagem(item, arquivo.parent)
                if imagem:
                    # toda foto passa pelo melhorador antes de ir para o Storage
                    dados["imgUrl"] = sb.enviar_imagem(melhorar(imagem[0]), "produto.webp", "image/webp")
                    if origem:
                        imagens_enviadas[origem] = dados["imgUrl"]

            produto = sb.atualizar(existente["id"], dados) if existente else sb.criar(dados)
            if preco:
                sb.registrar_preco(produto["id"], preco, coleta_id)
            total += 1
            print(f"[{'atualizado' if existente else 'novo':10s}] {nome} — {dados['preco'] or 'sem preço'}")
    except Exception as exc:
        sb.finalizar_coleta(coleta_id, "erro", total, str(exc)[:500])
        raise
    sb.finalizar_coleta(coleta_id, "concluida", total)
    print(f"\n{total} produto(s) importado(s) na coleta #{coleta_id}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("arquivo", type=Path)
    parser.add_argument("--fonte", default="importacao")
    args = parser.parse_args()
    if not sb.configurado():
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados em backend/.env")
    importar(args.arquivo, args.fonte)
