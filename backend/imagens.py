"""Melhorador de imagens de produto.

Toda foto passa por aqui antes de ir para o Storage, para o catálogo ficar com
fotos padronizadas e nítidas mesmo quando a fonte é pequena ou comprimida:

  1. fundo branco (remove transparência)
  2. recorte das bordas brancas/quase brancas ao redor do produto
  3. redução de artefatos de compressão JPEG (blocos e ruído)
  4. ampliação de alta qualidade (Lanczos) quando a foto é menor que o destino
  5. nitidez (unsharp mask) e leve ajuste de contraste
  6. produto centralizado num quadrado branco padrão, salvo em WebP
"""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

TAMANHO = 800          # lado do quadrado final (px)
MARGEM = 0.06          # respiro branco em volta do produto (fração do lado)
LIMIAR_BRANCO = 245    # pixels mais claros que isso contam como fundo no recorte
QUALIDADE_WEBP = 90


def _fundo_branco(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        fundo = Image.new("RGB", rgba.size, (255, 255, 255))
        fundo.paste(rgba, mask=rgba.split()[-1])
        return fundo
    return img.convert("RGB")


def _recortar_bordas(img: Image.Image) -> Image.Image:
    """Corta a área de fundo claro em volta do produto (mantém o produto inteiro)."""
    cinza = np.asarray(img.convert("L"))
    mascara = cinza < LIMIAR_BRANCO
    if mascara.sum() < 0.01 * mascara.size:     # imagem quase toda branca: não mexe
        return img
    ys, xs = np.where(mascara)
    pad = max(2, int(0.01 * max(img.size)))
    caixa = (max(xs.min() - pad, 0), max(ys.min() - pad, 0),
             min(xs.max() + pad + 1, img.width), min(ys.max() + pad + 1, img.height))
    return img.crop(caixa)


def _reduzir_artefatos(img: Image.Image) -> Image.Image:
    """Remove blocos/ruído de JPEG preservando bordas. Em fotos pequenas (< 300 px)
    não aplica: ali o filtro confunde texto e detalhes com ruído e apaga tudo."""
    if max(img.size) < 300:
        return img
    arr = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
    arr = cv2.fastNlMeansDenoisingColored(arr, None, 3, 3, 7, 21)
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


def melhorar(conteudo: bytes) -> bytes:
    """Recebe a imagem original (qualquer formato) e devolve um WebP melhorado."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(conteudo)))
    img = _fundo_branco(img)
    img = _recortar_bordas(img)
    img = _reduzir_artefatos(img)

    # Ampliação/redução para caber no quadrado com margem, sem distorcer
    util = int(TAMANHO * (1 - 2 * MARGEM))
    escala = util / max(img.size)
    novo = (max(1, round(img.width * escala)), max(1, round(img.height * escala)))
    # Ampliação grande em 2 etapas (bicúbica + Lanczos) gera menos serrilhado
    if escala > 3:
        meio = (img.width * 2, img.height * 2)
        img = img.resize(meio, Image.BICUBIC)
    img = img.resize(novo, Image.LANCZOS)

    # Nitidez proporcional à ampliação (fotos muito ampliadas ficam "moles")
    raio = 2.0 if escala > 2 else 1.2
    img = img.filter(ImageFilter.UnsharpMask(radius=raio, percent=110 if escala > 2 else 70, threshold=2))
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(1.05)

    quadro = Image.new("RGB", (TAMANHO, TAMANHO), (255, 255, 255))
    quadro.paste(img, ((TAMANHO - img.width) // 2, (TAMANHO - img.height) // 2))

    saida = io.BytesIO()
    quadro.save(saida, "WEBP", quality=QUALIDADE_WEBP, method=6)
    return saida.getvalue()


def melhor_url_ultrafarma(url: str | None) -> str | None:
    """A Ultrafarma publica cada foto em thumb (100px), small, medium e large (900px)."""
    if not url:
        return url
    for prefixo in ("/thumb-", "/small-", "/medium-"):
        if prefixo in url:
            return url.replace(prefixo, "/large-")
    return url
