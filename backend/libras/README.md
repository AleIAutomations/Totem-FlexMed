# LibrasFlow v2 — FlexMed v5

Reconhecimento de Libras do FlexMed: modelo estático (letras) e modelo de vídeo (palavras), sobre pontos do MediaPipe.

## Modo ao vivo (totem e notebook)

Definido em `config.py › LIBRAS_MODO`. Também dá para trocar sem editar código, com `LIBRAS_MODO=completo` no `backend/.env`.

| Modo | O que reconhece | Rastreamento | Uso |
|---|---|---|---|
| `letras` (padrão) | alfabeto da pasta `dataset/train` (20 letras) | MediaPipe **Hands**, 1 mão, detecção a cada quadro (~10 ms) | totem |
| `completo` | letras + palavras (`dataset/videos`) | MediaPipe **Holistic**: rosto, postura e mãos (~28 ms) | experimental |

Como uma letra entra na frase, no modo letras:
- a mão fica parada;
- a mesma letra é prevista com confiança ≥ 0,80 em 85% das predições dos últimos 0,6 s (no mínimo 4). A letra sai ~0,6 s depois que a mão para. A regra é por tempo, então vale a 6 ou a 30 quadros/s.
- Até 15% dos quadros da janela (pelo menos 1) podem discordar sem desfazer a letra: a letra diferente num quadro, ou o pulso fora do lugar porque a detecção oscilou.
- Num quadro deitado (câmera do notebook, 1280×720), se a mão não for achada no quadro inteiro, há uma segunda tentativa no quadrado central. O detector de palma reduz a imagem, e de longe a mão fica pequena demais.
- Para repetir a mesma letra, tire a mão da frente da câmera e mostre de novo.

Qual câmera: por padrão, quem toca em Libras no totem sinaliza em frente à **câmera do notebook**. O backend reconhece na taxa da câmera. O totem busca o vídeo quadro a quadro em `/libras/quadro` (640 px, sempre o mais recente). Para voltar à câmera do totem: `FLEXMED_LIBRAS_CAMERA=totem` no `backend/.env`.

Os ajustes ficam em `config.py`: `LETRA_*`.

## Treinar só as letras (a pasta `train`)

```bash
cd backend/libras
../../.venv/bin/python coleta.py --imagens      # pontos da mão de dataset/train → data/dados_estaticos.npy
../../.venv/bin/python treinar.py --estatico    # → models/modelo_estatico.h5 + classes_estatico.npy
```

- O treino aumenta os dados só no conjunto de treino: espelho (a outra mão), rotação de ±15° e ruído. As letras com poucas fotos (A) recebem peso maior.
- O acerto por letra e as confusões vão para `models/relatorio_estatico.txt`.
- As fotos são quadros sequenciais das mesmas gravações, então a validação aleatória é otimista. Teste ao vivo.
- Depois de treinar: `./flexmed.sh reiniciar` na raiz do projeto.

As features da mão são calculadas **em pixels** (`extrair_keypoints_estatico(res, largura, altura)`). Por isso a câmera em pé do totem (480×640) não distorce a mão. Nas fotos quadradas do dataset, o resultado é idêntico ao formato antigo.

## Tudo (palavras também)

```bash
python verificar_dataset.py
python coleta.py --tudo
python treinar.py --tudo
python main.py            # janela OpenCV local
```

## Dataset

```text
dataset/train/<letra>/*.png|jpg       (recortes de mão 64x64; B está vazia, A tem só 37)
dataset/videos/<sinal>/*.mp4|avi|mov|webm
dataset/pdfs/*.pdf
```

## Backup

`backup/2026-10-24_antes_letras/` tem os modelos, os dados e o código de antes da mudança para o modo letras. Para voltar ao modelo antigo, copie `models/` e `data/` de lá.

Os scripts imprimem progresso e ETA no terminal.
