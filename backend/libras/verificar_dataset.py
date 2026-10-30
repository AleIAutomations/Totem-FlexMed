# =============================================================================
# LibrasFlow v2 — verificar_dataset.py
# Relatório completo do estado do dataset antes de treinar
# =============================================================================

import os
import sys
import cv2
import numpy as np
import time

from config import (
    DATASET_IMAGENS_DIR, DATASET_VIDEOS_DIR, DATASET_PDFS_DIR,
    DATA_DIR, NPY_ESTATICO, NPY_LABELS_EST,
    NPY_SEQUENCIAS, NPY_LABELS_SEQ, LABEL_ENCODER_PATH,
    MODELS_DIR, MODELO_ESTATICO_PATH, MODELO_VIDEO_PATH
)

MINIMO_IMAGENS = 30
MINIMO_VIDEOS  = 30
SEP = "=" * 62


def verificar_imagens():
    print(f"\n{SEP}")
    print("  IMAGENS ESTÁTICAS  (dataset/train/)")
    print(SEP)
    if not os.path.exists(DATASET_IMAGENS_DIR):
        print("  [X] Pasta não encontrada")
        return
    classes = sorted([c for c in os.listdir(DATASET_IMAGENS_DIR)
                      if os.path.isdir(os.path.join(DATASET_IMAGENS_DIR, c))])
    total = 0
    problemas = []
    for c in classes:
        imgs = [f for f in os.listdir(os.path.join(DATASET_IMAGENS_DIR, c))
                if f.lower().endswith((".png", ".jpg", ".jpeg"))]
        n = len(imgs)
        total += n
        status = "OK" if n >= MINIMO_IMAGENS else "POUCOS"
        icone  = "✓" if status == "OK" else "⚠"
        print(f"  {icone} {c:20s} {n:5d} imagens  [{status}]")
        if status != "OK":
            problemas.append((c, n))
    print(f"\n  Total: {total} imagens em {len(classes)} classes")
    if problemas:
        print(f"  ⚠  {len(problemas)} classes com menos de {MINIMO_IMAGENS} imagens:")
        for c, n in problemas:
            print(f"     - {c}: {n} (faltam {MINIMO_IMAGENS - n})")


def verificar_videos():
    print(f"\n{SEP}")
    print("  VÍDEOS  (dataset/videos/)")
    print(SEP)
    if not os.path.exists(DATASET_VIDEOS_DIR):
        print("  [X] Pasta não encontrada")
        print("  Crie: dataset/videos/<palavra>/*.mp4")
        return
    palavras = sorted([p for p in os.listdir(DATASET_VIDEOS_DIR)
                       if os.path.isdir(os.path.join(DATASET_VIDEOS_DIR, p))])
    if not palavras:
        print("  [X] Nenhuma pasta de palavra encontrada")
        return
    total = 0
    problemas = []
    for p in palavras:
        vids = [v for v in os.listdir(os.path.join(DATASET_VIDEOS_DIR, p))
                if v.lower().endswith((".mp4", ".avi", ".mov", ".webm"))]
        n = len(vids)
        total += n

        # Calcula duração média
        duracoes = []
        for v in vids[:5]:   # amostra dos primeiros 5
            cap = cv2.VideoCapture(os.path.join(DATASET_VIDEOS_DIR, p, v))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30
            fc  = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            cap.release()
            if fc > 0:
                duracoes.append(fc / fps)
        med = f"{np.mean(duracoes):.1f}s" if duracoes else "?"

        status = "OK" if n >= MINIMO_VIDEOS else "POUCOS"
        icone  = "✓" if status == "OK" else "⚠"
        print(f"  {icone} {p:25s} {n:4d} vídeos  ~{med}/vídeo  [{status}]")
        if status != "OK":
            problemas.append((p, n))
    print(f"\n  Total: {total} vídeos em {len(palavras)} palavras")
    if problemas:
        print(f"  ⚠  {len(problemas)} palavras com menos de {MINIMO_VIDEOS} vídeos")


def verificar_pdfs():
    print(f"\n{SEP}")
    print("  PDFs  (dataset/pdfs/)")
    print(SEP)
    if not os.path.exists(DATASET_PDFS_DIR):
        print("  [X] Pasta não encontrada")
        return
    pdfs = [f for f in os.listdir(DATASET_PDFS_DIR) if f.lower().endswith(".pdf")]
    if not pdfs:
        print("  Nenhum PDF encontrado")
        return
    for pdf in pdfs:
        tamanho = os.path.getsize(os.path.join(DATASET_PDFS_DIR, pdf))
        print(f"  ✓ {pdf}  ({tamanho // 1024} KB)")
    print(f"\n  Total: {len(pdfs)} PDFs")


def verificar_dados_processados():
    print(f"\n{SEP}")
    print("  DADOS PROCESSADOS  (data/)")
    print(SEP)

    def checar(path, nome):
        if os.path.exists(path):
            dados = np.load(path, allow_pickle=True)
            print(f"  ✓ {nome:35s} shape: {dados.shape}")
        else:
            print(f"  ✗ {nome:35s} não encontrado")

    checar(NPY_ESTATICO,    "dados_estaticos.npy")
    checar(NPY_LABELS_EST,  "labels_estaticos.npy")
    checar(NPY_SEQUENCIAS,  "sequencias.npy")
    checar(NPY_LABELS_SEQ,  "labels_sequencias.npy")

    if os.path.exists(LABEL_ENCODER_PATH):
        classes = np.load(LABEL_ENCODER_PATH, allow_pickle=True)
        print(f"\n  Classes registradas ({len(classes)}): {list(classes)}")


def verificar_modelos():
    print(f"\n{SEP}")
    print("  MODELOS TREINADOS  (models/)")
    print(SEP)

    def checar_modelo(path, nome):
        if os.path.exists(path):
            tamanho = os.path.getsize(path)
            print(f"  ✓ {nome:30s} ({tamanho // 1024} KB)")
        else:
            print(f"  ✗ {nome:30s} não encontrado")

    checar_modelo(MODELO_ESTATICO_PATH, "modelo_estatico.h5")
    checar_modelo(MODELO_VIDEO_PATH,    "modelo_video.h5")


def resumo_acoes():
    print(f"\n{SEP}")
    print("  PRÓXIMOS PASSOS RECOMENDADOS")
    print(SEP)

    acoes = []

    if not os.path.exists(NPY_ESTATICO):
        acoes.append("python scripts/coleta.py --imagens   # processar imagens estáticas")
    if not os.path.exists(NPY_SEQUENCIAS):
        acoes.append("python scripts/coleta.py --videos    # processar vídeos")
    if not os.path.exists(MODELO_ESTATICO_PATH) and os.path.exists(NPY_ESTATICO):
        acoes.append("python scripts/treinar.py --estatico # treinar modelo estático")
    if not os.path.exists(MODELO_VIDEO_PATH) and os.path.exists(NPY_SEQUENCIAS):
        acoes.append("python scripts/treinar.py --video    # treinar modelo de vídeo")
    if os.path.exists(MODELO_ESTATICO_PATH) or os.path.exists(MODELO_VIDEO_PATH):
        acoes.append("python scripts/main.py               # usar em tempo real")

    if acoes:
        for a in acoes:
            print(f"  → {a}")
    else:
        print("  Tudo pronto! Execute: python scripts/main.py")

    print()


if __name__ == "__main__":
    print(f"\n{'=' * 62}")
    print("  LibrasFlow v2 — Verificação do Dataset")
    print(f"{'=' * 62}")
    verificar_imagens()
    verificar_videos()
    verificar_pdfs()
    verificar_dados_processados()
    verificar_modelos()
    resumo_acoes()
