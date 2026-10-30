# =============================================================================
# LibrasFlow v2 — gravar_dataset.py
# Grava vídeos da webcam e organiza automaticamente em dataset/videos/<sinal>/
# =============================================================================

import cv2
import os
import sys
import time
import argparse
from progress import ProgressMeter, format_seconds

from config import (
    DATASET_VIDEOS_DIR,
    N_VIDEOS_POR_SINAL,
    FPS_GRAVACAO, DURACAO_SINAL, CAMERA_INDEX
)

os.makedirs(DATASET_VIDEOS_DIR, exist_ok=True)


def gravar_sinal(nome_sinal, numero, cap, n_frames_total):
    pasta = os.path.join(DATASET_VIDEOS_DIR, nome_sinal)
    os.makedirs(pasta, exist_ok=True)

    caminho = os.path.join(pasta, f"{numero:03d}.mp4")
    fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
    out     = cv2.VideoWriter(caminho, fourcc, FPS_GRAVACAO, (640, 480))

    gravado = 0
    inicio = time.time()
    while gravado < n_frames_total:
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.flip(frame, 1)
        out.write(frame)

        # Barra de progresso
        prog = int((gravado / n_frames_total) * frame.shape[1])
        cv2.rectangle(frame, (0, frame.shape[0] - 18),
                      (prog, frame.shape[0]), (0, 220, 0), -1)
        cv2.putText(frame,
                    f"GRAVANDO [{numero + 1}/{N_VIDEOS_POR_SINAL}]: {nome_sinal.upper()}",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 220), 2)
        if gravado % max(1, FPS_GRAVACAO // 2) == 0:
            elapsed = time.time() - inicio
            rate = max((gravado + 1) / max(elapsed, 1e-9), 1e-9)
            eta = (n_frames_total - gravado - 1) / rate
            print(f"[gravação] {nome_sinal} {numero + 1}/{N_VIDEOS_POR_SINAL} | frame {gravado + 1}/{n_frames_total} | ETA {format_seconds(eta)}", flush=True)
        cv2.imshow("LibrasFlow — Gravação", frame)
        cv2.waitKey(1)
        gravado += 1

    out.release()


def main():
    parser = argparse.ArgumentParser(description="LibrasFlow v2 — Gravar Dataset")
    parser.add_argument("--sinais", nargs="+", required=True,
                        help="Lista de sinais a gravar. Ex: --sinais oi tchau obrigado")
    parser.add_argument("--n", type=int, default=N_VIDEOS_POR_SINAL,
                        help=f"Vídeos por sinal (padrão: {N_VIDEOS_POR_SINAL})")
    args = parser.parse_args()

    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    if not cap.isOpened():
        print(f"[ERRO] Câmera {CAMERA_INDEX} não encontrada.")
        sys.exit(1)

    n_frames_total = int(DURACAO_SINAL * FPS_GRAVACAO)

    for sinal in args.sinais:
        pasta = os.path.join(DATASET_VIDEOS_DIR, sinal)
        ja_gravados = len([f for f in os.listdir(pasta) if f.endswith(".mp4")]) \
                      if os.path.exists(pasta) else 0

        if ja_gravados >= args.n:
            print(f"[PULAR] '{sinal}' já tem {ja_gravados} vídeos.")
            continue

        meter_sinal = ProgressMeter(args.n - ja_gravados, label=f"gravar:{sinal}", every=1)
        for i in range(ja_gravados, args.n):
            # Contagem regressiva
            for ct in range(3, 0, -1):
                ret, frame = cap.read()
                if not ret:
                    break
                frame = cv2.flip(frame, 1)
                cv2.putText(frame, f"Próximo sinal: {sinal.upper()}",
                            (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 220, 255), 2)
                cv2.putText(frame, f"Gravação {i + 1}/{args.n}",
                            (10, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (200, 200, 200), 2)
                cv2.putText(frame, f"Preparar em {ct}...",
                            (10, 175), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 255, 100), 3)
                cv2.imshow("LibrasFlow — Gravação", frame)
                cv2.waitKey(1000)

            gravar_sinal(sinal, i, cap, n_frames_total)
            meter_sinal.update(i - ja_gravados + 1, f"salvo={i + 1:03d}.mp4")
            time.sleep(0.3)

        meter_sinal.done(f"{args.n} vídeos em {pasta}")
        print(f"[OK] '{sinal}' — {args.n} vídeos gravados em {pasta}")

        # Pausa entre sinais diferentes
        ret, frame = cap.read()
        if ret:
            frame = cv2.flip(frame, 1)
            cv2.putText(frame, "Sinal concluído! ENTER para próximo ou Q para sair",
                        (10, frame.shape[0] // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 255, 0), 2)
            cv2.imshow("LibrasFlow — Gravação", frame)
            tecla = cv2.waitKey(0) & 0xFF
            if tecla == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()
    print("\n[CONCLUÍDO] Dataset de vídeos atualizado.")
    print(f"Execute agora: python scripts/coleta.py --videos")


if __name__ == "__main__":
    main()
