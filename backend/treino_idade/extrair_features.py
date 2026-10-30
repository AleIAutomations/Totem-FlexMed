"""Extrai, para cada rosto do UTKFace, as mesmas entradas que o totem usa em produção:
detecção MediaPipe (model_selection=1) -> recorte InsightFace 96x96 -> genderage
(idade crua + vetor de 256 características da penúltima camada).

Cada foto gera 2 amostras: original e uma versão "de totem" (espelhada, menor,
com JPEG forte e brilho alterado), para o classificador aprender com câmera ruim.
"""
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort

pasta, modelo, saida = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.4)
sess = ort.InferenceSession(modelo, providers=["CPUExecutionProvider"])
entrada = sess.get_inputs()[0].name
rng = np.random.default_rng(7)


def recorte_96(frame, caixa):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = caixa[0] * w, caixa[1] * h, caixa[2] * w, caixa[3] * h
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    escala = 96 / (max(x2 - x1, y2 - y1) * 1.5)
    M = np.array([[escala, 0, 48 - cx * escala], [0, escala, 48 - cy * escala]], dtype=np.float32)
    return cv2.warpAffine(frame, M, (96, 96), borderValue=0.0)


def amostra(img):
    # coloca o rosto numa "cena" maior, como numa câmera a ~1 m
    cena = cv2.copyMakeBorder(img, 200, 200, 200, 200, cv2.BORDER_REFLECT)
    r = det.process(cv2.cvtColor(cena, cv2.COLOR_BGR2RGB))
    if not r.detections:
        return None
    b = max(r.detections, key=lambda d: d.score[0]).location_data.relative_bounding_box
    caixa = (max(b.xmin, 0), max(b.ymin, 0), min(b.xmin + b.width, 1), min(b.ymin + b.height, 1))
    blob = cv2.dnn.blobFromImage(recorte_96(cena, caixa), 1.0, (96, 96), (0, 0, 0), swapRB=True)
    fc, feat = sess.run(None, {entrada: blob})
    return np.concatenate([[fc[0][2] * 100], feat[0]]).astype(np.float32)


def versao_totem(img):
    img = cv2.flip(img, 1)
    lado = int(rng.integers(60, 130))                  # rosto pequeno/longe
    img = cv2.resize(cv2.resize(img, (lado, lado)), (200, 200))
    img = cv2.convertScaleAbs(img, alpha=float(rng.uniform(0.7, 1.3)), beta=float(rng.uniform(-30, 30)))
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(35, 70))])
    return cv2.imdecode(jpg, cv2.IMREAD_COLOR)


X, idades, fotos = [], [], []
arquivos = sorted(pasta.glob("*.jpg"))
for i, arq in enumerate(arquivos):
    try:
        idade = int(arq.name.split("_")[0])
    except ValueError:
        continue
    img = cv2.imread(str(arq))
    if img is None:
        continue
    for variante in (img, versao_totem(img)):
        v = amostra(variante)
        if v is not None:
            X.append(v); idades.append(idade); fotos.append(i)
    if i % 2000 == 0:
        print(f"{i}/{len(arquivos)} -> {len(X)} amostras", flush=True)

np.savez_compressed(saida, X=np.array(X), idade=np.array(idades), foto=np.array(fotos))
print("ok", len(X))
