"""Treina o classificador de faixa etária do totem (18-28 ... 78-88) sobre as
características do genderage extraídas por extrair_features.py.

Compara com a linha de base (idade crua do genderage -> faixa) e salva o melhor
modelo em formato numpy (o backend roda sem scikit-learn em tempo real).
"""
import json
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier

dados, saida = sys.argv[1], sys.argv[2]
d = np.load(dados)
X, idade, foto = d["X"], d["idade"], d["foto"]

LIMITES = [18, 28, 38, 48, 58, 68, 78]            # classe 0 = menor de 18; 7 = 78-88 (e acima)
CLASSES = ["menor", "18-28", "28-38", "38-48", "48-58", "58-68", "68-78", "78-88"]
faixa = lambda a: np.searchsorted(LIMITES, a, side="right")
y = faixa(idade)

tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=0).split(X, y, foto))
media, desvio = X[tr].mean(0), X[tr].std(0) + 1e-6
Z = (X - media) / desvio

# peso por classe ~ 1/sqrt(frequência): as faixas raras (idosos) não somem, sem
# distorcer demais as comuns
freq = np.bincount(y[tr], minlength=len(CLASSES))
peso_classe = 1 / np.sqrt(np.maximum(freq, 1))
peso = peso_classe[y[tr]]
peso *= len(peso) / peso.sum()


def avaliar(nome, pred):
    exato = accuracy_score(y[te], pred)
    vizinho = float(np.mean(np.abs(pred - y[te]) <= 1))
    bal = balanced_accuracy_score(y[te], pred)
    print(f"{nome:28s} exata {exato:.3f} | ±1 faixa {vizinho:.3f} | balanceada {bal:.3f}")
    return {"exata": round(exato, 3), "vizinha": round(vizinho, 3), "balanceada": round(bal, 3)}


resultados = {"base": avaliar("genderage (idade crua)", faixa(X[te, 0]))}

lr = LogisticRegression(max_iter=3000, C=0.5)
lr.fit(Z[tr], y[tr], sample_weight=peso)
resultados["logistica"] = avaliar("regressão logística", lr.predict(Z[te]))

# MLP não aceita sample_weight nesta versão: reamostra o treino com os pesos
rng = np.random.default_rng(0)
idx = rng.choice(tr, size=len(tr), p=peso / peso.sum())
mlp = MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=200, early_stopping=True,
                    validation_fraction=0.1, random_state=0)
mlp.fit(Z[idx], y[idx])
resultados["mlp"] = avaliar("rede neural (MLP 128)", mlp.predict(Z[te]))

melhor = max(("logistica", "mlp"), key=lambda k: resultados[k]["exata"] + resultados[k]["vizinha"])
print("melhor:", melhor)
pred = (lr if melhor == "logistica" else mlp).predict(Z[te])
print("matriz de confusão (linhas = real):")
print("        " + " ".join(f"{c:>6s}" for c in CLASSES))
for c, linha in zip(CLASSES, confusion_matrix(y[te], pred, labels=range(len(CLASSES)))):
    print(f"{c:>7s} " + " ".join(f"{n:6d}" for n in linha))

if melhor == "logistica":
    camadas = {"W0": lr.coef_.T.astype(np.float32), "b0": lr.intercept_.astype(np.float32)}
else:
    camadas = {f"W{i}": w.astype(np.float32) for i, w in enumerate(mlp.coefs_)}
    camadas.update({f"b{i}": b.astype(np.float32) for i, b in enumerate(mlp.intercepts_)})

info = {
    "classes": CLASSES, "modelo": melhor, "amostras_treino": int(len(tr)), "amostras_teste": int(len(te)),
    "fotos": int(len(np.unique(foto))), "dataset": "UTKFace (cropped, 23.7 mil rostos com idade)",
    "metricas": resultados,
}
np.savez_compressed(saida, media=media.astype(np.float32), desvio=desvio.astype(np.float32),
                    info=json.dumps(info), **camadas)
print(json.dumps(info, ensure_ascii=False, indent=1))
