"""Reprocessa as fotos dos produtos já cadastrados: busca a melhor versão da
foto (na Ultrafarma, a "large" de 900px em vez da miniatura), passa pelo
melhorador (backend/imagens.py) e troca a imagem no Storage/produto.

Uso:
    python backend/supabase/melhorar_imagens.py [scrapping/produtos_ultrafarma.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import supabase_products as sb  # noqa: E402
from imagens import melhor_url_ultrafarma, melhorar  # noqa: E402

if not sb.configurado():
    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados em backend/.env")

# URL original da fonte por produto (o imgUrl atual é a cópia já salva no Storage)
origem_por_url: dict[str, str] = {}
if len(sys.argv) > 1:
    for item in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")):
        if item.get("url") and item.get("imagem_url_original"):
            origem_por_url[item["url"]] = item["imagem_url_original"]

sessao = requests.Session()
sessao.headers["User-Agent"] = "FlexMed-importador"
processadas: dict[str, str] = {}  # URL de origem -> nova URL (fotos genéricas se repetem)
ok = falhas = 0

produtos, _ = sb.listar(only_active=False)
for p in produtos:
    if (p.get("imgUrl") or "").endswith(".webp"):
        continue  # já passou pelo melhorador (permite rodar de novo só para as falhas)
    origem = melhor_url_ultrafarma(origem_por_url.get(p.get("fonteUrl") or "") or p.get("imgUrl"))
    if not origem:
        continue
    try:
        if origem not in processadas:
            res = sessao.get(origem, timeout=30)
            res.raise_for_status()
            processadas[origem] = sb.enviar_imagem(melhorar(res.content), "produto.webp", "image/webp")
        sb.atualizar(p["id"], {"imgUrl": processadas[origem]})
        ok += 1
        print(f"[ok]   {p['nome'][:60]}")
    except Exception as exc:  # uma foto com problema não interrompe as outras
        falhas += 1
        print(f"[erro] {p['nome'][:60]}: {exc}")

print(f"\n{ok} produto(s) com foto melhorada ({len(processadas)} imagens distintas), {falhas} falha(s).")
