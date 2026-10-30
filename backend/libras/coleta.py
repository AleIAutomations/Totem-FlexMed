# =============================================================================
# LibrasFlow v2 — Coleta de Dados
# Processa: imagens estáticas (dataset/train), vídeos (dataset/videos),
#           PDFs de livros de LIBRAS (dataset/pdfs)
# =============================================================================

import os
import sys
import cv2
import numpy as np
import time
from progress import ProgressMeter

from config import (
    DATASET_IMAGENS_DIR, DATASET_VIDEOS_DIR, DATASET_PDFS_DIR,
    DATA_DIR, CSV_ESTATICO, NPY_SEQUENCIAS, NPY_LABELS_SEQ,
    NPY_ESTATICO, NPY_LABELS_EST, LABEL_ENCODER_PATH,
    N_FRAMES, N_TOTAL, N_ESTATICO
)
from utils import (
    criar_holistic, criar_hands,
    extrair_keypoints_frame, extrair_keypoints_estatico,
    normalizar_por_ombro, padronizar_sequencia
)

os.makedirs(DATA_DIR, exist_ok=True)


# =============================================================================
# 1. IMAGENS ESTÁTICAS (dataset/train/A-Z ou palavras)
# =============================================================================
def coletar_imagens_estaticas():
    """
    Percorre dataset/train/<classe>/*.png|jpg,
    extrai keypoints de mão com MediaPipe Hands,
    salva em NPY e CSV compatível com o formato original do projeto.
    """
    print("\n" + "=" * 60)
    print("  COLETA — Imagens Estáticas")
    print("=" * 60)

    if not os.path.exists(DATASET_IMAGENS_DIR):
        print(f"[AVISO] Pasta não encontrada: {DATASET_IMAGENS_DIR}")
        return

    classes = sorted(os.listdir(DATASET_IMAGENS_DIR))
    classes = [c for c in classes if os.path.isdir(os.path.join(DATASET_IMAGENS_DIR, c))]
    print(f"Classes encontradas: {classes}\n")

    X, y = [], []
    csv_linhas = []

    # Cabeçalho CSV (compatível com o original do projeto)
    header = ["label"] + [f"{a}{i}" for i in range(21) for a in ["x", "y", "z"]]
    csv_linhas.append(",".join(header))

    with criar_hands(static_mode=True) as hands:
        for classe in classes:
            pasta = os.path.join(DATASET_IMAGENS_DIR, classe)
            arquivos = [f for f in os.listdir(pasta)
                        if f.lower().endswith((".png", ".jpg", ".jpeg"))]

            ok, fail = 0, 0
            meter = ProgressMeter(len(arquivos), label=f"imagens:{classe}", every=max(1, len(arquivos)//20 or 1))
            for idx_arq, arq in enumerate(arquivos, start=1):
                img = cv2.imread(os.path.join(pasta, arq))
                if img is None:
                    fail += 1
                    continue

                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                results = hands.process(img_rgb)
                kpts = extrair_keypoints_estatico(results, img.shape[1], img.shape[0])

                if kpts is not None:
                    X.append(kpts)
                    y.append(classe)
                    linha = [classe] + [f"{v:.8f}" for v in kpts]
                    csv_linhas.append(",".join(linha))
                    ok += 1
                else:
                    fail += 1
                meter.update(idx_arq, f"OK={ok} falhas={fail}")

            meter.done(f"OK={ok} falhas={fail}")
            print(f"  [{classe}] {ok} OK | {fail} sem detecção")

    if len(X) == 0:
        print("[ERRO] Nenhum keypoint extraído das imagens.")
        return

    X = np.array(X)
    y = np.array(y)

    np.save(NPY_ESTATICO, X)
    np.save(NPY_LABELS_EST, y)
    np.save(LABEL_ENCODER_PATH, np.unique(y))

    with open(CSV_ESTATICO, "w") as f:
        f.write("\n".join(csv_linhas))

    print(f"\n  Total: {len(X)} amostras de {len(np.unique(y))} classes")
    print(f"  Salvo em: {NPY_ESTATICO}")
    print(f"  CSV salvo em: {CSV_ESTATICO}")


# =============================================================================
# 2. VÍDEOS (dataset/videos/<palavra>/*.mp4|avi|mov)
# =============================================================================
def coletar_videos():
    """
    Percorre dataset/videos/<palavra>/*.mp4,
    extrai sequência de keypoints com MediaPipe Holistic,
    normaliza por ombro e salva em NPY.
    """
    print("\n" + "=" * 60)
    print("  COLETA — Vídeos")
    print("=" * 60)

    if not os.path.exists(DATASET_VIDEOS_DIR):
        print(f"[AVISO] Pasta não encontrada: {DATASET_VIDEOS_DIR}")
        print("  Crie a pasta dataset/videos/<palavra>/ e adicione os vídeos.")
        return

    palavras = sorted(os.listdir(DATASET_VIDEOS_DIR))
    palavras = [p for p in palavras if os.path.isdir(os.path.join(DATASET_VIDEOS_DIR, p))]

    if not palavras:
        print("[AVISO] Nenhuma pasta de palavra encontrada em dataset/videos/")
        return

    print(f"Palavras encontradas: {palavras}\n")

    X_seq, y_seq = [], []
    extensoes = (".mp4", ".avi", ".mov", ".mkv", ".webm")

    with criar_holistic(static_mode=False) as holistic:
        for palavra in palavras:
            pasta = os.path.join(DATASET_VIDEOS_DIR, palavra)
            videos = [v for v in os.listdir(pasta)
                      if v.lower().endswith(extensoes)]

            ok, fail = 0, 0
            meter = ProgressMeter(len(videos), label=f"videos:{palavra}", every=1)
            for idx_video, video in enumerate(videos, start=1):
                caminho = os.path.join(pasta, video)
                frames_kpts = _processar_video(caminho, holistic)

                if frames_kpts is not None:
                    seq = padronizar_sequencia(frames_kpts, N_FRAMES)
                    seq = normalizar_por_ombro(seq)
                    X_seq.append(seq)
                    y_seq.append(palavra)
                    ok += 1
                else:
                    fail += 1
                meter.update(idx_video, f"OK={ok} falhas={fail}")

            meter.done(f"OK={ok} falhas={fail}")
            print(f"  [{palavra}] {ok} OK | {fail} falha")

    if len(X_seq) == 0:
        print("[AVISO] Nenhuma sequência extraída dos vídeos.")
        return

    X_seq = np.array(X_seq)   # (n_amostras, N_FRAMES, N_TOTAL)
    y_seq = np.array(y_seq)

    np.save(NPY_SEQUENCIAS, X_seq)
    np.save(NPY_LABELS_SEQ, y_seq)

    # Atualiza label encoder com todas as classes (estáticas + vídeo)
    classes_existentes = []
    if os.path.exists(LABEL_ENCODER_PATH):
        classes_existentes = list(np.load(LABEL_ENCODER_PATH, allow_pickle=True))
    todas_classes = np.unique(classes_existentes + list(np.unique(y_seq)))
    np.save(LABEL_ENCODER_PATH, todas_classes)

    print(f"\n  Total: {len(X_seq)} sequências de {len(np.unique(y_seq))} palavras")
    print(f"  Shape: {X_seq.shape}")
    print(f"  Salvo em: {NPY_SEQUENCIAS}")


def _processar_video(caminho, holistic):
    """Extrai lista de keypoints frame a frame de um único vídeo."""
    cap = cv2.VideoCapture(caminho)
    if not cap.isOpened():
        return None

    frames_kpts = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = holistic.process(img_rgb)
        kpts = extrair_keypoints_frame(results)
        frames_kpts.append(kpts)

    cap.release()

    if len(frames_kpts) < 5:   # vídeo muito curto
        return None

    return frames_kpts


# =============================================================================
# 3. PDFs DE LIVROS DE LIBRAS (dataset/pdfs/*.pdf)
# =============================================================================
def coletar_pdfs():
    """
    Extrai imagens dos PDFs e processa da mesma forma que as imagens estáticas.
    Cada imagem com mão detectada é adicionada ao dataset estático.
    """
    print("\n" + "=" * 60)
    print("  COLETA — PDFs de Livros de LIBRAS")
    print("=" * 60)

    try:
        import fitz   # PyMuPDF
    except ImportError:
        print("[ERRO] PyMuPDF não instalado. Execute: pip install pymupdf")
        return

    try:
        from PIL import Image
        import io
    except ImportError:
        print("[ERRO] Pillow não instalado. Execute: pip install Pillow")
        return

    if not os.path.exists(DATASET_PDFS_DIR):
        print(f"[AVISO] Pasta não encontrada: {DATASET_PDFS_DIR}")
        return

    pdfs = [f for f in os.listdir(DATASET_PDFS_DIR) if f.lower().endswith(".pdf")]
    if not pdfs:
        print("[AVISO] Nenhum PDF encontrado em dataset/pdfs/")
        return

    print(f"PDFs encontrados: {pdfs}\n")
    print("  ATENÇÃO: Para PDFs, você precisa nomear as pastas manualmente.")
    print("  Estrutura esperada: dataset/pdfs/<nome_sinal>/<arquivo>.pdf")
    print("  ou: dataset/pdfs/<arquivo>.pdf (label será o nome do arquivo sem extensão)\n")

    X_pdf, y_pdf = [], []
    pasta_imgs_tmp = os.path.join(DATA_DIR, "imgs_pdf_tmp")
    os.makedirs(pasta_imgs_tmp, exist_ok=True)

    with criar_hands(static_mode=True) as hands:
        for pdf_nome in pdfs:
            # Tenta usar o nome do arquivo ou pasta pai como label
            label = os.path.splitext(pdf_nome)[0]
            caminho_pdf = os.path.join(DATASET_PDFS_DIR, pdf_nome)

            print(f"  Processando: {pdf_nome} → label: '{label}'")

            doc = fitz.open(caminho_pdf)
            ok, total = 0, 0

            meter_pdf = ProgressMeter(len(doc), label=f"pdf:{pdf_nome}", every=max(1, len(doc)//10 or 1))
            for num_pag in range(len(doc)):
                pagina = doc[num_pag]
                imgs = pagina.get_images(full=True)

                for idx, img_info in enumerate(imgs):
                    xref = img_info[0]
                    img_base = doc.extract_image(xref)
                    img_bytes = img_base["image"]

                    img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                    w_img, h_img = img_pil.size

                    # Ignora imagens muito pequenas (decorações)
                    if w_img < 80 or h_img < 80:
                        continue

                    total += 1
                    img_np = np.array(img_pil)
                    img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
                    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

                    results = hands.process(img_rgb)
                    kpts = extrair_keypoints_estatico(results)

                    if kpts is not None:
                        X_pdf.append(kpts)
                        y_pdf.append(label)
                        ok += 1
                meter_pdf.update(num_pag + 1, f"imagens={total} mãos={ok}")

            meter_pdf.done(f"imagens={total} mãos={ok}")
            doc.close()
            print(f"    {ok}/{total} imagens com mãos detectadas")

    if len(X_pdf) == 0:
        print("[AVISO] Nenhum keypoint extraído dos PDFs.")
        return

    # Combina com dados estáticos existentes
    X_pdf = np.array(X_pdf)
    y_pdf = np.array(y_pdf)

    if os.path.exists(NPY_ESTATICO):
        X_exist = np.load(NPY_ESTATICO, allow_pickle=True)
        y_exist = np.load(NPY_LABELS_EST, allow_pickle=True)
        X_final = np.vstack([X_exist, X_pdf])
        y_final = np.concatenate([y_exist, y_pdf])
    else:
        X_final = X_pdf
        y_final = y_pdf

    np.save(NPY_ESTATICO, X_final)
    np.save(NPY_LABELS_EST, y_final)

    # Atualiza label encoder
    classes_existentes = []
    if os.path.exists(LABEL_ENCODER_PATH):
        classes_existentes = list(np.load(LABEL_ENCODER_PATH, allow_pickle=True))
    todas_classes = np.unique(classes_existentes + list(np.unique(y_pdf)))
    np.save(LABEL_ENCODER_PATH, todas_classes)

    print(f"\n  Total adicionado dos PDFs: {len(X_pdf)} amostras")
    print(f"  Dataset estático total agora: {len(X_final)} amostras")


# =============================================================================
# 4. DATA AUGMENTATION para vídeos
# =============================================================================
def aumentar_videos():
    """
    Aplica augmentação nas sequências de vídeo já extraídas:
    - espelhamento horizontal (simula sinalização com mão dominante oposta)
    - variação de velocidade (rápido e lento)
    - ruído leve nos keypoints
    """
    print("\n" + "=" * 60)
    print("  AUGMENTAÇÃO — Sequências de Vídeo")
    print("=" * 60)

    if not os.path.exists(NPY_SEQUENCIAS):
        print("[AVISO] Arquivo de sequências não encontrado. Execute a coleta de vídeos primeiro.")
        return

    X = np.load(NPY_SEQUENCIAS, allow_pickle=True)
    y = np.load(NPY_LABELS_SEQ, allow_pickle=True)

    X_aug, y_aug = [X], [y]

    # 1. Espelhamento (inverte eixo X de todos os keypoints)
    X_esp = X.copy()
    for i in range(0, X.shape[2] - 2, 3):
        X_esp[:, :, i] = 1.0 - X[:, :, i]
    X_aug.append(X_esp)
    y_aug.append(y)

    # 2. Velocidade rápida (pega frames alternados e interpola de volta)
    indices_rap = np.linspace(0, N_FRAMES - 1, N_FRAMES // 2).astype(int)
    X_rap = X[:, indices_rap, :]
    indices_full = np.linspace(0, len(indices_rap) - 1, N_FRAMES).astype(int)
    X_rap = X_rap[:, indices_full, :]
    X_aug.append(X_rap)
    y_aug.append(y)

    # 3. Velocidade lenta (duplica frames e corta)
    X_len = np.repeat(X, 2, axis=1)[:, :N_FRAMES, :]
    X_aug.append(X_len)
    y_aug.append(y)

    # 4. Ruído leve (simula imperfeições de detecção)
    X_ruido = X + np.random.normal(0, 0.005, X.shape)
    X_aug.append(X_ruido)
    y_aug.append(y)

    X_final = np.vstack(X_aug)
    y_final = np.concatenate(y_aug)

    np.save(NPY_SEQUENCIAS, X_final)
    np.save(NPY_LABELS_SEQ, y_final)

    print(f"  Original: {len(X)} → Aumentado: {len(X_final)} sequências ({len(X_final)//len(X)}x)")
    print(f"  Salvo em: {NPY_SEQUENCIAS}")


# =============================================================================
# MAIN — executa toda a coleta
# =============================================================================
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="LibrasFlow v2 — Coleta de Dados")
    parser.add_argument("--imagens", action="store_true", help="Coletar imagens estáticas")
    parser.add_argument("--videos",  action="store_true", help="Coletar vídeos")
    parser.add_argument("--pdfs",    action="store_true", help="Coletar PDFs")
    parser.add_argument("--aug",     action="store_true", help="Aumentar dataset de vídeos")
    parser.add_argument("--tudo",    action="store_true", help="Executar tudo em sequência")
    args = parser.parse_args()

    if args.tudo or args.imagens:
        coletar_imagens_estaticas()

    if args.tudo or args.pdfs:
        coletar_pdfs()

    if args.tudo or args.videos:
        coletar_videos()

    if args.tudo or args.aug:
        aumentar_videos()

    if not any(vars(args).values()):
        print("Use: python scripts/coleta.py --tudo")
        print("     python scripts/coleta.py --imagens")
        print("     python scripts/coleta.py --videos")
        print("     python scripts/coleta.py --pdfs")
        print("     python scripts/coleta.py --aug")
