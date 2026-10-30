# =============================================================================
# LibrasFlow v2 — main.py
# Reconhecimento em tempo real via webcam
# Combina modelo estático (letras/sinais) + modelo de vídeo (palavras)
# =============================================================================

import os
import sys
import cv2
import numpy as np
import time
from collections import deque

from config import (
    MODELS_DIR, LABEL_ENCODER_PATH,
    MODELO_ESTATICO_PATH, MODELO_VIDEO_PATH,
    N_FRAMES, N_TOTAL, N_ESTATICO,
    CAMERA_INDEX, JANELA_PREDICAO,
    LIMIAR_CONFIANCA, ESTABILIDADE_FRAMES,
    MP_MIN_DETECTION, MP_MIN_TRACKING
)
from utils import (
    criar_holistic, extrair_keypoints_frame,
    extrair_keypoints_estatico, normalizar_por_ombro,
    padronizar_sequencia, desenhar_landmarks,
    criar_hands, mp_hands
)

os.makedirs(MODELS_DIR, exist_ok=True)


# =============================================================================
# Carregamento dos modelos
# =============================================================================
def carregar_modelos():
    import tensorflow as tf

    modelos = {}

    if os.path.exists(MODELO_ESTATICO_PATH) and os.path.exists(LABEL_ENCODER_PATH):
        modelos["estatico"] = tf.keras.models.load_model(MODELO_ESTATICO_PATH)
        modelos["classes_estatico"] = np.load(LABEL_ENCODER_PATH, allow_pickle=True)
        print(f"[OK] Modelo estático carregado — {len(modelos['classes_estatico'])} classes")
    else:
        print("[--] Modelo estático não encontrado")

    classes_video_path = os.path.join(MODELS_DIR, "classes_video.npy")
    if os.path.exists(MODELO_VIDEO_PATH) and os.path.exists(classes_video_path):
        modelos["video"] = tf.keras.models.load_model(MODELO_VIDEO_PATH)
        modelos["classes_video"] = np.load(classes_video_path, allow_pickle=True)
        print(f"[OK] Modelo de vídeo carregado  — {len(modelos['classes_video'])} classes")
    else:
        print("[--] Modelo de vídeo não encontrado")

    if not modelos:
        print("\n[ERRO] Nenhum modelo encontrado.")
        print("Execute primeiro:")
        print("  python scripts/coleta.py --tudo")
        print("  python scripts/treinar.py --tudo")
        sys.exit(1)

    return modelos


# =============================================================================
# Predição estática (frame atual)
# =============================================================================
def predizer_estatico(modelos, results_hands):
    if "estatico" not in modelos:
        return None, 0.0

    kpts = extrair_keypoints_estatico(results_hands)
    if kpts is None:
        return None, 0.0

    entrada = kpts.reshape(1, -1).astype(np.float32)
    pred = modelos["estatico"].predict(entrada, verbose=0)[0]
    idx = np.argmax(pred)
    confianca = float(pred[idx])

    if confianca < LIMIAR_CONFIANCA:
        return None, confianca

    return modelos["classes_estatico"][idx], confianca


# =============================================================================
# Predição de vídeo (sequência de frames)
# =============================================================================
def predizer_video(modelos, buffer_frames):
    if "video" not in modelos or len(buffer_frames) < N_FRAMES:
        return None, 0.0

    seq = padronizar_sequencia(list(buffer_frames), N_FRAMES)
    seq = normalizar_por_ombro(seq)
    entrada = seq.reshape(1, N_FRAMES, N_TOTAL).astype(np.float32)

    pred = modelos["video"].predict(entrada, verbose=0)[0]
    idx = np.argmax(pred)
    confianca = float(pred[idx])

    if confianca < LIMIAR_CONFIANCA:
        return None, confianca

    return modelos["classes_video"][idx], confianca


# =============================================================================
# Interface visual
# =============================================================================
def desenhar_ui(frame, resultado_estatico, conf_est,
                resultado_video, conf_vid,
                frase_atual, modo, fps):
    h, w = frame.shape[:2]

    # Painel superior (fundo semitransparente)
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 110), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)

    # Título
    cv2.putText(frame, "LibrasFlow v2", (10, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 2)

    # FPS
    cv2.putText(frame, f"FPS: {fps:.0f}", (w - 110, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)

    # Modo atual
    cor_modo = (0, 255, 150) if modo == "VIDEO" else (255, 200, 0)
    cv2.putText(frame, f"Modo: {modo}", (10, 55),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, cor_modo, 2)

    # Resultado estático
    if resultado_estatico:
        txt = f"Letra/Sinal: {resultado_estatico}  ({conf_est*100:.0f}%)"
        cv2.putText(frame, txt, (10, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 200, 0), 2)

    # Resultado vídeo
    if resultado_video:
        txt = f"Palavra: {resultado_video}  ({conf_vid*100:.0f}%)"
        cv2.putText(frame, txt, (10, 105),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 150), 2)

    # Frase formada (painel inferior)
    overlay2 = frame.copy()
    cv2.rectangle(overlay2, (0, h - 70), (w, h), (20, 20, 20), -1)
    cv2.addWeighted(overlay2, 0.6, frame, 0.4, 0, frame)

    cv2.putText(frame, "Frase:", (10, h - 48),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1)
    cv2.putText(frame, frase_atual[-60:] if len(frase_atual) > 60 else frase_atual,
                (10, h - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)

    # Atalhos
    guia = "[V] Modo video  [E] Modo estatico  [SPACE] Adicionar  [C] Limpar  [Q] Sair"
    cv2.putText(frame, guia, (10, h - 75),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (140, 140, 140), 1)

    return frame


# =============================================================================
# Loop principal
# =============================================================================
def main():
    print("\n" + "=" * 60)
    print("  LibrasFlow v2 — Reconhecimento em Tempo Real")
    print("=" * 60)

    modelos = carregar_modelos()

    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    if not cap.isOpened():
        print(f"[ERRO] Câmera {CAMERA_INDEX} não encontrada.")
        print("Tente outro índice em config.py (CAMERA_INDEX = 1 ou 2)")
        sys.exit(1)

    # Buffers
    buffer_video   = deque(maxlen=N_FRAMES)      # frames para predição de vídeo
    historico_est  = deque(maxlen=ESTABILIDADE_FRAMES)
    historico_vid  = deque(maxlen=ESTABILIDADE_FRAMES)

    # Estado
    frase_atual       = ""
    resultado_estatico = None
    resultado_video    = None
    conf_est = conf_vid = 0.0
    modo = "VIDEO" if "video" in modelos else "ESTATICO"

    # FPS
    t_prev = time.time()
    fps = 0.0

    print(f"\nCâmera aberta! Modo inicial: {modo}")
    print("Pressione Q para sair\n")

    with criar_holistic(static_mode=False) as holistic, \
         criar_hands(static_mode=False) as hands:

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # FPS
            t_now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(t_now - t_prev, 1e-6))
            t_prev = t_now

            # Espelha horizontalmente (mais intuitivo para o usuário)
            frame = cv2.flip(frame, 1)
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img_rgb.flags.writeable = False

            # Processa com MediaPipe
            results_holistic = holistic.process(img_rgb)
            results_hands    = hands.process(img_rgb)
            img_rgb.flags.writeable = True

            # Desenha landmarks
            frame = desenhar_landmarks(frame, results_holistic)

            # Extrai keypoints do frame atual
            kpts_frame = extrair_keypoints_frame(results_holistic)
            buffer_video.append(kpts_frame)

            # Predição conforme modo
            if modo == "ESTATICO":
                label, conf = predizer_estatico(modelos, results_hands)
                historico_est.append(label)
                # Confirma só se os últimos N frames concordam
                if historico_est.count(label) >= ESTABILIDADE_FRAMES - 1 and label:
                    resultado_estatico = label
                    conf_est = conf
                else:
                    resultado_estatico = None

            elif modo == "VIDEO":
                if len(buffer_video) == N_FRAMES:
                    label, conf = predizer_video(modelos, buffer_video)
                    historico_vid.append(label)
                    if historico_vid.count(label) >= ESTABILIDADE_FRAMES - 1 and label:
                        resultado_video = label
                        conf_vid = conf
                    else:
                        resultado_video = None

            # Desenha interface
            frame = desenhar_ui(
                frame,
                resultado_estatico, conf_est,
                resultado_video, conf_vid,
                frase_atual, modo, fps
            )

            cv2.imshow("LibrasFlow v2", frame)

            # Teclado
            tecla = cv2.waitKey(1) & 0xFF

            if tecla == ord("q") or tecla == 27:
                break

            elif tecla == ord("v") and "video" in modelos:
                modo = "VIDEO"
                buffer_video.clear()
                print("[MODO] Vídeo ativado")

            elif tecla == ord("e") and "estatico" in modelos:
                modo = "ESTATICO"
                print("[MODO] Estático ativado")

            elif tecla == ord(" "):
                # Adiciona resultado à frase
                palavra = resultado_video if modo == "VIDEO" else resultado_estatico
                if palavra:
                    frase_atual += palavra + " "
                    print(f"[FRASE] {frase_atual}")

            elif tecla == ord("c"):
                frase_atual = ""
                print("[FRASE] Limpa")

            elif tecla == ord("s"):
                # Salva screenshot
                nome = f"screenshot_{int(time.time())}.png"
                cv2.imwrite(nome, frame)
                print(f"[SALVO] {nome}")

    cap.release()
    cv2.destroyAllWindows()
    print("\nLibrasFlow encerrado.")


if __name__ == "__main__":
    main()
