"""Motor de visão computacional do totem (audiência anônima).

Para cada frame da câmera:
  1. detecta rostos (MediaPipe Face Detection, alcance de ~5 m);
  2. estima se a pessoa está olhando para a tela (posição do nariz em relação
     aos olhos e à boca);
  3. estima a faixa etária de 10 anos com uma MobileNetV3 ajustada no UTKFace
     (modelos/faixas_cnn.tflite, ver treino_idade/); sem ela, usa um
     classificador sobre as características do genderage (faixas_idade.npz).
     As probabilidades das leituras de cada pessoa são somadas (votação). A
     idade numérica registrada vem do genderage (InsightFace, ONNX);
  4. acompanha cada pessoa com um número temporário enquanto ela está na frente
     do totem, para somar atenção sem contar a mesma pessoa duas vezes;
  5. atribui a atenção ao anúncio e/ou à sessão de uso em andamento.

Privacidade: o frame é processado em memória e descartado. Nada de imagem,
recorte ou característica do rosto é guardado — só faixa etária, se olhou e
por quanto tempo. O número da pessoa some quando ela sai da frente da câmera.
"""
from __future__ import annotations

import json
import statistics
import threading
import time
from collections import Counter, deque
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

PASTA_MODELOS = Path(__file__).resolve().parent / "modelos"
MODELO_IDADE = PASTA_MODELOS / "genderage.onnx"
MODELO_CARACTERISTICAS = PASTA_MODELOS / "genderage_feat.onnx"   # mesmo modelo + saída da penúltima camada
CLASSIFICADOR_FAIXAS = PASTA_MODELOS / "faixas_idade.npz"
MODELO_CNN = PASTA_MODELOS / "faixas_cnn.tflite"                  # preferido quando existe
MODELO_CNN_INFO = PASTA_MODELOS / "faixas_cnn.json"
LADO_CNN = 112

# Faixas etárias de segmentação (slug, nome, idade mínima, idade máxima exclusiva)
FAIXAS = [
    ("18-28", "18 a 28 anos", 18, 28),
    ("28-38", "28 a 38 anos", 28, 38),
    ("38-48", "38 a 48 anos", 38, 48),
    ("48-58", "48 a 58 anos", 48, 58),
    ("58-68", "58 a 68 anos", 58, 68),
    ("68-78", "68 a 78 anos", 68, 78),
    ("78-88", "78 a 88 anos", 78, 200),
]
SLUGS_FAIXAS = [f[0] for f in FAIXAS]
MENOR = "menor"          # menores de 18: contam como público, mas não são segmentados
CLASSES = [MENOR] + SLUGS_FAIXAS

PERDIDO_APOS_S = 2.5     # pessoa some da câmera por esse tempo -> encerrou a passagem
LEITURAS_IDADE = 12      # votação das últimas N leituras (estabiliza a faixa)
DT_MAXIMO_S = 1.0        # intervalo máximo contado entre dois frames (evita saltos)
OLHAR_SEGURA_S = 0.4     # piscadas/giros rápidos não "desligam" o olhar na hora
PRESENTE_ATE_S = 0.8     # sem detecção por esse tempo: some do retrato ao vivo


def faixa_da_idade(idade: float | None) -> str | None:
    if idade is None:
        return None
    if idade < FAIXAS[0][2]:
        return MENOR
    for slug, _, _, maximo in FAIXAS:
        if idade < maximo:
            return slug
    return FAIXAS[-1][0]


class _ClassificadorFaixas:
    """Classificador treinado (numpy puro): características do genderage -> probabilidade por faixa."""

    def __init__(self, caminho: Path):
        d = np.load(caminho)
        self.info = json.loads(str(d["info"]))
        assert self.info["classes"] == CLASSES, "classificador treinado com outras faixas"
        self.media, self.desvio = d["media"], d["desvio"]
        self.camadas = [(d[f"W{i}"], d[f"b{i}"]) for i in range(len([k for k in d.files if k.startswith("W")]))]

    def probabilidades(self, entrada: np.ndarray) -> np.ndarray:
        h = (entrada - self.media) / self.desvio
        for i, (W, b) in enumerate(self.camadas):
            h = h @ W + b
            if i < len(self.camadas) - 1:
                h = np.maximum(h, 0)                  # ReLU (MLP)
        h = np.exp(h - h.max())
        return h / h.sum()


class _Pessoa:
    """Uma pessoa acompanhada enquanto está na frente da câmera (sem identificação)."""

    def __init__(self, numero: int, caixa: tuple[float, float, float, float], agora: float):
        self.numero = numero
        self.caixa = caixa                    # x1, y1, x2, y2 (normalizados 0..1)
        self.inicio = agora
        self.ultimo = agora
        self.idades: deque[float] = deque(maxlen=LEITURAS_IDADE)
        self.probs: deque[np.ndarray] = deque(maxlen=LEITURAS_IDADE)
        self.atencao_s = 0.0
        self.olhando = False
        self.olhou_em = 0.0                        # último frame com o rosto virado para a tela
        self.frames = 0
        self.contextos: Counter[str] = Counter()   # "standby" (vendo anúncio) ou "uso"

    @property
    def idade(self) -> float | None:
        return statistics.median(self.idades) if self.idades else None

    @property
    def faixa(self) -> str | None:
        if self.probs:
            return CLASSES[int(np.argmax(np.sum(self.probs, axis=0)))]
        return faixa_da_idade(self.idade)

    @property
    def confianca(self) -> float | None:
        if not self.probs:
            return None
        media = np.mean(self.probs, axis=0)
        return float(media.max())


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    uniao = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / uniao if uniao > 0 else 0.0


class MotorVisao:
    def __init__(self, ao_sair: Callable[[dict[str, Any]], None] | None = None):
        import mediapipe as mp
        import onnxruntime as ort

        # model_selection=1: rostos até ~5 m (público passando em frente ao totem)
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.55)
        # com o classificador treinado, o genderage também devolve as características do rosto
        self._classificador = None
        modelo = MODELO_IDADE
        if MODELO_CARACTERISTICAS.exists() and CLASSIFICADOR_FAIXAS.exists():
            try:
                self._classificador = _ClassificadorFaixas(CLASSIFICADOR_FAIXAS)
                modelo = MODELO_CARACTERISTICAS
            except Exception as exc:
                print(f"[Visão] classificador de faixas indisponível ({exc}); usando a idade crua", flush=True)
        self._idade = ort.InferenceSession(str(modelo), providers=["CPUExecutionProvider"])
        self._entrada = self._idade.get_inputs()[0].name
        self._cnn = self._cnn_info = None
        if MODELO_CNN.exists() and MODELO_CNN_INFO.exists():
            try:
                import tensorflow as tf
                self._cnn = tf.lite.Interpreter(model_path=str(MODELO_CNN), num_threads=2)
                self._cnn.allocate_tensors()
                self._cnn_entrada = self._cnn.get_input_details()[0]["index"]
                self._cnn_saida = self._cnn.get_output_details()[0]["index"]
                self._cnn_info = json.loads(MODELO_CNN_INFO.read_text())
                assert self._cnn_info["classes"] == CLASSES, "CNN treinada com outras faixas"
            except Exception as exc:
                self._cnn = None
                print(f"[Visão] CNN de faixas indisponível ({exc})", flush=True)
        self._pessoas: list[_Pessoa] = []
        self._proximo = 1
        self._lock = threading.Lock()
        self._ao_sair = ao_sair
        # acumuladores por alvo ("anuncio:12", "sessao:abc"): atenção e quem olhou
        self._alvos: dict[str, dict[str, Any]] = {}

    # ─── estimativas por rosto ──────────────────────────────────────────────
    @property
    def modelo_info(self) -> dict[str, Any]:
        if self._cnn is not None:
            return {"treinado": True, **self._cnn_info}
        if self._classificador is None:
            return {"treinado": False, "classes": CLASSES}
        return {"treinado": True, **self._classificador.info}

    def _estimar_idade(self, frame: np.ndarray, caixa_px: tuple[int, int, int, int]) -> tuple[float, np.ndarray | None] | None:
        x1, y1, x2, y2 = caixa_px
        w, h = x2 - x1, y2 - y1
        if w < 24 or h < 24:          # rosto pequeno demais (longe): estimativa ruim
            return None
        # Recorte como no InsightFace: centro do rosto, lado = 1,5x o maior lado, 96x96
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        escala = 96 / (max(w, h) * 1.5)
        M = np.array([[escala, 0, 48 - cx * escala], [0, escala, 48 - cy * escala]], dtype=np.float32)
        recorte = cv2.warpAffine(frame, M, (96, 96), borderValue=0.0)
        if self._cnn is not None:
            # mesmo recorte, em 112x112, para a CNN de faixas (RGB 0..255; ela normaliza sozinha)
            e = LADO_CNN / (max(w, h) * 1.5)
            M2 = np.array([[e, 0, LADO_CNN / 2 - cx * e], [0, e, LADO_CNN / 2 - cy * e]], dtype=np.float32)
            rgb = cv2.cvtColor(cv2.warpAffine(frame, M2, (LADO_CNN, LADO_CNN), borderValue=0.0), cv2.COLOR_BGR2RGB)
            self._cnn.set_tensor(self._cnn_entrada, rgb[None].astype(np.float32))
            self._cnn.invoke()
            probs_cnn = self._cnn.get_tensor(self._cnn_saida)[0].copy()
        # o modelo normaliza sozinho (Sub/Mul na entrada): pixels crus, RGB
        blob = cv2.dnn.blobFromImage(recorte, 1.0, (96, 96), (0, 0, 0), swapRB=True)
        saidas = self._idade.run(None, {self._entrada: blob})
        idade = float(saidas[0][0][2] * 100)     # [gênero, gênero, idade/100] — gênero é ignorado
        if self._cnn is not None:
            return idade, probs_cnn
        if self._classificador is None:
            return idade, None
        entrada = np.concatenate([[idade], saidas[1][0]]).astype(np.float32)
        return idade, self._classificador.probabilidades(entrada)

    @staticmethod
    def _esta_olhando(pontos) -> bool:
        """Rosto virado para a tela: nariz centrado entre os olhos (giro lateral) e
        entre olhos e boca (cabeça não muito baixa/alta)."""
        olho_d, olho_e, nariz, boca = pontos[0], pontos[1], pontos[2], pontos[3]
        dist_olhos = abs(olho_e.x - olho_d.x)
        if dist_olhos < 1e-3:
            return False
        giro = (nariz.x - (olho_d.x + olho_e.x) / 2) / dist_olhos
        altura_olhos = (olho_d.y + olho_e.y) / 2
        vertical = (nariz.y - altura_olhos) / max(boca.y - altura_olhos, 1e-3)
        return abs(giro) < 0.33 and 0.2 < vertical < 0.85

    # ─── processamento de um frame ──────────────────────────────────────────
    def processar(self, frame: np.ndarray, alvos: list[str] | None = None,
                  agora: float | None = None, contexto: str = "standby") -> dict[str, Any]:
        agora = agora or time.time()
        alvos = [a for a in (alvos or []) if a]
        altura, largura = frame.shape[:2]
        resultado = self._detector.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        deteccoes = []
        for d in resultado.detections or []:
            r = d.location_data.relative_bounding_box
            caixa = (max(r.xmin, 0.0), max(r.ymin, 0.0),
                     min(r.xmin + r.width, 1.0), min(r.ymin + r.height, 1.0))
            deteccoes.append((caixa, d.location_data.relative_keypoints))

        with self._lock:
            for alvo in alvos:
                self._alvos.setdefault(alvo, {"atencao_s": 0.0, "pessoas": {}, "inicio": agora})

            livres = list(self._pessoas)
            for caixa, pontos in deteccoes:
                # associa ao rosto mais parecido do frame anterior (sobreposição)
                melhor = max(livres, key=lambda p: _iou(p.caixa, caixa), default=None)
                if melhor is not None and _iou(melhor.caixa, caixa) > 0.25:
                    pessoa = melhor
                    livres.remove(melhor)
                else:
                    pessoa = _Pessoa(self._proximo, caixa, agora)
                    self._proximo += 1
                    self._pessoas.append(pessoa)
                dt = min(agora - pessoa.ultimo, DT_MAXIMO_S)
                pessoa.caixa, pessoa.ultimo = caixa, agora
                pessoa.frames += 1
                # olhar: liga no primeiro frame de frente; só desliga depois de
                # OLHAR_SEGURA_S sem olhar (uma piscada ou giro rápido não zera)
                de_frente = self._esta_olhando(pontos)
                if de_frente:
                    pessoa.olhou_em = agora
                pessoa.olhando = de_frente or agora - pessoa.olhou_em < OLHAR_SEGURA_S
                pessoa.contextos[contexto] += 1

                # idade: todo frame até ter 6 leituras (faixa sai rápido), depois a cada 3
                if de_frente and (len(pessoa.idades) < 6 or pessoa.frames % 3 == 0):
                    caixa_px = (int(caixa[0] * largura), int(caixa[1] * altura),
                                int(caixa[2] * largura), int(caixa[3] * altura))
                    leitura = self._estimar_idade(frame, caixa_px)
                    if leitura is not None:
                        pessoa.idades.append(leitura[0])
                        if leitura[1] is not None:
                            pessoa.probs.append(leitura[1])

                if pessoa.olhando and dt > 0:
                    pessoa.atencao_s += dt
                    for alvo in alvos:
                        acc = self._alvos[alvo]
                        acc["atencao_s"] += dt
                        acc["pessoas"][pessoa.numero] = pessoa

            # quem saiu da frente da câmera encerra a passagem
            for pessoa in [p for p in self._pessoas if agora - p.ultimo > PERDIDO_APOS_S]:
                self._pessoas.remove(pessoa)
                if self._ao_sair and pessoa.frames >= 2:
                    self._ao_sair({
                        "inicio": pessoa.inicio, "fim": pessoa.ultimo,
                        "faixa": pessoa.faixa, "olhou": pessoa.atencao_s >= 0.5,
                        "idade": round(pessoa.idade) if pessoa.idade is not None else None,
                        "confianca": round(pessoa.confianca, 2) if pessoa.confianca is not None else None,
                        "atencao_s": round(pessoa.atencao_s, 1),
                        "contexto": pessoa.contextos.most_common(1)[0][0],
                    })
            return self._retrato(agora)

    def _retrato(self, agora: float) -> dict[str, Any]:
        """Público agora: quem está na frente e quem está olhando, por faixa."""
        presentes = [p for p in self._pessoas if agora - p.ultimo < PRESENTE_ATE_S]
        olhando = [p for p in presentes if p.olhando]
        faixas = Counter(p.faixa for p in olhando if p.faixa in SLUGS_FAIXAS)
        total = sum(faixas.values())
        # altura do maior rosto em relação ao frame: quanto maior, mais perto do totem
        altura = lambda p: p.caixa[3] - p.caixa[1]
        return {
            "proximidade": round(max(map(altura, presentes), default=0.0), 3),
            "proximidade_olhando": round(max(map(altura, olhando), default=0.0), 3),
            "active": True,
            "face_count": len(presentes),
            "looking": bool(olhando),
            "pessoas": len(presentes),
            "olhando": len(olhando),
            "faixas": {f: faixas.get(f, 0) for f in SLUGS_FAIXAS},
            "proporcao": {f: round(faixas.get(f, 0) / total, 2) if total else 0 for f in SLUGS_FAIXAS},
            "dominante": faixas.most_common(1)[0][0] if faixas else None,
            "age_group": faixas.most_common(1)[0][0] if faixas else None,   # compatibilidade
            "menores": sum(1 for p in olhando if p.faixa == MENOR),
            # cada pessoa olhando agora (sem identificação): faixa e confiança, para o painel ao vivo
            "rostos": [{"faixa": p.faixa, "confianca": round(p.confianca, 2) if p.confianca is not None else None,
                        "olhando": p.olhando, "proximidade": round(altura(p), 3)}
                       for p in sorted(presentes, key=altura, reverse=True)[:6]],
            "atualizado": agora,
        }

    # ─── anúncios e sessões ─────────────────────────────────────────────────
    def fechar_alvo(self, alvo: str) -> dict[str, Any]:
        """Encerra o acumulador de um anúncio/sessão e devolve o resumo da audiência."""
        with self._lock:
            acc = self._alvos.pop(alvo, None)
        if not acc:
            return {"espectadores": 0, "atencao_s": 0.0, "faixas": {f: 0 for f in SLUGS_FAIXAS}}
        faixas = Counter(p.faixa for p in acc["pessoas"].values() if p.faixa in SLUGS_FAIXAS)
        return {
            "espectadores": len(acc["pessoas"]),
            "atencao_s": round(acc["atencao_s"], 1),
            "faixas": {f: faixas.get(f, 0) for f in SLUGS_FAIXAS},
        }

    def retrato(self) -> dict[str, Any]:
        with self._lock:
            return self._retrato(time.time())
