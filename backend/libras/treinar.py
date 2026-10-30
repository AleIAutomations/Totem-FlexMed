# =============================================================================
# LibrasFlow v2 — Treinamento
# Modelo Estático:  Dense (imagens/PDFs → letras e sinais estáticos)
# Modelo de Vídeo:  CNN temporal + LSTM (vídeos → palavras com movimento)
# Modelo Unificado: combina os dois via ensemble na inferência
# =============================================================================

import os
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from progress import KerasProgressCallback

from config import (
    DATA_DIR, MODELS_DIR, DATASET_IMAGENS_DIR, CLASSES_ESTATICO_PATH,
    NPY_ESTATICO, NPY_LABELS_EST,
    NPY_SEQUENCIAS, NPY_LABELS_SEQ,
    LABEL_ENCODER_PATH,
    MODELO_ESTATICO_PATH, MODELO_VIDEO_PATH,
    N_ESTATICO, N_TOTAL, N_FRAMES,
    EPOCHS_ESTATICO, EPOCHS_VIDEO, BATCH_SIZE,
    VALIDATION_SPLIT, LEARNING_RATE
)

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)


# =============================================================================
# Utilitários de treinamento
# =============================================================================
def _encode_labels(y_raw, classes):
    """Converte labels string para índices inteiros."""
    classe_idx = {c: i for i, c in enumerate(classes)}
    return np.array([classe_idx[label] for label in y_raw])


def _plot_historico(historico, nome, pasta):
    """Salva gráfico de acurácia e loss do treinamento."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))

    ax1.plot(historico.history["accuracy"],     label="treino")
    ax1.plot(historico.history["val_accuracy"], label="validação")
    ax1.set_title("Acurácia")
    ax1.set_xlabel("Época")
    ax1.legend()

    ax2.plot(historico.history["loss"],     label="treino")
    ax2.plot(historico.history["val_loss"], label="validação")
    ax2.set_title("Loss")
    ax2.set_xlabel("Época")
    ax2.legend()

    plt.tight_layout()
    caminho = os.path.join(pasta, f"historico_{nome}.png")
    plt.savefig(caminho)
    plt.close()
    print(f"  Gráfico salvo: {caminho}")


def _aumentar_estatico(X, y, copias=4, semente=42):
    """Aumento de dados para letras (vetores de 21 pontos já normalizados pelo pulso).

    As fotos do dataset são recortes de 64 px, sempre com a mesma mão e quase o mesmo
    ângulo; ao vivo a mão gira um pouco, pode ser a outra mão e os pontos tremem.
      - espelho: inverte x (a mesma letra feita com a outra mão)
      - rotação no plano da imagem de ±15°
      - ruído gaussiano leve nos pontos
    Só o conjunto de treino é aumentado; a validação usa as fotos originais.
    """
    rng = np.random.default_rng(semente)
    pts = X.reshape(-1, 21, 3)
    base = [pts, pts * np.array([-1.0, 1.0, 1.0])]          # original + espelhado
    saida_X, saida_y = [p.reshape(len(X), -1) for p in base], [y, y]
    for _ in range(copias):
        for p in base:
            ang = rng.uniform(-np.pi / 12, np.pi / 12, size=len(X))
            c, s_ = np.cos(ang)[:, None], np.sin(ang)[:, None]
            q = p.copy()
            q[:, :, 0], q[:, :, 1] = c * p[:, :, 0] - s_ * p[:, :, 1], s_ * p[:, :, 0] + c * p[:, :, 1]
            q += rng.normal(0, 0.015, size=q.shape)
            q /= np.max(np.linalg.norm(q, axis=2), axis=1)[:, None, None] + 1e-6   # mesma escala da extração
            saida_X.append(q.reshape(len(X), -1)); saida_y.append(y)
    return np.concatenate(saida_X).astype(np.float32), np.concatenate(saida_y)


def _relatorio_estatico(modelo, X_val, y_val, classes, caminho):
    """Acerto por letra na validação (fotos originais) e as confusões mais comuns."""
    pred = np.argmax(modelo.predict(X_val, verbose=0), axis=1)
    linhas = [f"Validação: {np.mean(pred == y_val) * 100:.2f}% ({len(y_val)} fotos)", "", "Acerto por letra:"]
    for i, c in enumerate(classes):
        m = y_val == i
        if m.any():
            linhas.append(f"  {c}: {np.mean(pred[m] == i) * 100:5.1f}%  ({m.sum()} fotos)")
    confusoes = {}
    for v, p in zip(y_val, pred):
        if v != p:
            confusoes[(classes[v], classes[p])] = confusoes.get((classes[v], classes[p]), 0) + 1
    linhas += ["", "Confusões mais comuns (era → previu):"]
    linhas += [f"  {a} → {b}: {n}" for (a, b), n in sorted(confusoes.items(), key=lambda x: -x[1])[:10]] or ["  nenhuma"]
    with open(caminho, "w") as f:
        f.write("\n".join(linhas) + "\n")
    print("\n".join("  " + l for l in linhas[:1]))
    print(f"  Relatório por letra: {caminho}")


# =============================================================================
# MODELO 1 — Estático (imagens + PDFs)
# Arquitetura: Dense com BatchNorm e Dropout
# Entrada: vetor (63,) de keypoints normalizados de 1 mão
# =============================================================================
def treinar_estatico():
    """Treina o modelo de reconhecimento de sinais estáticos (letras + sinais sem movimento)."""
    print("\n" + "=" * 60)
    print("  TREINAMENTO — Modelo Estático (imagens + PDFs)")
    print("=" * 60)

    if not os.path.exists(NPY_ESTATICO):
        print("[ERRO] Dados estáticos não encontrados. Execute: python scripts/coleta.py --imagens")
        return None

    import tensorflow as tf
    from tensorflow.keras import layers, models, callbacks, optimizers
    from sklearn.model_selection import train_test_split

    X = np.load(NPY_ESTATICO, allow_pickle=True).astype(np.float32)
    y_raw = np.load(NPY_LABELS_EST, allow_pickle=True)

    # Mantém só classes que têm pasta em dataset/train (descarta rótulos que
    # são nomes de PDF inteiros, gerados por coleta.py --pdfs)
    validas = {d for d in os.listdir(DATASET_IMAGENS_DIR)
               if os.path.isdir(os.path.join(DATASET_IMAGENS_DIR, d))}
    mascara = np.isin(y_raw, list(validas))
    X, y_raw = X[mascara], y_raw[mascara]
    classes = np.unique(y_raw)
    np.save(CLASSES_ESTATICO_PATH, classes)

    y = _encode_labels(y_raw, classes)
    n_classes = len(classes)

    print(f"  Amostras: {len(X)} | Classes: {n_classes} | Shape entrada: {X.shape[1]}")
    print(f"  Classes: {list(classes)}")

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=VALIDATION_SPLIT, random_state=42, stratify=y
    )
    X_train, y_train = _aumentar_estatico(X_train, y_train)
    # letras com poucas fotos (ex.: A) pesam mais, para o modelo não ignorá-las
    contagem = np.bincount(y_train, minlength=n_classes)
    pesos = {i: float(len(y_train) / (n_classes * max(n, 1))) for i, n in enumerate(contagem)}
    print(f"  Treino com aumento de dados: {len(X_train)} amostras | validação: {len(X_val)} fotos originais")

    # Arquitetura: Dense profundo com BatchNorm
    modelo = models.Sequential([
        layers.Input(shape=(N_ESTATICO,)),

        layers.Dense(512, activation="relu"),
        layers.BatchNormalization(),
        layers.Dropout(0.4),

        layers.Dense(256, activation="relu"),
        layers.BatchNormalization(),
        layers.Dropout(0.3),

        layers.Dense(128, activation="relu"),
        layers.BatchNormalization(),
        layers.Dropout(0.2),

        layers.Dense(64, activation="relu"),
        layers.Dense(n_classes, activation="softmax"),
    ], name="librasflow_estatico")

    modelo.compile(
        optimizer=optimizers.Adam(learning_rate=LEARNING_RATE),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    modelo.summary()

    cbs = [
        callbacks.EarlyStopping(patience=15, restore_best_weights=True, verbose=0),
        callbacks.ReduceLROnPlateau(factor=0.5, patience=7, min_lr=1e-5, verbose=0),
        callbacks.ModelCheckpoint(MODELO_ESTATICO_PATH, save_best_only=True, verbose=0),
        KerasProgressCallback(EPOCHS_ESTATICO, "treino_estatico"),
    ]

    historico = modelo.fit(
        X_train, y_train,
        epochs=EPOCHS_ESTATICO,
        batch_size=BATCH_SIZE,
        validation_data=(X_val, y_val),
        class_weight=pesos,
        callbacks=cbs,
        verbose=0,
    )

    _plot_historico(historico, "estatico", MODELS_DIR)

    loss, acc = modelo.evaluate(X_val, y_val, verbose=0)
    print(f"\n  Acurácia final (validação): {acc * 100:.2f}%")
    print(f"  Modelo salvo: {MODELO_ESTATICO_PATH}")
    _relatorio_estatico(modelo, X_val, y_val, classes, os.path.join(MODELS_DIR, "relatorio_estatico.txt"))

    return modelo, classes


# =============================================================================
# MODELO 2 — Vídeo (CNN temporal + LSTM)
# Arquitetura:
#   Entrada (30, 333)
#   → Conv1D para extração de padrões locais no tempo
#   → LSTM 128 (captura dependência temporal longa)
#   → LSTM 64
#   → Dense + Dropout
#   → Softmax
# =============================================================================
def treinar_video():
    """Treina o modelo de reconhecimento de palavras com movimento (vídeos)."""
    print("\n" + "=" * 60)
    print("  TREINAMENTO — Modelo de Vídeo (CNN + LSTM)")
    print("=" * 60)

    if not os.path.exists(NPY_SEQUENCIAS):
        print("[ERRO] Dados de vídeo não encontrados. Execute: python scripts/coleta.py --videos")
        return None

    import tensorflow as tf
    from tensorflow.keras import layers, models, callbacks, optimizers
    from sklearn.model_selection import train_test_split

    X = np.load(NPY_SEQUENCIAS, allow_pickle=True).astype(np.float32)
    y_raw = np.load(NPY_LABELS_SEQ, allow_pickle=True)
    classes = np.load(LABEL_ENCODER_PATH, allow_pickle=True)

    # Filtra apenas classes presentes no dataset de vídeo
    classes_video = np.unique(y_raw)
    classe_idx = {c: i for i, c in enumerate(classes_video)}
    y = np.array([classe_idx[label] for label in y_raw])
    n_classes = len(classes_video)

    print(f"  Sequências: {len(X)} | Classes: {n_classes} | Shape: {X.shape}")
    print(f"  Classes: {list(classes_video)}")

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=VALIDATION_SPLIT, random_state=42, stratify=y
    )

    # Arquitetura CNN + LSTM
    entrada = layers.Input(shape=(N_FRAMES, N_TOTAL), name="entrada_sequencia")

    # Bloco CNN: extrai padrões locais no tempo (ex: início/fim de um gesto)
    x = layers.Conv1D(64, kernel_size=3, activation="relu", padding="same")(entrada)
    x = layers.BatchNormalization()(x)
    x = layers.Conv1D(128, kernel_size=3, activation="relu", padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.2)(x)

    # Bloco LSTM: captura a sequência temporal completa do sinal
    x = layers.LSTM(128, return_sequences=True, dropout=0.2)(x)
    x = layers.LSTM(64, return_sequences=False, dropout=0.2)(x)

    # Classificação
    x = layers.Dense(128, activation="relu")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(64, activation="relu")(x)
    saida = layers.Dense(n_classes, activation="softmax", name="saida")(x)

    modelo = models.Model(inputs=entrada, outputs=saida, name="librasflow_video")

    modelo.compile(
        optimizer=optimizers.Adam(learning_rate=LEARNING_RATE),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    modelo.summary()

    # Salva mapeamento de classes do vídeo separadamente
    np.save(os.path.join(MODELS_DIR, "classes_video.npy"), classes_video)

    cbs = [
        callbacks.EarlyStopping(patience=15, restore_best_weights=True, verbose=0),
        callbacks.ReduceLROnPlateau(factor=0.5, patience=7, min_lr=1e-5, verbose=0),
        callbacks.ModelCheckpoint(MODELO_VIDEO_PATH, save_best_only=True, verbose=0),
        KerasProgressCallback(EPOCHS_VIDEO, "treino_video"),
    ]

    historico = modelo.fit(
        X_train, y_train,
        epochs=EPOCHS_VIDEO,
        batch_size=BATCH_SIZE,
        validation_data=(X_val, y_val),
        callbacks=cbs,
        verbose=0,
    )

    _plot_historico(historico, "video", MODELS_DIR)

    loss, acc = modelo.evaluate(X_val, y_val, verbose=0)
    print(f"\n  Acurácia final (validação): {acc * 100:.2f}%")
    print(f"  Modelo salvo: {MODELO_VIDEO_PATH}")

    return modelo, classes_video


# =============================================================================
# RELATÓRIO FINAL
# =============================================================================
def relatorio_final():
    """Exibe um relatório de tudo que foi treinado."""
    print("\n" + "=" * 60)
    print("  RELATÓRIO FINAL")
    print("=" * 60)

    if os.path.exists(MODELO_ESTATICO_PATH):
        print(f"  [OK] Modelo estático: {MODELO_ESTATICO_PATH}")
    else:
        print(f"  [--] Modelo estático: não treinado")

    if os.path.exists(MODELO_VIDEO_PATH):
        print(f"  [OK] Modelo de vídeo: {MODELO_VIDEO_PATH}")
    else:
        print(f"  [--] Modelo de vídeo: não treinado")

    if os.path.exists(LABEL_ENCODER_PATH):
        classes = np.load(LABEL_ENCODER_PATH, allow_pickle=True)
        print(f"\n  Classes disponíveis ({len(classes)}): {list(classes)}")

    print("\n  Para usar em tempo real: python scripts/main.py")


# =============================================================================
# MAIN
# =============================================================================
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="LibrasFlow v2 — Treinamento")
    parser.add_argument("--estatico", action="store_true", help="Treinar modelo estático")
    parser.add_argument("--video",    action="store_true", help="Treinar modelo de vídeo")
    parser.add_argument("--tudo",     action="store_true", help="Treinar ambos os modelos")
    args = parser.parse_args()

    if args.tudo or args.estatico:
        treinar_estatico()

    if args.tudo or args.video:
        treinar_video()

    if args.tudo or args.estatico or args.video:
        relatorio_final()

    if not any(vars(args).values()):
        print("Use: python scripts/treinar.py --tudo")
        print("     python scripts/treinar.py --estatico")
        print("     python scripts/treinar.py --video")
