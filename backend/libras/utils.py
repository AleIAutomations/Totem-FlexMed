# =============================================================================
# LibrasFlow v2 — Utilitários: extração de keypoints e normalização
# =============================================================================

import cv2
import numpy as np
import mediapipe as mp
import sys
import os

from config import (
    FACE_INDICES_EXPRESSIVOS, POSE_INDICES_TORSO,
    N_FACE, N_POSE, N_MAOS, N_TOTAL, N_ESTATICO,
    MP_MIN_DETECTION, MP_MIN_TRACKING
)

# -----------------------------------------------------------------------------
# Inicialização do MediaPipe
# -----------------------------------------------------------------------------
mp_holistic = mp.solutions.holistic
mp_hands    = mp.solutions.hands
mp_drawing  = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles


def criar_holistic(static_mode=False):
    """Retorna instância configurada do MediaPipe Holistic."""
    return mp_holistic.Holistic(
        static_image_mode=static_mode,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=MP_MIN_DETECTION,
        min_tracking_confidence=MP_MIN_TRACKING,
    )


def criar_hands(static_mode=True, max_maos=2, deteccao=0.4, rastreamento=0.5):
    """Retorna instância configurada do MediaPipe Hands.

    Padrões = coleta de imagens estáticas. Ao vivo (letras no totem) o reconhecedor usa
    1 mão e limiares mais altos: menos falsos positivos e menos processamento por quadro.
    """
    return mp_hands.Hands(
        static_image_mode=static_mode,
        max_num_hands=max_maos,
        model_complexity=1,                 # o mesmo da coleta: landmarks comparáveis ao treino
        min_detection_confidence=deteccao,
        min_tracking_confidence=rastreamento,
    )


# -----------------------------------------------------------------------------
# Extração de keypoints — frame completo (vídeo)
# -----------------------------------------------------------------------------
def extrair_keypoints_frame(results):
    """
    Extrai keypoints completos de um frame processado pelo MediaPipe Holistic.
    Retorna vetor de shape (N_TOTAL,) = ~333 valores.
    Cobre: face expressiva + pose torso + mão esquerda + mão direita.
    """
    # Face mesh — pontos expressivos
    if results.face_landmarks:
        face = np.array([
            [results.face_landmarks.landmark[i].x,
             results.face_landmarks.landmark[i].y,
             results.face_landmarks.landmark[i].z]
            for i in FACE_INDICES_EXPRESSIVOS
        ]).flatten()
    else:
        face = np.zeros(N_FACE)

    # Pose — somente torso pra cima
    if results.pose_landmarks:
        pose = np.array([
            [results.pose_landmarks.landmark[i].x,
             results.pose_landmarks.landmark[i].y,
             results.pose_landmarks.landmark[i].z,
             results.pose_landmarks.landmark[i].visibility]
            for i in POSE_INDICES_TORSO
        ]).flatten()
    else:
        pose = np.zeros(N_POSE)

    # Mão esquerda
    if results.left_hand_landmarks:
        mao_esq = np.array([
            [lm.x, lm.y, lm.z]
            for lm in results.left_hand_landmarks.landmark
        ]).flatten()
    else:
        mao_esq = np.zeros(21 * 3)

    # Mão direita
    if results.right_hand_landmarks:
        mao_dir = np.array([
            [lm.x, lm.y, lm.z]
            for lm in results.right_hand_landmarks.landmark
        ]).flatten()
    else:
        mao_dir = np.zeros(21 * 3)

    return np.concatenate([face, pose, mao_esq, mao_dir])


# -----------------------------------------------------------------------------
# Extração de keypoints — imagem estática (1 mão)
# -----------------------------------------------------------------------------
def extrair_keypoints_estatico(results_hands, largura=1, altura=1):
    """
    Extrai keypoints de uma mão de uma imagem estática (MediaPipe Hands).
    Retorna vetor normalizado de shape (N_ESTATICO,) = 63 valores.

    largura/altura: tamanho da imagem em pixels. O MediaPipe devolve x e y em fração da
    largura e da altura; numa imagem que não é quadrada (a câmera em pé do totem, 480x640)
    isso achata a mão. Em pixels a geometria é a real. Numa imagem quadrada (o dataset)
    o resultado é o mesmo de antes, porque a normalização abaixo tira a escala.
    """
    if not results_hands.multi_hand_landmarks:
        return None

    landmarks = results_hands.multi_hand_landmarks[0].landmark
    # z do MediaPipe Hands está na mesma escala de x
    pts = np.array([[lm.x * largura, lm.y * altura, lm.z * largura] for lm in landmarks])

    # Normaliza: subtrai a base do pulso (landmark 0)
    pts = pts - pts[0]

    # Escala pela maior distância ao pulso
    escala = np.max(np.linalg.norm(pts, axis=1)) + 1e-6
    pts = pts / escala

    return pts.flatten()


# -----------------------------------------------------------------------------
# Normalização por ombro (vídeos)
# -----------------------------------------------------------------------------
def normalizar_por_ombro(keypoints_seq):
    """
    Normaliza uma sequência de keypoints (shape: N_frames x N_TOTAL)
    usando a posição e distância entre os ombros como referência.
    Torna o modelo invariante à distância da câmera e posição na tela.
    """
    # Ombros ficam na região da pose, após a face
    # pose começa em N_FACE, ombro_esq = índice 1, ombro_dir = índice 2
    pose_start = N_FACE
    ombro_esq_idx = pose_start + 4   # x,y,z,vis do ponto 1 (ombro esq)
    ombro_dir_idx = pose_start + 8   # x,y,z,vis do ponto 2 (ombro dir)

    seq_norm = keypoints_seq.copy()

    for i, frame in enumerate(keypoints_seq):
        oe = frame[ombro_esq_idx:ombro_esq_idx + 3]
        od = frame[ombro_dir_idx:ombro_dir_idx + 3]

        centro = (oe + od) / 2.0
        escala = np.linalg.norm(od - oe) + 1e-6

        # Aplica em todos os triplets x,y,z do frame
        frame_norm = frame.copy()
        for j in range(0, N_TOTAL - 1, 3):
            frame_norm[j]     = (frame[j]     - centro[0]) / escala
            frame_norm[j + 1] = (frame[j + 1] - centro[1]) / escala
            frame_norm[j + 2] = (frame[j + 2] - centro[2]) / escala

        seq_norm[i] = frame_norm

    return seq_norm


# -----------------------------------------------------------------------------
# Padronização de sequências para N_FRAMES
# -----------------------------------------------------------------------------
def padronizar_sequencia(frames_list, n_frames=30):
    """
    Recebe lista de arrays (frames extraídos de um vídeo) e
    retorna array de shape (n_frames, N_TOTAL) sempre com o mesmo tamanho,
    seja interpolando (vídeo curto) ou subamostrando (vídeo longo).
    """
    arr = np.array(frames_list)
    total = len(arr)

    if total == 0:
        return np.zeros((n_frames, N_TOTAL))

    if total == n_frames:
        return arr

    # Indices igualmente espaçados no intervalo do vídeo original
    indices = np.linspace(0, total - 1, n_frames).astype(int)
    return arr[indices]


# -----------------------------------------------------------------------------
# Desenho dos landmarks na imagem
# -----------------------------------------------------------------------------
def desenhar_maos(image, results_hands):
    """Desenha as mãos de um resultado do MediaPipe Hands (modo só letras)."""
    for mao in results_hands.multi_hand_landmarks or []:
        mp_drawing.draw_landmarks(
            image, mao, mp_hands.HAND_CONNECTIONS,
            mp_drawing_styles.get_default_hand_landmarks_style(),
            mp_drawing_styles.get_default_hand_connections_style(),
        )
    return image


def desenhar_landmarks(image, results):
    """Desenha todos os landmarks detectados na imagem."""
    if results.face_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.face_landmarks,
            mp_holistic.FACEMESH_CONTOURS,
            landmark_drawing_spec=None,
            connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_contours_style(),
        )
    if results.pose_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.pose_landmarks,
            mp_holistic.POSE_CONNECTIONS,
            mp_drawing_styles.get_default_pose_landmarks_style(),
        )
    if results.left_hand_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.left_hand_landmarks,
            mp_holistic.HAND_CONNECTIONS,
            mp_drawing_styles.get_default_hand_landmarks_style(),
        )
    if results.right_hand_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.right_hand_landmarks,
            mp_holistic.HAND_CONNECTIONS,
            mp_drawing_styles.get_default_hand_landmarks_style(),
        )
    return image
