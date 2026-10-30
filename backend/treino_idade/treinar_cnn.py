"""Ajuste fino de uma MobileNetV3-Small (ImageNet) para as 8 faixas, nos recortes do totem."""
import sys, json, time
import numpy as np, tensorflow as tf

d = np.load(sys.argv[1]); X, idade = d["X"], d["idade"]
LIMITES = [18, 28, 38, 48, 58, 68, 78]
y = np.searchsorted(LIMITES, idade, side="right")
rng = np.random.default_rng(0); idx = rng.permutation(len(X)); corte = int(len(X) * 0.8)
tr, te = idx[:corte], idx[corte:]
freq = np.bincount(y[tr], minlength=8); pc = 1 / np.sqrt(freq); pc *= len(tr) / pc[y[tr]].sum()

aug = tf.keras.Sequential([tf.keras.layers.RandomFlip("horizontal"), tf.keras.layers.RandomZoom(0.1),
                           tf.keras.layers.RandomTranslation(0.05, 0.05), tf.keras.layers.RandomContrast(0.3),
                           tf.keras.layers.RandomBrightness(0.25)])
def ruido(img):   # câmera ruim: reduz e volta
    lado = tf.random.uniform([], 40, 112, dtype=tf.int32)
    return tf.image.resize(tf.image.resize(img, [lado, lado]), [112, 112])
def prep_treino(img, lab, w):
    img = tf.cast(img, tf.float32); img = aug(img[None], training=True)[0]
    img = tf.cond(tf.random.uniform([]) < 0.5, lambda: ruido(img), lambda: img)
    return tf.clip_by_value(img, 0, 255), lab, w
ds_tr = (tf.data.Dataset.from_tensor_slices((X[tr], y[tr], pc[y[tr]].astype(np.float32))).shuffle(8000)
         .map(prep_treino, num_parallel_calls=8).batch(64).prefetch(4))
ds_te = tf.data.Dataset.from_tensor_slices((X[te].astype(np.float32), y[te])).batch(128)

base = tf.keras.applications.MobileNetV3Small(input_shape=(112, 112, 3), include_top=False, weights="imagenet",
                                              minimalistic=False, include_preprocessing=True)
x = tf.keras.layers.GlobalAveragePooling2D()(base.output)
x = tf.keras.layers.Dropout(0.3)(x)
out = tf.keras.layers.Dense(8, activation="softmax")(x)
m = tf.keras.Model(base.input, out)
loss = tf.keras.losses.SparseCategoricalCrossentropy()
t0 = time.time()
m.compile(tf.keras.optimizers.Adam(1e-3), loss, metrics=["accuracy"])
base.trainable = False; m.fit(ds_tr, epochs=2, verbose=2)
base.trainable = True
m.compile(tf.keras.optimizers.Adam(3e-4), loss, metrics=["accuracy"])
m.fit(ds_tr, epochs=int(sys.argv[3]) if len(sys.argv) > 3 else 10, validation_data=ds_te, verbose=2,
      callbacks=[tf.keras.callbacks.ReduceLROnPlateau(patience=2, factor=0.4)])
p = m.predict(ds_te, verbose=0).argmax(1)
exata = float((p == y[te]).mean()); viz = float((abs(p - y[te]) <= 1).mean())
from sklearn.metrics import balanced_accuracy_score
print(json.dumps({"exata": round(exata, 3), "vizinha": round(viz, 3),
                  "balanceada": round(float(balanced_accuracy_score(y[te], p)), 3), "min": round((time.time()-t0)/60, 1)}))
m.save(sys.argv[2])
