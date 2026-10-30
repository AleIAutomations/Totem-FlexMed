# Treino do classificador de faixa etária

Faixas: menor de 18, 18-28, 28-38, 38-48, 48-58, 58-68, 68-78, 78-88.

1. `genderage_feat.onnx` = `genderage.onnx` com a saída extra `flatten_258` (256 características da
   penúltima camada). Gerado com o pacote `onnx` (num venv separado, ele conflita com o TensorFlow do Libras):
   `m = onnx.load("genderage.onnx"); m.graph.output.append(onnx.helper.make_tensor_value_info("flatten_258", onnx.TensorProto.FLOAT, None)); onnx.save(m, "genderage_feat.onnx")`
2. Base: UTKFace cropped (`py97/UTKFace-Cropped` no Hugging Face, ~23,7 mil rostos com idade; uso acadêmico).
3. `python -I extrair_features.py <pasta UTKFace> ../modelos/genderage_feat.onnx features.npz`
   (detecção MediaPipe + recorte iguais aos do totem; cada foto gera também uma versão "câmera ruim").
4. `python -I treinar_faixas.py features.npz ../modelos/faixas_idade.npz`
   — compara com a idade crua do genderage e salva o melhor modelo. Resultado em `resultado_treino.txt`.

Nenhuma foto do totem é usada ou guardada (LGPD): o treino usa só a base pública.

## Modelo principal: CNN (faixas_cnn.tflite)

Melhor que o classificador acima; o totem usa ele quando `faixas_cnn.tflite` + `faixas_cnn.json` existem.

1. `python -I extrair_recortes.py <pasta UTKFace> recortes.npz` (recortes 112x112 iguais aos do totem)
2. `python -I treinar_cnn.py recortes.npz faixas_cnn.keras 10` (MobileNetV3-Small ImageNet, ~7 min num M4)
3. Converter para TFLite via SavedModel (`model.export(pasta)` + `TFLiteConverter.from_saved_model(pasta)`;
   a conversão direta do Keras falha no TF 2.16).

Teste (3.514 rostos): faixa exata 56,4% (genderage cru: 36,2%) · até 1 faixa de distância 90,2% (82,9%).
