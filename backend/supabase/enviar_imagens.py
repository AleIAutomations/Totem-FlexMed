"""Envia as imagens locais dos produtos (frontend/assets/imgRemedio{N}.png) para o
bucket do Supabase e preenche o imgUrl dos produtos que ainda não têm imagem.

Uso (com backend/.env preenchido e schema.sql já rodado):
    python backend/supabase/enviar_imagens.py
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import supabase_products as sb  # noqa: E402

ASSETS = BACKEND.parent / "frontend" / "assets"

if not sb.configurado():
    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados em backend/.env")

for p in sb.listar(only_active=False)[0]:
    if p.get("imgUrl"):
        print(f"[ok]   {p['nome']}: já tem imagem")
        continue
    arquivo = ASSETS / f"imgRemedio{p.get('imgIndex') or p['id']}.png"
    if not arquivo.exists():
        print(f"[--]   {p['nome']}: {arquivo.name} não encontrado")
        continue
    url = sb.enviar_imagem(arquivo.read_bytes(), arquivo.name, "image/png")
    sb.atualizar(p["id"], {"imgUrl": url})
    print(f"[novo] {p['nome']}: {url}")
