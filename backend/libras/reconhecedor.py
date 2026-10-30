# =============================================================================
# LibrasFlow v2 — Reconhecedor para o backend (sem janela OpenCV)
# Mesma lógica do main.py, mas sem teclado: sinais confirmados entram na frase
# automaticamente. Usado pelo CameraBroker do app.py (/frame do totem e /video_feed).
#
# Dois modos (config.LIBRAS_MODO):
#   "letras"   (padrão) só o alfabeto. MediaPipe Hands com 1 mão: o detector próprio de
#              mãos, mais preciso e várias vezes mais leve que o Holistic.
#   "completo" letras + palavras com MediaPipe Holistic (rosto, postura e mãos).
# =============================================================================

import os
import threading
import time
import unicodedata
from collections import deque

import cv2
import numpy as np

from config import (
    MODELO_ESTATICO_PATH, MODELO_VIDEO_PATH, MODELS_DIR, CLASSES_ESTATICO_PATH,
    N_FRAMES, N_TOTAL, LIMIAR_CONFIANCA, ESTABILIDADE_FRAMES,
    LIBRAS_MODO, LETRA_MIN_DETECCAO, LETRA_DETECCAO_LOCAL, LETRA_MIN_RASTREIO, LETRA_JANELA_SEG,
    LETRA_MIN_PREDICOES, LETRA_LIMIAR, LETRA_CONCORDANCIA,
)
from utils import (
    criar_holistic, criar_hands, extrair_keypoints_frame,
    extrair_keypoints_estatico, normalizar_por_ombro,
    padronizar_sequencia, desenhar_landmarks, desenhar_maos,
)

CLASSES_VIDEO_PATH = os.path.join(MODELS_DIR, "classes_video.npy")

# Janela de tempo do sinal: os vídeos de treino têm 3-6 s comprimidos em N_FRAMES.
# Ao vivo a taxa de frames varia (notebook ~20 fps, totem pela rede bem menos),
# então a janela é por tempo e reamostrada para N_FRAMES, independente do fps.
JANELA_SEGUNDOS       = 4.0
MIN_FRAMES_JANELA     = 12     # abaixo disso a janela tem pouca informação
PREDIZER_VIDEO_A_CADA = 0.2    # segundos entre predições do modelo de vídeo
FRAMES_LETRA_ESTAVEL  = 12     # predições iguais seguidas para confirmar uma letra
MOVIMENTO_MAX_LETRA   = 0.02   # desvio do pulso (coord. normalizada) p/ considerar mão parada
FRAMES_SEM_MAO_RESET  = 10     # frames sem mão para permitir repetir o mesmo sinal
PAUSA_LETRA_APOS_PALAVRA = 1.5 # segundos sem aceitar letras depois de uma palavra


def _fora_tolerados(n):
    """Quantos quadros de uma janela de n podem discordar (letra diferente ou pulso fora do
    lugar) sem desfazer a letra: (1 - LETRA_CONCORDANCIA) da janela, e pelo menos 1 a partir
    de 5 quadros (a 6 quadros/s a janela tem só ~5)."""
    return max(1, int(n * (1 - LETRA_CONCORDANCIA))) if n >= 5 else 0


class _MaosDoHolistic:
    """Expõe as mãos do Holistic no formato do MediaPipe Hands
    (multi_hand_landmarks), evitando rodar um segundo modelo de mãos por frame."""

    def __init__(self, res_holistic):
        # mão direita primeiro (a mais usada para letras), depois a esquerda
        self.multi_hand_landmarks = [m for m in (res_holistic.right_hand_landmarks,
                                                 res_holistic.left_hand_landmarks) if m]


def _xy(landmarks, com_visibilidade=False):
    if landmarks is None:
        return []
    if com_visibilidade:
        return [[round(lm.x, 3), round(lm.y, 3), round(lm.visibility, 2)] for lm in landmarks.landmark]
    return [[round(lm.x, 3), round(lm.y, 3)] for lm in landmarks.landmark]


def _pontos_para_desenho(res):
    """Landmarks do Holistic (rosto, postura, mãos) para o totem desenhar como no notebook."""
    return {
        "rosto": _xy(res.face_landmarks),
        "pose": _xy(res.pose_landmarks, com_visibilidade=True),
        "mao_esq": _xy(res.left_hand_landmarks),
        "mao_dir": _xy(res.right_hand_landmarks),
    }


def conexoes_para_desenho():
    """Ligações entre os pontos (as mesmas que o desenho_landmarks usa no notebook)."""
    import mediapipe as mp
    h = mp.solutions.holistic
    return {
        "rosto": sorted(map(list, h.FACEMESH_CONTOURS)),
        # só tronco/braços/cabeça (o totem enquadra da cintura para cima)
        "pose": sorted([a, b] for a, b in h.POSE_CONNECTIONS if a <= 24 and b <= 24),
        "mao": sorted(map(list, h.HAND_CONNECTIONS)),
    }


class ReconhecedorLibras:
    def __init__(self, modo=LIBRAS_MODO):
        self.modo = "completo" if modo == "completo" else "letras"
        self.status = "carregando"   # carregando | pronto | sem_modelos | erro
        self.erro = ""
        self.modelos = {}
        self._holistic = None
        self._hands = None              # detecção a cada quadro (quadros irregulares, pela rede)
        self._hands_continuo = None     # rastreamento contínuo (câmera do notebook, ~30 quadros/s)
        self.resetar()
        threading.Thread(target=self._carregar_modelos, daemon=True).start()

    # -------------------------------------------------------------------------
    def _carregar_modelos(self):
        try:
            import tensorflow as tf
            if os.path.exists(MODELO_ESTATICO_PATH) and os.path.exists(CLASSES_ESTATICO_PATH):
                self.modelos["estatico"] = tf.keras.models.load_model(MODELO_ESTATICO_PATH, compile=False)
                self.modelos["classes_estatico"] = np.load(CLASSES_ESTATICO_PATH, allow_pickle=True)
            if self.modo == "completo" and os.path.exists(MODELO_VIDEO_PATH) and os.path.exists(CLASSES_VIDEO_PATH):
                self.modelos["video"] = tf.keras.models.load_model(MODELO_VIDEO_PATH, compile=False)
                self.modelos["classes_video"] = np.load(CLASSES_VIDEO_PATH, allow_pickle=True)
            self.status = "pronto" if self.modelos else "sem_modelos"
        except Exception as exc:  # pragma: no cover - depende do ambiente
            self.status = "erro"
            self.erro = str(exc)
        print(f"[LibrasFlow] modo {self.modo} · modelos: {self.status} {sorted(k for k in self.modelos if not k.startswith('classes'))} {self.erro}", flush=True)

    @property
    def usa_quadro_4x3(self):
        """O Holistic/modelo de palavras quer o quadro em 4:3; as letras usam pixels e aceitam qualquer proporção."""
        return self.modo == "completo"

    def resetar(self):
        self.buffer_video = deque()    # (instante, keypoints, tem_mao) dos últimos JANELA_SEGUNDOS
        self.pulsos = deque(maxlen=10)
        self.hist_letra = deque(maxlen=FRAMES_LETRA_ESTAVEL)
        self.hist_video = deque(maxlen=ESTABILIDADE_FRAMES)
        self.ultima_predicao = 0.0
        self.frames_sem_mao = 0
        self.instante_palavra = 0.0
        self.ultimo_adicionado = None
        self.atual = ""
        self.conf_atual = 0.0
        self.maos = []                 # landmarks (x, y normalizados) das mãos do último frame
        self.pontos = {}               # rosto, postura e mãos do último frame (para desenhar no totem)
        self.letras_recentes = deque() # modo letras: (instante, letra ou None) da janela LETRA_JANELA_SEG
        self.pulsos_t = deque()        # modo letras: (instante, x, y) do pulso, em fração do maior lado

    def fechar(self):
        for detector in (self._holistic, self._hands, self._hands_continuo):
            if detector is not None:
                detector.close()
        self._holistic = None
        self._hands = None
        self._hands_continuo = None
        self.resetar()

    # -------------------------------------------------------------------------
    def _predizer(self, chave, entrada):
        pred = self.modelos[chave](entrada, training=False).numpy()[0]
        idx = int(np.argmax(pred))
        # NFC: nomes de pasta do macOS vêm decompostos ("c" + cedilha)
        label = unicodedata.normalize("NFC", str(self.modelos[f"classes_{chave}"][idx]))
        return label, float(pred[idx])

    def processar(self, frame, desenhar=True, continuo=False):
        """Processa um frame BGR (já espelhado). Retorna (frame_anotado, token_para_frase|None).

        desenhar=False: não desenha os pontos no quadro. O totem desenha sozinho com os
        pontos que recebe; só o vídeo MJPEG do notebook (/video_feed) precisa do quadro anotado.
        continuo=True: quadros regulares da câmera do notebook (rastreamento contínuo da mão).
        """
        if self.status != "pronto":
            return frame, None
        if self.modo == "letras":
            return self._processar_letras(frame, desenhar, continuo)
        return self._processar_completo(frame, desenhar)

    # -------------------------------------------------------------------------
    def _processar_letras(self, frame, desenhar=True, continuo=False):
        """Só o alfabeto: 1 mão com MediaPipe Hands e o modelo estático.

        Uma letra entra na frase quando a mão está parada e a mesma letra se mantém,
        com confiança alta, em pelo menos LETRA_CONCORDANCIA das predições dos últimos
        LETRA_JANELA_SEG (em tempo, não em quadros: funciona igual a 6 quadros/s pela
        rede do totem e a 30 na câmera do notebook).
        """
        if continuo:
            # Câmera do notebook (quadros regulares, ~30/s): rastreamento contínuo do MediaPipe,
            # que segue a mão de um quadro para o outro. Mais estável e mais leve que detectar do
            # zero em todo quadro, e não "perde" a mão entre um quadro e outro.
            if self._hands_continuo is None:
                self._hands_continuo = criar_hands(static_mode=False, max_maos=1,
                                                   deteccao=LETRA_DETECCAO_LOCAL, rastreamento=LETRA_MIN_RASTREIO)
            detector = self._hands_continuo
        else:
            # Quadros pela rede do totem: chegam em intervalos irregulares (6-15/s, alguns fora de
            # ordem e descartados) e o rastreamento seguiria a região da mão de um quadro antigo;
            # aqui a mão é detectada em todo quadro (static_image_mode).
            if self._hands is None:
                self._hands = criar_hands(static_mode=True, max_maos=1,
                                          deteccao=LETRA_MIN_DETECCAO, rastreamento=LETRA_MIN_RASTREIO)
            detector = self._hands
        agora = time.time()
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        res = detector.process(rgb)
        if not res.multi_hand_landmarks and w > h:
            res = self._maos_no_centro(rgb, res)
        if desenhar:
            frame = desenhar_maos(frame, res)

        mao = res.multi_hand_landmarks[0] if res.multi_hand_landmarks else None
        pontos_mao = [[round(lm.x, 4), round(lm.y, 4)] for lm in mao.landmark] if mao else []
        # o quadro chega espelhado; o MediaPipe também supõe imagem espelhada, então o lado já vem certo
        direita = bool(res.multi_handedness) and res.multi_handedness[0].classification[0].label == "Right"
        self.maos = [pontos_mao] if mao else []
        self.pontos = {"rosto": [], "pose": [], "mao_dir": pontos_mao if direita else [],
                       "mao_esq": [] if direita else pontos_mao}

        if mao is None:
            self.frames_sem_mao += 1
            self.pulsos_t.clear()
            self.letras_recentes.clear()
            if self.frames_sem_mao >= FRAMES_SEM_MAO_RESET:
                self.ultimo_adicionado = None
                self.atual = ""
            return frame, None
        self.frames_sem_mao = 0

        # janela de tempo: pulso (para saber se a mão está parada) e letras previstas
        lado = max(w, h)
        self.pulsos_t.append((agora, mao.landmark[0].x * w / lado, mao.landmark[0].y * h / lado))
        while self.pulsos_t and agora - self.pulsos_t[0][0] > LETRA_JANELA_SEG:
            self.pulsos_t.popleft()
        # mão parada: desvio do pulso pequeno, ignorando os quadros mais fora do lugar (a mesma
        # tolerância da concordância das letras: um quadro em que a detecção oscilou não desfaz a letra)
        pulsos = np.array([(x, y) for _, x, y in self.pulsos_t])
        perto = np.argsort(np.linalg.norm(pulsos - np.median(pulsos, axis=0), axis=1))
        pulsos = pulsos[perto[:len(pulsos) - _fora_tolerados(len(pulsos))]]
        parada = len(self.pulsos_t) >= 3 and float(np.max(np.std(pulsos, axis=0))) < MOVIMENTO_MAX_LETRA
        if not parada:
            self.letras_recentes.clear()
            return frame, None

        kpts = extrair_keypoints_estatico(res, w, h)
        label, conf = self._predizer("estatico", kpts.reshape(1, -1).astype(np.float32))
        self.letras_recentes.append((agora, label if conf >= LETRA_LIMIAR else None))
        while self.letras_recentes and agora - self.letras_recentes[0][0] > LETRA_JANELA_SEG:
            self.letras_recentes.popleft()

        recentes = [l for _, l in self.letras_recentes]
        duracao = agora - self.letras_recentes[0][0]
        if (len(recentes) >= LETRA_MIN_PREDICOES and duracao >= 0.75 * LETRA_JANELA_SEG
                and recentes[-1] == label
                and recentes.count(label) >= max(LETRA_MIN_PREDICOES, len(recentes) - _fora_tolerados(len(recentes)))):
            self.atual, self.conf_atual = label, conf
            self.letras_recentes.clear()
            return frame, self._confirmar(label, "letra")
        return frame, None

    def _maos_no_centro(self, rgb, res_inteiro):
        """Segunda tentativa no quadrado central de um quadro deitado (câmera do notebook).

        O detector de palma do MediaPipe reduz a imagem inteira: num quadro 1280x720, a mão
        de quem está a ~70 cm fica pequena e às vezes não é achada. No quadrado central
        (onde a mão fica ao sinalizar em frente ao corpo) ela ocupa uma fração bem maior.
        Os pontos voltam convertidos para o quadro inteiro.
        """
        h, w = rgb.shape[:2]
        x0 = (w - h) // 2
        if self._hands is None:          # detector por quadro (o recorte muda de tamanho: não rastreia)
            self._hands = criar_hands(static_mode=True, max_maos=1,
                                      deteccao=LETRA_MIN_DETECCAO, rastreamento=LETRA_MIN_RASTREIO)
        res = self._hands.process(np.ascontiguousarray(rgb[:, x0:x0 + h]))
        if not res.multi_hand_landmarks:
            return res_inteiro
        for mao in res.multi_hand_landmarks:
            for lm in mao.landmark:
                lm.x = (lm.x * h + x0) / w
                lm.z = lm.z * h / w          # z do MediaPipe está na escala da largura da imagem
        return res

    # -------------------------------------------------------------------------
    def _processar_completo(self, frame, desenhar=True):
        """Letras + palavras com o Holistic (o comportamento original)."""
        if self._holistic is None:
            self._holistic = criar_holistic(static_mode=False)

        agora = time.time()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        res_holistic = self._holistic.process(rgb)
        res_hands = _MaosDoHolistic(res_holistic)
        if desenhar:
            frame = desenhar_landmarks(frame, res_holistic)

        self.pontos = _pontos_para_desenho(res_holistic)
        tem_mao = bool(res_hands.multi_hand_landmarks)
        self.maos = [[[round(lm.x, 4), round(lm.y, 4)] for lm in mao.landmark]
                     for mao in (res_hands.multi_hand_landmarks or [])]
        self.buffer_video.append((agora, extrair_keypoints_frame(res_holistic), tem_mao))
        while self.buffer_video and agora - self.buffer_video[0][0] > JANELA_SEGUNDOS:
            self.buffer_video.popleft()

        if not tem_mao:
            self.frames_sem_mao += 1
            self.pulsos.clear()
            self.hist_letra.clear()
            if self.frames_sem_mao >= FRAMES_SEM_MAO_RESET:
                self.ultimo_adicionado = None
                self.atual = ""
            return frame, None
        self.frames_sem_mao = 0

        pulso = res_hands.multi_hand_landmarks[0].landmark[0]
        self.pulsos.append((pulso.x, pulso.y))

        # --- Palavra (modelo de vídeo) -----------------------------------
        janela = list(self.buffer_video)
        janela_cheia = (len(janela) >= MIN_FRAMES_JANELA
                        and janela[-1][0] - janela[0][0] >= 0.75 * JANELA_SEGUNDOS)
        if ("video" in self.modelos and janela_cheia
                and agora - self.ultima_predicao >= PREDIZER_VIDEO_A_CADA
                and sum(m for _, _, m in janela) >= len(janela) // 2):
            self.ultima_predicao = agora
            seq = normalizar_por_ombro(padronizar_sequencia([k for _, k, _ in janela], N_FRAMES))
            label, conf = self._predizer("video", seq.reshape(1, N_FRAMES, N_TOTAL).astype(np.float32))
            self.hist_video.append(label if conf >= LIMIAR_CONFIANCA else None)
            if label and self.hist_video.count(label) >= ESTABILIDADE_FRAMES - 1:
                self.atual, self.conf_atual = label, conf
                self.instante_palavra = agora
                # Exige uma janela nova inteira antes do próximo sinal, para
                # não confirmar palavras falsas na transição entre sinais
                self.buffer_video.clear()
                self.hist_video.clear()
                return frame, self._confirmar(label, "palavra")

        # --- Letra (modelo estático, só com a mão parada) -----------------
        if "estatico" in self.modelos and agora - self.instante_palavra >= PAUSA_LETRA_APOS_PALAVRA:
            parada = len(self.pulsos) >= 5 and float(np.max(np.std(np.array(self.pulsos), axis=0))) < MOVIMENTO_MAX_LETRA
            kpts = extrair_keypoints_estatico(res_hands)
            if parada and kpts is not None:
                label, conf = self._predizer("estatico", kpts.reshape(1, -1).astype(np.float32))
                self.hist_letra.append(label if conf >= LIMIAR_CONFIANCA else None)
                if (label and len(self.hist_letra) == FRAMES_LETRA_ESTAVEL
                        and self.hist_letra.count(label) == FRAMES_LETRA_ESTAVEL):
                    self.atual, self.conf_atual = label, conf
                    return frame, self._confirmar(label, "letra")
            else:
                self.hist_letra.clear()

        return frame, None

    def _confirmar(self, label, tipo):
        if label == self.ultimo_adicionado:
            return None
        self.ultimo_adicionado = label
        return (label, tipo)
