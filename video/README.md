# FlexMed — vídeo de motion vertical

Vídeo de 60 s em loop, sem som, 1080×1920 a 60 fps, para TVs em pé em eventos. Ele usa a UI real do totem (`frontend/`) com dados fictícios. Roteiro e justificativas: [STORYBOARD.md](STORYBOARD.md).

## Comandos (dentro de `video/`)

```bash
npm install            # só na primeira vez
npm run preview        # abre o navegador com slider de quadro (← → passo, Shift = 1 s, espaço toca)
npm run render         # vídeo completo → out/totem-motion-vertical.mp4 (~11 min)
npm run render:4k      # 2160×3840 → out/totem-motion-vertical-4k.mp4
node render.mjs --frames 600:900     # só um trecho → out/trecho-600-900.mp4
node render.mjs --png 0,300,1200     # quadros soltos em PNG → out/quadros/
npm run verificar      # mesmo quadro = mesmo hash em qualquer ordem; loop sem pulo
```

Precisa do Google Chrome instalado (ou `CHROME_PATH=/caminho/do/chrome`). O ffmpeg vem do pacote `ffmpeg-static`, então não é preciso instalá-lo.

## Onde mudar o quê

| Quero mudar | Arquivo |
|---|---|
| Textos, tagline, números, contato do QR, produtos fictícios | `content.json` |
| Tempo e movimento de cada cena | `src/cenas.js` (uma função por cena; tempos em segundos) |
| Cores, tipografia e posições | `src/index.html` (bloco `<style>`) |
| Como a UI real do totem é montada em cada tela | `src/totem-controle.js` |
| Easing, mola e hash | `src/motor.js` |

## Regras do motor

- `renderFrame(n)` é função pura do quadro: `t = n / 60`. Não há relógio, `Math.random()` nem animação de CSS. O ruído vem de `hash(i, semente)`.
- Escala animada é por tamanho ou pelo `zoom` do totem, nunca por `transform: scale`. Com `scale`, o Chrome escolhe a resolução de raster pelo histórico, e o mesmo quadro sairia diferente.
- O Chrome roda em modo determinístico (`abrirChrome` em `serve.mjs`).
- O fundo é periódico em 60 s: tudo o que se repete dá um número inteiro de voltas no vídeo.

**Antes de exibir:** troque o placeholder `https://flexmed.example.com` em `content.json › contato` e rode `npm run render` de novo.
