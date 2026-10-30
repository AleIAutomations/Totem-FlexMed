"""Recortes 112x112 de cada rosto do UTKFace, com a mesma detecção/recorte do totem."""
import sys
from pathlib import Path
import cv2, mediapipe as mp, numpy as np

pasta, saida = Path(sys.argv[1]), sys.argv[2]
det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.4)
L = 112
imgs, idades, i_ok = [], [], 0
for arq in sorted(pasta.glob("*.jpg")):
    try: idade = int(arq.name.split("_")[0])
    except ValueError: continue
    img = cv2.imread(str(arq))
    if img is None: continue
    cena = cv2.copyMakeBorder(img, 200, 200, 200, 200, cv2.BORDER_REFLECT)
    r = det.process(cv2.cvtColor(cena, cv2.COLOR_BGR2RGB))
    if not r.detections: continue
    b = max(r.detections, key=lambda d: d.score[0]).location_data.relative_bounding_box
    h, w = cena.shape[:2]
    x1, y1, x2, y2 = max(b.xmin,0)*w, max(b.ymin,0)*h, min(b.xmin+b.width,1)*w, min(b.ymin+b.height,1)*h
    cx, cy = (x1+x2)/2, (y1+y2)/2
    esc = L / (max(x2-x1, y2-y1) * 1.5)
    M = np.array([[esc,0,L/2-cx*esc],[0,esc,L/2-cy*esc]], np.float32)
    imgs.append(cv2.cvtColor(cv2.warpAffine(cena, M, (L, L), borderValue=0.0), cv2.COLOR_BGR2RGB)); idades.append(idade)
np.savez(saida, X=np.array(imgs, np.uint8), idade=np.array(idades))
print("ok", len(imgs))
