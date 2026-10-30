# =============================================================================
# LibrasFlow v2 — Configuração Central
# =============================================================================

import os

# -----------------------------------------------------------------------------
# Caminhos do projeto
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Datasets
DATASET_IMAGENS_DIR   = os.path.join(BASE_DIR, "dataset", "train")       # imagens estáticas (letras A-Z)
DATASET_VIDEOS_DIR    = os.path.join(BASE_DIR, "dataset", "videos")       # vídeos por palavra/sinal
DATASET_PDFS_DIR      = os.path.join(BASE_DIR, "dataset", "pdfs")         # PDFs de livros de LIBRAS

# Dados processados
DATA_DIR              = os.path.join(BASE_DIR, "data")
CSV_ESTATICO          = os.path.join(DATA_DIR, "dados_estaticos.csv")     # keypoints de imagens
NPY_SEQUENCIAS        = os.path.join(DATA_DIR, "sequencias.npy")          # keypoints de vídeos
NPY_LABELS_SEQ        = os.path.join(DATA_DIR, "labels_sequencias.npy")
NPY_ESTATICO          = os.path.join(DATA_DIR, "dados_estaticos.npy")
NPY_LABELS_EST        = os.path.join(DATA_DIR, "labels_estaticos.npy")
LABEL_ENCODER_PATH    = os.path.join(DATA_DIR, "label_encoder.npy")

# Modelos
MODELS_DIR            = os.path.join(BASE_DIR, "models")
MODELO_ESTATICO_PATH  = os.path.join(MODELS_DIR, "modelo_estatico.h5")    # CNN/Dense para imagens
MODELO_VIDEO_PATH     = os.path.join(MODELS_DIR, "modelo_video.h5")       # CNN+LSTM para vídeos
MODELO_UNIFICADO_PATH = os.path.join(MODELS_DIR, "modelo_unificado.h5")   # modelo final combinado
CLASSES_ESTATICO_PATH = os.path.join(MODELS_DIR, "classes_estatico.npy")  # classes do modelo estático

# -----------------------------------------------------------------------------
# Parâmetros de extração de keypoints
# -----------------------------------------------------------------------------

# Índices da pose do MediaPipe relevantes para torso pra cima
POSE_INDICES_TORSO = [0, 11, 12, 13, 14, 15, 16, 23, 24]

# Índices do face mesh expressivos para LIBRAS
FACE_INDICES_EXPRESSIVOS = [
    70, 63, 105, 66, 107,           # sobrancelha esquerda
    336, 296, 334, 293, 300,        # sobrancelha direita
    33, 160, 158, 133, 153, 144,    # olho esquerdo
    362, 385, 387, 263, 373, 380,   # olho direito
    1, 2, 98, 327,                  # nariz
    61, 84, 17, 314, 405, 321,      # lábio superior
    78, 95, 88, 178, 87, 14,        # lábio inferior
    116, 123, 147, 213,             # bochecha esquerda
    345, 352, 376, 433,             # bochecha direita
    152, 148, 176, 149,             # queixo
]

# Tamanho do vetor por frame
N_FACE  = len(FACE_INDICES_EXPRESSIVOS) * 3   # ~57 * 3 = 171
N_POSE  = len(POSE_INDICES_TORSO) * 4         # 9 * 4  = 36
N_MAOS  = 21 * 3 * 2                          # 21 * 3 * 2 = 126
N_TOTAL = N_FACE + N_POSE + N_MAOS            # ~333 valores por frame

# Tamanho do vetor para modo estático (só mãos, sem face/pose)
N_ESTATICO = 21 * 3  # 63 valores (1 mão, normalizada)

# -----------------------------------------------------------------------------
# Parâmetros de vídeo
# -----------------------------------------------------------------------------
N_FRAMES            = 30   # frames por amostra de vídeo (padronizado)
FPS_GRAVACAO        = 30   # FPS da câmera ao gravar
DURACAO_SINAL       = 2    # segundos por gravação de sinal
N_VIDEOS_POR_SINAL  = 50   # quantidade de vídeos a gravar por sinal

# -----------------------------------------------------------------------------
# Parâmetros de treinamento
# -----------------------------------------------------------------------------
EPOCHS_ESTATICO  = 80
EPOCHS_VIDEO     = 80
BATCH_SIZE       = 16
VALIDATION_SPLIT = 0.2
LEARNING_RATE    = 0.001

# -----------------------------------------------------------------------------
# Parâmetros da câmera em tempo real
# -----------------------------------------------------------------------------
CAMERA_INDEX        = 0      # índice da webcam (0 = padrão)
JANELA_PREDICAO     = 30     # frames acumulados antes de predizer
LIMIAR_CONFIANCA    = 0.75   # confiança mínima para exibir resultado
ESTABILIDADE_FRAMES = 5      # frames consecutivos para confirmar sinal

# MediaPipe
MP_MIN_DETECTION    = 0.5
MP_MIN_TRACKING     = 0.5

# -----------------------------------------------------------------------------
# Modo do reconhecedor ao vivo (backend / totem)
#   "letras":   só o alfabeto (modelo estático), rastreando 1 mão com MediaPipe Hands.
#               Mais rápido e sem os falsos positivos do modelo de palavras.
#   "completo": letras + palavras (modelo de vídeo), com MediaPipe Holistic.
# Pode ser trocado sem editar código: LIBRAS_MODO=completo no backend/.env
# -----------------------------------------------------------------------------
LIBRAS_MODO = os.getenv("LIBRAS_MODO", "letras").strip().lower()

# Letras ao vivo (modo "letras")
LETRA_MIN_DETECCAO    = 0.6    # confiança mínima para achar a mão (corta "mãos" falsas)
LETRA_DETECCAO_LOCAL  = 0.5    # câmera do notebook (rastreamento contínuo): acha a mão mais cedo
LETRA_MIN_RASTREIO    = 0.5
LETRA_JANELA_SEG      = 0.6    # a mesma letra precisa se manter por este tempo...
LETRA_MIN_PREDICOES   = 4      # ...em pelo menos estas predições (vale para 6 ou 30 quadros/s)
LETRA_LIMIAR          = 0.80   # confiança mínima de cada predição da letra
LETRA_CONCORDANCIA    = 0.85   # fração das predições da janela que precisa ser a mesma letra
                               # (a 30 quadros/s, um quadro tremido não pode impedir a letra)
