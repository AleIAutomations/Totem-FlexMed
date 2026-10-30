# FlexMed — vídeo de motion vertical (storyboard)

Vídeo de ~60 s, 1080×1920 (4K opcional), 60 fps, em loop e sem som, para rodar em TVs em pé num evento de tecnologia.
Este documento é para revisão **antes** de renderizar. Nada abaixo foi inventado: cada tela e cada número vem do repositório (fonte entre parênteses).

---

## 1. O que o projeto realmente tem (Passo 0)

### Telas reais que entram no vídeo
| Tela / componente | Origem no código | Onde aparece |
|---|---|---|
| Faixa azul do topo (marca, Libras, idioma, hora) | `index.html #hdr`, `totem.css` | cenas 2–5 |
| Saudação + busca grande com microfone | `#s-area`, `atualizarSaudacao()` | cena 2 e 3 |
| Categorias em blocos com ícones próprios | `chipHtml()`, `icones.js` (`FlexIcones`) | cena 2 |
| Card de produto (foto, -%, "de", preço verde, "Últimas unidades", ℞) | `productCardHtml()` | cenas 2, 3, 5 |
| Assistente com transcrição ao vivo | `#agent`, `voz.js` | cena 3 |
| Painel de Libras | `#o-lb`, `libras_integration.js` | cena 4 |
| Página do produto ("Onde encontrar", quantidade, adicionar) | `#detail` | cena 5 |
| Voo até o carrinho + pop-up "Fechar pedido" (o momento autoral do totem) | `voarParaCarrinho()`, `mostrarAdicionado()`, `.ad-*` | cena 5 |
| Barra do carrinho | `renderNav()`, `.dock-*` | cenas 2–5 |
| Revisão do pedido e código de retirada (ex.: `DP40`) | `abrirPedido()`, `checkoutCart()`, `.cart-*` | cena 5 |
| Quadro do balcão (Novos → Separando → Prontos) | `admin.html` Pedidos, `admin_pedidos.js` | cena 5 |
| Anúncio em tela cheia (standby) | `#standby-overlay`, `campaign_player.js` | cena 2 |

**Como a UI real entra:**
- O `serve.mjs` lê o `frontend/index.html` real a cada execução, tira os scripts dele e injeta o controlador do vídeo. O CSS (`styles.css`, `totem.css`) e o `icones.js` são os arquivos reais.
- As telas são montadas pelas **funções reais do `script.js`**, extraídas em tempo de execução pelo nome: `productCardHtml`, `chipHtml`, `renderNav`, `atualizarDock`, `openDetail`, `renderRodapeDetalhe`, `mostrarAdicionado`, `addChatMessage`, `agFalaAoVivo`, `mostrarResultadoVoz`, `renderCart`, `mostrarCodigoPedido` e as auxiliares. Se o totem mudar, o vídeo acompanha.
- Nessas funções, `setTimeout`, `requestAnimationFrame` e `fetch` são trocados por versões neutras, e as animações e transições de CSS ficam desligadas. O estado de cada quadro vem só do `renderFrame(n)`.
- O zoom da câmera usa o mesmo mecanismo do totem em pé (`zoom: var(--k)` no `styles.css`).
- Dados: 100% fictícios, em `content.json`. As embalagens são desenhadas no próprio vídeo, sem marca.

### Tecnologias que existem e vou destacar
| Ideia visual | Prova (fonte) |
|---|---|
| **Enxerga sem guardar**: a câmera conta quem passa, se olhou e a faixa etária, e nada mais | 0 imagens guardadas; ~6 frames/s analisados (`audiencia.js`, `visao.py`) |
| **Anúncio escolhido pelo público**: o anúncio muda conforme a faixa de idade de quem está olhando | MobileNetV3 ajustada, 90,2% de acerto até 1 faixa, testada com 3.514 rostos (`modelos/faixas_cnn.json`) |
| **Acorda quando você chega** | distância e tempo configuráveis: 120 cm, 1,5 s olhando (`/api/presenca/config`) |
| **Entende a fala, mesmo errada** | Whisper rodando no próprio aparelho; "ir de piruna" vira "dipirona" por semelhança fonética com o catálogo (`assistente.py`) |
| **Responde falando** | a resposta é lida em voz alta pela síntese de voz do próprio aparelho (`voz.js › falar`) |
| **Entende sintomas** | "dor de cabeça" leva aos analgésicos; 15 grupos de sintomas (`assistente.py › SINTOMAS`) |
| **Atende em Libras** | 20 letras + 9 sinais em movimento; mãos, rosto e postura (MediaPipe Holistic + Conv1D/LSTM) (`libras/models`) |
| **Estoque e balcão de verdade** | reserva no pedido, lote que vence antes sai primeiro (FEFO), código de retirada (`loja.py`) |
| **Processa na borda, sincroniza na nuvem** | visão, voz e Libras rodam no notebook da loja; SQLite primeiro, Supabase a cada 15 s (`nuvem.py`) |
| **Mede tudo** | funil passou → olhou → usou → pediu → retirou (`marketing.py`) |

### O que o briefing cita e **não existe** no código
| Pedido | Situação no repositório | Proposta |
|---|---|---|
| IA conversacional / LLM | Não há LLM. O assistente é Whisper + correção fonética + mapa de sintomas sobre o catálogo da loja | Mostrar como "entende pedido e sintoma, treinado no catálogo da própria farmácia", que é verdade |
| Voz sintética (ElevenLabs) | Não há ElevenLabs. O totem responde em voz pela síntese do próprio navegador (`speechSynthesis`) | Waveform e legenda para a fala do cliente (branca) e para a resposta do totem (azul) |
| Pagamento | Não existe. O pedido é pago e retirado no balcão com um código | O fluxo termina no código de retirada e no quadro do balcão |
| Impressão | Não existe | Fica de fora |
| Offline | Métricas são offline-first; o catálogo depende do Supabase | Dizer "processa na loja" e não "funciona offline" |

---

## 2. Direção visual

- **Fundo:** azul-noite derivado da marca (`--tv-tinta` #0b1b33 → `--tv-azul-escuro` #003b97), com um brilho azul `--tv-azul` #0057d9 que respira devagar. A grade é feita de pontos: a mesma grade de 24 dos ícones do totem, ampliada.
- **Acento único:** vermelho `--tv-vermelho` #e3001b só onde o totem já usa vermelho (ação e desconto). Verde `--tv-verde` só em preço.
- **Tipo:** Atkinson Hyperlegible Next, a mesma do totem, feita para baixa visão. É coerente com o produto e lê bem a 5 m. Arquivo local, via `@fontsource`.
- **Legibilidade a 5 m:** numa TV de 55" em pé, 1 px ≈ 0,63 mm.
  - Texto de leitura: mínimo de 56 px (≈ 3,5 cm de altura).
  - Títulos: de 120 a 190 px.
  - Números de prova: 220 px ou mais.
  - Uma frase por vez na tela.
- **Margens de segurança:** 5% (54 px nas laterais, 96 px no topo e na base). Nada importante fora disso.
- **O totem em cena:** a tela real em proporção 9:16, com moldura fina e sombra profunda.
  - A câmera virtual dá zoom no detalhe que importa (o preço, o código, a transcrição), porque a UI inteira não se lê a 5 m.
- **Movimento** (das skills instaladas: `animate`, `apple-design`, `remotion-best-practices`, `impeccable/animate`):
  - Entradas com `cubic-bezier(0.16, 1, 0.3, 1)`, a mesma curva `--tv-entrada` do totem.
  - Deslocamentos com `cubic-bezier(0.77, 0, 0.175, 1)`.
  - Mola sem quique nos objetos físicos: o produto voando e os nós do diagrama.
  - Nada linear, exceto a waveform e o brilho de fundo.
  - Nunca `scale(0)`: entradas partem de 0,94 com opacidade.
  - Escalonamento de 40 a 80 ms em listas.
  - Uma ideia por cena.
- **Evito de propósito:** rótulos em caixa alta, fonte mono para números, logos empilhados e entradas iguais em todo bloco.

---

## 3. Cena a cena (60 fps · 3.600 quadros)

| # | Tempo | Quadros | Cena | O que se vê | Por quê |
|---|---|---|---|---|---|
| 1 | 0–4 s | 0–239 | **Gancho** | Fundo vivo. Um anel de foco encontra um ponto no centro e trava: "**Esta tela sabe quando você olha.**" (palavra por palavra, mola). O anel vira o contorno do totem. | Em 2 s quem passa entende que é sobre uma tela que reage. Curiosidade sem jargão. |
| 2 | 4–12 s | 240–719 | **Acorda quando você chega** | O totem em pé mostra o anúncio real do modo de espera, com o aviso de LGPD. A distância desce de 260 para 120 cm e o anel "olhando" fecha em 1,5 s, em tempo real (cronômetro linear). Um pulso sai do totem e o anúncio dá lugar à tela inicial real (saudação, busca, categorias, cards). | Mostra o produto e o primeiro truque já nos 10 s. |
| 3 | 12–22 s | 720–1319 | **Fala, mesmo errado** | Zoom no assistente real. Waveform do cliente e legenda ao vivo: "tem **ir de piruna**?". O trecho errado se desfaz em rosa e "**dipirona**" entra letra por letra, sublinhado (prova da correção fonética). Os cards reais aparecem e o totem responde em voz: waveform azul e legenda "Encontrei 3 produtos para dipirona." Prova: "Whisper no próprio aparelho". | A IA treinada na base própria: o vocabulário é o catálogo da loja. |
| 4 | 22–30 s | 1320–1799 | **E em Libras** | Painel de Libras real. Pontos de mão, rosto e ombros (esqueleto abstrato, sem pessoa) fazem o sinal: a mão sobe até a têmpora e toca três vezes. Ao reconhecer, a mão fica verde e a frase aparece: "**Dor de cabeça**". Prova: "20 letras · 9 sinais / mãos, rosto e postura". | Diferencial raro e humano: acessibilidade de verdade. Marketing forte em evento. |
| 5 | 30–40 s | 1800–2399 | **Do toque ao balcão** | Página do produto ("Onde encontrar: Prateleira B3") → toque em Adicionar → **o produto voa até o botão** (o momento autoral do totem) → pop-up "Adicionado" com sugestões → revisão do pedido → "Enviar ao balcão" → código **DP40** → o pedido aparece no quadro do balcão e anda de Novos para Separando e Prontos. | Resolve o atendimento de ponta a ponta, com estoque reservado. |
| 6 | 40–50 s | 2400–2999 | **Por dentro** | O diagrama se monta, uma camada por vez, com dados descendo pelos fios: **Totem** (câmera, microfone, toque) → **Na loja** (MediaPipe, CNN de idade, Whisper, LibrasFlow) → **SQLite** → **Supabase**. Depois, 26 pontos anônimos se agrupam por faixa etária; a faixa dominante (28–38) troca o anúncio da casa por um escolhido para ela. Por fim, os números: "90,2%", "6", "0". | Para devs, investidores e empresas: arquitetura real, provas reais. |
| 7 | 50–60 s | 3000–3599 | **Fechamento** | "Nenhuma imagem guardada. Só o que importa." → tagline → **FlexMed** → QR code e contato. Nos 1,5 s finais, tudo se dissolve de volta ao fundo vivo do quadro 0. | Gera contato. O loop emenda sem corte. |

**Loop:** o fundo (brilho, grade, partículas) é periódico com período de 60 s, então o quadro 3600 é igual ao quadro 0. A cena 1 começa no fundo vazio e a cena 7 termina nele.

---

## 4. Tagline (configurável em `content.json`)

Proposta principal: **"O balcão que entende você."**

Alternativas:
- "Ouve, vê e atende. Sem guardar quem você é."
- "Autoatendimento que enxerga, ouve e fala Libras."

---

## 5. Como vai ser construído

- Tudo é **renderFrame(n)**, uma função pura de `n` (t = n/60).
  - Sem relógio, sem `Math.random()` (o ruído é um hash de `n` e do índice) e sem animação de CSS rodando sozinha.
- **Determinismo:** o Chrome roda em modo de render determinístico (rasterização por software, compositor completo antes de desenhar). `npm run verificar` confere o hash de 16 quadros em ordens diferentes e a emenda do loop.
- **Por que não Remotion:** a skill `remotion-best-practices` foi instalada e as ideias dela foram usadas: `interpolate()` com faixa de quadros, molas puras e sequências.
  - O Remotion é React, e a UI do totem é HTML/JS puro. Para reaproveitar a UI real sem reescrever em JSX, o motor é próprio e pequeno.
  - O Remotion exige licença paga para empresas com mais de 3 pessoas.
- **Render:** `playwright-core` com o Chrome já instalado (1080×1920, `deviceScaleFactor` 1; ou 2 para o 4K, sem tocar nas cenas).
  - Cada quadro é capturado em PNG e enviado por pipe ao `ffmpeg-static` (H.264, `yuv420p`, CRF 15, `preset slow`, `+faststart`).
  - Fonte e imagens ficam locais. Nada de CDN no render.
- **Comandos:** `npm run render`, `npm run render:4k`, `npm run preview` (slider de quadro) e `--frames a:b`.

---

## 6. Decisões (padrões adotados, editáveis em `content.json`)

1. **Embalagens:** fictícias, desenhadas no vídeo, com nomes genéricos e só medicamentos de venda livre. As fotos de `frontend/assets/` (marcas reais, inclusive um medicamento sob prescrição) não aparecem.
2. **Contato do QR code:** **placeholder** `https://flexmed.example.com`. **Troque antes de exibir** (`contato.qr`, `contato.linha2`).
3. **Tecnologias:** só o que existe no código. Nada de LLM, ElevenLabs ou pagamento.
4. **Tagline:** "O balcão que entende você." (`tagline`).
