"""Converte a CNN Keras para TFLite e grava o JSON de informações para o painel."""
import sys, json
import tensorflow as tf
keras_path, saida_tflite, saida_json, metricas_cnn, metricas_base = sys.argv[1:6]
m = tf.keras.models.load_model(keras_path)
conv = tf.lite.TFLiteConverter.from_keras_model(m)
conv.optimizations = [tf.lite.Optimize.DEFAULT]       # pesos em 8 bits: menor e mais rápido
open(saida_tflite, "wb").write(conv.convert())
info = {"classes": ["menor", "18-28", "28-38", "38-48", "48-58", "58-68", "68-78", "78-88"],
        "modelo": "cnn", "arquitetura": "MobileNetV3-Small (ImageNet) ajustada",
        "dataset": "UTKFace (cropped, 23.7 mil rostos com idade)",
        "amostras_treino": int(sys.argv[6]), "amostras_teste": int(sys.argv[7]),
        "metricas": {"cnn": json.loads(metricas_cnn), "base": json.loads(metricas_base)}}
open(saida_json, "w").write(json.dumps(info, ensure_ascii=False, indent=1))
print("ok")
