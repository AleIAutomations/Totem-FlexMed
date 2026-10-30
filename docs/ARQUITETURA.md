# FlexMed v5 — Arquitetura do sistema

Como o sistema é montado: componentes, fluxos de dados, módulos, APIs e armazenamento.
Este documento é atualizado sempre que algo entra ou muda na arquitetura; o histórico fica no fim.

> O que o totem faz para o cliente e para a farmácia: ver [FUNCIONALIDADES_TOTEM.md](FUNCIONALIDADES_TOTEM.md).

---

## 1. Visão geral

```text
 ┌──────────────── Totem (Android 32" em pé, Fully Kiosk) ────────────────┐
 │  index.html + JS (frontend/)                                            │
 │  câmera e microfone do totem (getUserMedia, só em HTTPS)                │
 └───────┬─────────────────────────────────────────────▲──────────────────┘
         │ HTTPS (rede local)                          │
         │ frames JPEG (~6/s), áudio, eventos           │ JSON: produtos, resultados
         ▼                                             │
 ┌──────────────── Notebook: backend Flask (backend/app.py, :5050) ────────┐
 │  serve o frontend e o admin · API REST · visão computacional · Libras   │
 │  · Whisper (voz) · SQLite local (data/flexmed.sqlite3)                  │
 └───────┬────────────────────────────────────────────────────────────────┘
         │ HTTPS (secret key só no backend/.env)
         ▼
 ┌──────────────── Supabase ───────────────────────────────────────────────┐
 │  Postgres: products, categorias, coletas, historico_precos              │
 │            totem_* (métricas e logs anônimos)                           │
 │  Storage: fotos dos produtos                                            │
 └─────────────────────────────────────────────────────────────────────────┘
```

- **Um único endereço**: o backend serve o totem (`/`), o admin (`/admin.html`) e a API, com o mesmo certificado HTTPS. O Android só libera câmera e microfone do navegador em HTTPS.
- **Processamento no notebook**: o totem só captura e exibe. Detecção de rosto, idade, Libras e transcrição de voz rodam no backend.
- **Offline-first para métricas**: tudo é gravado primeiro no SQLite local e enviado ao Supabase em segundo plano.

---

## 2. Execução

| Modo | Como | Uso |
|---|---|---|
| **Script único** | `./flexmed.sh iniciar · parar · reiniciar · status · ip · logs · dev · abrir` (raiz) | Forma recomendada. `iniciar` sobe o modo rede/totem em segundo plano (`nohup`, log em `logs/flexmed.log`, `caffeinate` preso ao PID para o Mac não dormir) e espera o `/health`; `status` testa pelo IP da rede. Também como tarefas do VS Code (`.vscode/tasks.json`). |
| Rede/totem (HTTPS) | `main/start.sh` (ou `start_windows.bat`) → `main/start.py` | Produção: o totem acessa pelo IP do notebook. Certificado em `backend/certs/`. |
| Localhost (HTTP) | `cd backend && FLEXMED_HTTPS=0 ../.venv/bin/python app.py` | Desenvolvimento no notebook. A câmera do notebook é usada no modo "server". |

**Servidor HTTPS** (`app.py › servidor_https`): o Werkzeug fazia o handshake TLS no `accept()`, na thread principal. Assim, uma conexão `http://` ou uma pré-conexão do navegador que não completa o TLS travava o servidor inteiro. Agora cada conexão é aceita crua e tratada na sua própria thread: primeiro byte TLS → handshake com limite de 10 s; HTTP comum → `301` para `https://` no mesmo endereço.

**Produtos rápidos pela rede do totem:**
- **Fotos** (`/foto/<caminho no Storage>?w=480`, `_foto_em_cache`): a foto do Supabase é baixada uma vez, reduzida (WebP, ~11 KB em média) e guardada em `backend/data/cache_fotos/<largura>/`.
  - A rota serve com cache `immutable` e só aceita caminhos do bucket.
  - `aquecer_fotos()` prepara o catálogo inteiro ao subir o servidor (307 fotos em ~44 s).
  - No totem, `script.js › getProductImagePath` troca os endereços do Storage por `/foto/…`; outros endereços seguem iguais.
  - Antes: ~840 ms e 43 KB por foto, pela internet do hotspot.
  - Se uma foto for substituída no Storage com o **mesmo nome**, apague `backend/data/cache_fotos/`.
- **Catálogo** (`listar_catalogo`): a consulta ao Supabase da `/api/products` fica em cache por 60 s (`CATALOGO_CACHE_S`). Qualquer POST/PUT/PATCH/DELETE em `/api/` limpa o cache. O estoque local é mesclado sempre na hora. Antes: 0,4–0,8 s por página; em cache, ~5 ms.
- **JSON comprimido** (`comprimir_json`): respostas JSON com mais de 2 KB saem em gzip (a página de 24 produtos cai de 45 KB para ~13 KB).

**Arquivos do frontend** (`frontend_file`):
- HTML, JS, CSS, JSON e SVG saem comprimidos em gzip, com a versão comprimida guardada em memória até o arquivo mudar. O admin cai de ~400 KB para ~90 KB.
- ETag e `Last-Modified` permitem responder 304.
- Com `?v=`, `Cache-Control: immutable` por 1 ano (o navegador nem pergunta de novo); o resto, `no-cache`. **Ao mudar um JS ou CSS, suba o `?v=` no HTML.**

**Keep-alive** (`servidor_https › ManterConexao`): a conexão TLS é reaproveitada entre requisições. O Werkzeug 3 fecha toda conexão e, depois de cada resposta, "drena" o socket com `rfile.read(10 MB)`; com keep-alive isso travava a requisição seguinte.
- O handler lê o corpo inteiro antes (até 8 MB; acima disso, ou com `Transfer-Encoding`, fica o comportamento original, que fecha a conexão).
- Durante a resposta, o Werkzeug enxerga um socket sem dados, e o dreno passa direto.
- Pelo hotspot do totem (~0,8 s de ida e volta), fechar a conexão custava TCP + TLS a cada imagem da câmera: chegou a 36–160 s por imagem.
- Conexão parada por 30 s é fechada.

Variáveis principais (`backend/.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`, `TOTEM_ID` (padrão `totem-01`), `FLEXMED_HOST/PORT`, `FLEXMED_HTTPS`, `FLEXMED_CAMERA_INDEX`.
A secret key do Supabase **nunca** vai para o frontend.

Python 3.9 (`.venv`). Bibliotecas principais: Flask, OpenCV, MediaPipe, onnxruntime, TensorFlow 2.16 (Libras e CNN de idade), faster-whisper e requests. O pacote `onnx` não deve ser instalado no `.venv`, porque troca o `ml-dtypes` exigido pelo TensorFlow; use um venv separado.

---

## 3. Frontend do totem (`frontend/`)

Scripts clássicos carregados por `index.html`, em ordem. Cada módulo expõe um objeto global `Flex*`.

| Arquivo | Responsabilidade |
|---|---|
| `api.js` | Endereço do backend (`FLEXMED_SERVER`, `FLEXMED_API_BASE`) e chamadas REST (produtos paginados, categorias, config). |
| `camera_bridge.js` (`FlexCam`) | Captura a câmera do totem e envia JPEG por `POST /frame?mode=vision|libras`, com 4 requisições em voo e descarte de frames fora de ordem. No notebook (localhost) usa a câmera do servidor. |
| `audiencia.js` (`FlexAudiencia`) | Câmera sempre ligada a ~6 fps no modo `vision`; guarda o "retrato" do público (pessoas, olhando, faixas, dominante, proximidade). Pausa para o Libras; o admin pode desligá-la. Com o painel admin aberto por cima, os frames saem sem `anuncio`. |
| `painel_admin.js` (`FlexPainelAdmin`) | Abre o `admin.html` num iframe em tela cheia (`#painel-admin`, fora do `#totem` para não herdar o zoom) em vez de trocar de página, para o index e a câmera seguirem vivos. `fechar()` é chamado pelo admin em "Ver Totem" e "Sair". |
| `sessao.js` (`FlexSessao`) | Sessão de uso anônima: id, eventos (cliques, telas, buscas, produtos, carrinho, vitrine...) enviados em lote para `/api/sessoes/<id>/eventos`. Também registra o comportamento:<br>• `clique`/`toque` com x, y (0–1) e região (`toque` = sem resposta);<br>• `tela_tempo` (duração e segundos olhando, amostrados de `FlexAudiencia` a cada 1 s);<br>• `produto_tempo` (`produtoAbriu`/`produtoRolou`/`produtoFechou`);<br>• `impressoes` (lotes de até 40 ids; `script.js › observarImpressoes`, cards ≥60% visíveis por 0,9 s);<br>• `rolagem` (linha máxima) e `layout` (caixas das regiões visíveis, uma vez por tela). |
| `campaign_player.js` | Player dos anúncios do standby, com escolha pela faixa etária dominante. Sem campanha ativa, passa os **anúncios da casa** (`_renderCasa`, um a cada 8 s): ofertas reais do catálogo (`_carregarOfertas`: os 3 maiores descontos, só fora do nicho Medicamentos, sem receita e até 70%), Libras, busca por voz, retirada no balcão e "Sua marca nesta tela". |
| `standby.js` (`__standby`) | Entra/sai do modo anúncios; abre e fecha sessões (origem `toque`, `anuncio` ou `aproximacao`). |
| `presenca.js` (`FlexPresenca`) | Regras de presença (do admin, relidas a cada 10 s): acorda por aproximação e volta aos anúncios por ausência; envia batidas e eventos. |
| `script.js` → compra | Pontos principais:<br>• `renderNav()` desenha a barra de baixo: atalhos e `#dock-carrinho`, atualizado por `atualizarDock()`;<br>• `addToCart(id, qtd, origem)` chama `voarParaCarrinho()` (Web Animations; o destino é a barra, ou o botão de adicionar quando a página do produto está aberta) e depois `mostrarAdicionado()` (pop-up com `/api/products/<id>/recomendacoes`);<br>• `abrirPedido()` abre a revisão;<br>• `falarNaBusca()` abre o assistente ouvindo;<br>• `atualizarSaudacao()` e `atualizarTituloLista()` cuidam da saudação e do título com o total;<br>• a tela de abertura (`#splash`) foi removida. |
| `script.js` → pedidos | `checkoutCart()` envia `POST /api/pedidos` e mostra o código; `addToCart()` respeita o disponível; os cards mostram `esgotado` e `ultimasUnidades` (vindos de `loja.mesclar_no_catalogo`). |
| `vitrine.js` (`FlexVitrine`) | **Vitrine entre linhas**: abre vagas na grade depois das linhas configuradas e escolhe o bloco de cada vaga quando ela se aproxima da tela, por idade (retrato da câmera) e interesse da sessão. Registra `vitrine_ver` e `vitrine_clique`. |
| `voz.js` (`FlexVoz`) | Grava o microfone, detecta silêncio e envia o áudio; transcrição parcial ao vivo. |
| `libras_integration.js` | Painel de Libras (sessão de vídeo por token, reabrir sem travar). |
| `script.js` | App principal: white label, nichos/categorias, catálogo com rolagem infinita, detalhe do produto, busca, carrinho, assistente, idiomas e avaliação. |
| `styles.css` | Estilos base; layouts `html.totem-v` (em pé, 4 por linha) e `html.totem-h`. |
| `icones.js` (`FlexIcones`) | Ícones próprios em SVG (grade de 24, traço em `currentColor` e detalhe vermelho com as classes `ac` = preenchido e `al` = traço). `FlexIcones.de(slug, nome)` busca pelo slug e, para categorias novas, por palavras do nome. Também tem `FlexIcones.receita` (℞). É usado pelo totem (`iconeCategoria()` em `script.js`) e pelo admin (`ctIcone()` em `admin_categorias.js`). |
| `totem.css` | **Identidade visual do totem de compras**, carregada depois de `styles.css` e restrita a `html.totem-v`. Tem tokens próprios (`--tv-azul`, `--tv-vermelho`, `--tv-verde` = preço, `--tv-chao`, `--tv-tinta`). As cores da identidade são fixas no totem e não seguem o `--blue` do white label. A fonte é Atkinson Hyperlegible Next. Cobre a barra do carrinho (`#nav` → `.dock-*`), o pop-up de adicionado (`.ad-*`), a revisão do pedido (`.cart-*`) e a animação `.voo-produto`, com caminho `prefers-reduced-motion`. |

**Banners do topo** (carrossel abaixo das categorias; `script.js › bannerI18n`, `renderBanners`, `bannerMidia`, `bannerAction`):
- São 3 banners em PT/EN/ES: **Ofertas da semana** (ação `ofertas`: abre o produto da maior oferta), **"Não achou? É só falar"** (`voz`: `falarNaBusca`) e **Atendimento em Libras** (`libras`: `window.openOv("o-lb")`, a versão global, para o `libras_integration.js` ligar a câmera).
- As ofertas vêm de `api.js › apiOfertasDaCasa`, a mesma lógica do descanso de tela: fora do nicho Medicamentos, sem receita, desconto de até 70%.
- A ação antiga `detail` (`openDetail(4)`, um id que não existe no catálogo real) foi removida.

**Totem e taxonomia.** `loadCategoriesFromAPI()` lê `/api/nichos` e `/api/categorias` e substitui `NICHOS`, os ícones e os nomes em português. Assim, as categorias criadas ou renomeadas no admin aparecem no totem.

**Grade e vitrine.** `loadMoreProducts()` anexa uma página (24 itens) ao `#p-grid` e chama `FlexVitrine.intercalar(grid, terminou)`.
Essa função cria `div.vt-slot[data-linha]` (que ocupa a linha inteira da grade) depois do último card de cada linha que tem bloco cadastrado. Um `IntersectionObserver` (raiz = o rolador de produtos, margem de 500 px) preenche a vaga.
Sem bloco compatível, a vaga recebe `vt-vazia` (`display:none`); ela não é removida, para não ser recriada na próxima página. `renderProducts()` chama `FlexVitrine.reiniciar()`. Os blocos são relidos a cada 60 s.

**Campanhas na grade**: `vitrine.js` também lê `/api/campaigns?active=true` (as que têm `na_vitrine`, dentro do período) e `/api/vitrine/config` (`campanhas_ativas`, `campanhas_a_cada`, padrão 5).
- Nas linhas múltiplas do intervalo e sem bloco próprio, `escolherCampanha(faixa)` prefere as da faixa presente, rodando as menos exibidas.
- Sem campanha, `escolherCasa()` usa os anúncios da casa (`ofertas`, `farmaceutico`, `voz`, `libras`; tipo de bloco `casa`, id `casa:<tipo>`). As ofertas vêm dos produtos com maior desconto, de `apiGetProductsPage`. A opção `anuncios_casa` fica em `/api/vitrine/config`.
- O bloco tem id `campanha:<id>` e classe `vt-campanha`: a arte aparece inteira, sobre ela mesma desfocada.

### Admin (`frontend/admin.html` + módulos)
Página única. Na demonstração **não pede senha**: entra como `admin`, chama `initApp()` no `load`, e "sair" volta ao totem. O totem tem um link discreto (`.hdr-admin`) que abre o `admin.html` por cima do totem (`painel_admin.js`); dentro do iframe, `verTotem()` e `doLogout()` só fecham o painel. Aberto direto (sem o totem por trás), "Ver Totem" abre nova aba e "sair" vai para `/`, como antes. `goPage(id)` mostra `#p-<id>` e marca o item `.sb-item[data-page=id]`.

**Admin aberto pelo totem:**
- A engrenagem (`.hdr-admin`) tem `onclick="event.preventDefault()"`: o link nunca navega sozinho. Pela rede lenta, um toque antes do `painel_admin.js` carregar trocava a página pelo admin, o que também derrubava a câmera e o estado do totem.
- O `painel_admin.js` é o primeiro script do `index.html`.
- O painel mostra "Carregando o painel…", com um botão "Voltar ao totem", até o admin chamar `FlexPainelAdmin.pronto()`.
- O admin inicia no `DOMContentLoaded`, sem esperar o `load`.
- O CSS do Google Fonts (admin e totem) carrega sem bloquear a tela (`media="print" onload`). Pelo hotspot, ele segurava a página inteira em branco.

Em telas estreitas (≤ 700 px, como o totem em pé, que tem 617 px CSS), o menu lateral vira uma gaveta: o botão **Menu** na barra do topo abre (`alternarMenu()`), e a gaveta fecha ao escolher uma página ou tocar fora. Antes o menu simplesmente sumia nessa largura.

A barra lateral é dividida em seções: Visão geral, Loja (Pedidos, Catálogo, Categorias, Estoque), Marketing (Painel de marketing, Vitrine, Campanhas, Audiência, Atividade), Inteligência, Totem & marca e Sistema. Os ids das páginas continuam os antigos (`produtos` = Catálogo, `iot` = Câmera & presença, `logs` = Atividade...).

| Módulo | Páginas |
|---|---|
| `admin_metricas.js` | Painel geral, Jornada do cliente, Audiência (utilitários `mt*`, `MT_FAIXAS`, `MT_CORES`). |
| `admin_catalogo.js` | Catálogo: lista com filtros, editor em abas, "Bipar código" e cadastro em lote. Utilitários da loja: `lojaBRL`, `lojaNum`, `lojaEnviar`, `lojaStatus`, `lojaFoto`, `lojaModal`. **Leitor de código** (`lojaLeitorHtml`/`lojaLeitorLigar`): aceita leitor USB/Bluetooth (age como teclado e termina com Enter) ou câmera via `BarcodeDetector`, quando o navegador tem; valida o EAN pelo dígito GS1 (`lojaEanValido`). |
| `admin_estoque.js` | Estoque: visão geral, produtos, movimentações, lotes, reposição, a janela "Movimentar" e "Receber mercadoria" (entrada em lote por bipe). |
| `admin_pedidos.js` | Pedidos (quadro, atualiza a cada 6 s) e `iniciarAvisosLoja()`, que a cada 15 s atualiza os contadores `#sb-pedidos` e `#sb-estoque` e toca um aviso quando chega pedido. |
| `admin_vitrine.js` | Vitrine. |
| `admin_marketing.js` | Painel de marketing (`/api/relatorios/marketing`) com exportação CSV. |
| `admin_atividade.js` | Atividade: abas Comportamento (mapa de calor em canvas sobre o `layout` gravado pelo totem), Sessões (replay) e Registros (`admin_logs.js`). |
| `admin_categorias.js` | Categorias e subcategorias (`/api/loja/taxonomia`); traz os mesmos ícones SVG do totem (`CT_ICONES`). |
| `admin_presenca.js` | Câmera & presença. |
| `admin_logs.js` | Atividade. |

---

## 4. Backend (`backend/`)

`app.py` cria o Flask, o SQLite (`init_db`), o **CameraBroker** e registra os blueprints.

| Módulo | Responsabilidade | Rotas |
|---|---|---|
| `app.py` | Produtos (via Supabase), categorias, config white label, campanhas, upload de mídia, câmera/Libras, frontend estático. | `/api/products*`, `/api/categorias`, `/api/config`, `/api/campaigns*`, `/api/upload`, `/uploads/campanhas/*`, `/frame`, `/video_feed`, `/libras_*`, `/vision_*` |
| `supabase_products.py` | CRUD de produtos e Storage via PostgREST. | — |
| `categorias.py` | Nichos → categorias e classificação dos produtos importados. | — |
| `recomendacoes.py` | "Leve junto" e "Parecidos". | `/api/products/<id>/recomendacoes` |
| `assistente.py` | Whisper local + interpretação do pedido (produto/sintoma) com busca aproximada. | `/api/assistente/*` |
| `imagens.py` | Pipeline de melhoria das fotos (fundo branco, recorte, nitidez, WebP). | — |
| `visao.py` (`MotorVisao`) | Rosto (MediaPipe), olhar (pose pelos pontos do rosto, com retenção de 0,4 s), faixa etária (CNN), acompanhamento de pessoas e atenção por anúncio/sessão. | — |
| `metricas.py` | Exibições de anúncio, audiência, sessões e eventos; relatórios e logs; leitura do Supabase com SQLite de reserva. | `/api/anuncios/*`, `/api/audiencia/*`, `/api/sessoes*`, `/api/relatorios/*`, `/api/logs` |
| `presenca.py` | Regras de aproximação/ausência, batidas e eventos do totem. | `/api/presenca/*` |
| `nuvem.py` | Envio das tabelas locais para `totem_*` no Supabase (a cada 15 s, upsert por cursor). | `/api/nuvem/status`, `/api/nuvem/sincronizar` |
| `vitrine.py` | Blocos da vitrine entre linhas (validação, período, mídias), relatório de exibições/toques por bloco e `vitrine_config` (intervalo das campanhas na grade). | `/api/vitrine*`, `/api/vitrine/config` |
| `taxonomia.py` | Categorias (nichos, tabela local `loja_nichos`) e subcategorias (Supabase `categorias` + `loja_categoria_meta`: nicho, ícone, ordem, ativo). Preenche a árvore padrão de `categorias.py` no primeiro uso. `/api/categorias` e o filtro `?nicho=` de `/api/products` passam por ele. | `/api/nichos`, `/api/loja/taxonomia`, `/api/loja/nichos*`, `/api/loja/categorias*` |
| `comportamento.py` | Relatório de comportamento (mapa de toques, regiões, tempo por tela, funil por produto, rolagem, por faixa, layouts). | `/api/relatorios/comportamento` |
| `marketing.py` | Painel de marketing: cruza audiência, campanhas, vitrine, sessões, eventos e pedidos. Compara com o período anterior e gera insights em texto. | `/api/relatorios/marketing` |
| `loja.py` | **Loja**: cadastro completo (grava no Supabase os campos de vitrine e no SQLite os de gestão), foto do computador (melhorada e enviada ao Storage), estoque, lotes, movimentações, pedidos, planilha, reposição e curva ABC. Também mescla o disponível e os selos nos produtos de `/api/products` e esconde esgotados quando configurado. | `/api/loja/*`, `/api/estoque*`, `/api/pedidos*` |
| `libras/` | LibrasFlow v2: modelos Keras (estático = letras, vídeo = palavras), coleta e treino. Ao vivo, `LIBRAS_MODO` (`config.py`, padrão `letras`): **letras** = MediaPipe Hands (1 mão, detecção por quadro, ~10 ms; sem mão no quadro deitado, nova tentativa no quadrado central) + modelo estático; **completo** = Holistic + os dois modelos. Ver `libras/README.md`. | `/libras/config`, `/libras/conexoes`, `/libras_start`, `/libras_stop`, `/video_feed`, `/status` |

### 4.1 Loja e estoque (`loja.py`)
- **Divisão do produto**: o Supabase `products` guarda o que o cliente vê (nome, preço, foto, descrição, categoria, ativo, receita, local). O SQLite `produto_estoque` guarda a gestão (SKU, EAN, marca, fabricante, fornecedor, unidade, custo médio, saldo, mínimo/máximo, controle ligado, galeria). A chave é `product_id` = `products.id`.
- **Caminho único do saldo**: `movimentar()` (entrada, saída, perda, devolução, ajuste = contagem, venda).
  - Atualiza o saldo e o custo médio ponderado (nas entradas com custo).
  - Distribui por lote: saídas usam FEFO, o que vence primeiro sai primeiro.
  - Grava em `estoque_movimentos`. A soma dos lotes é igual ao saldo.
- **Disponível** = saldo − itens de pedidos `novo`, `separando` e `pronto`. O pedido reserva; `entregue` gera movimentos `venda` (baixa parcial se faltar); `cancelado` só libera a reserva.
- O registro de estoque é criado sob demanda e **só nasce com controle ligado quando pedido**. Assim, os 307 importados não viram "Esgotado".
- O SKU automático segue o formato `CAT-00001` (prefixo da categoria). O EAN é validado pelo dígito GS1, e o EAN sugerido é lido da descrição (`EAN: …`).
- O catálogo do Supabase fica em cache de 20 s dentro do `loja.py`, que é invalidado a cada gravação.
- **Código de barras e lotes**:
  - `GET /api/estoque/codigo/<código>` procura pelo EAN cadastrado, pelo SKU ou pelo EAN escrito na descrição.
  - `POST /api/loja/produtos/lote` cadastra até 200 produtos e devolve o resultado por linha.
  - `POST /api/estoque/entrada-lote` grava todas as entradas numa única transação: se uma linha falhar, nada é gravado.

### 4.2 CameraBroker (câmera compartilhada)
Modos `idle | vision | libras`. Garante que audiência e Libras não disputem a câmera.
- **Totem**: os frames chegam do navegador (`/frame`).
  - **Modo letras (padrão):** o quadro vai como chegou. As features da mão são calculadas em pixels (`extrair_keypoints_estatico(res, largura, altura)`), então a câmera em pé não distorce. O servidor não desenha os pontos no quadro (`processar(..., desenhar=False)`); o totem desenha com os pontos que recebe. O totem manda o Libras com 8 envios em paralelo (`FlexCam.iniciar(..., { emVoo: 8 })`); a audiência continua com 4.
  - **Modo completo:** o quadro em pé da câmera do totem (480×640) ganha faixas pretas até 4:3 antes do reconhecimento (`_quadro_4x3`). Os pontos de mãos, rosto e postura voltam convertidos para o quadro original.
  - Motivo: o MediaPipe devolve frações de largura e altura, e com a imagem em pé a mão chega distorcida.
  - Medido com 72 vídeos do dataset, simulando a câmera do totem: acerto de 35% sem a correção e 85% com ela. Nos sinais gravados em pé, cai de 17/23 para 13/23, porque o dataset mistura ~1.850 vídeos deitados e ~1.000 em pé.
- **Notebook**: lê a câmera local; o Libras usa MJPEG em `/video_feed`, com token por sessão para que o fechamento atrasado de um stream antigo não derrube o novo.
  - **Libras no totem com a câmera do notebook** (padrão; `FLEXMED_LIBRAS_CAMERA=notebook|totem` no `.env`, exposto em `/libras/config`). O `libras_integration.js` decide por essa configuração (`_lbCameraDoTotem()`), não pelo `FlexCam.usaNavegador`, que continua valendo para a audiência.
  - A thread `_laco_libras` lê a câmera e reconhece cada quadro na taxa da câmera (medido: ~29 quadros/s, 25 ms da câmera ao JPEG). Ela guarda o último quadro anotado, reduzido para `LIBRAS_VIDEO_LARGURA` (640 px, JPEG `LIBRAS_VIDEO_QUALIDADE` 60, ~20 KB).
  - **O totem busca o vídeo quadro a quadro:** `/libras/quadro?depois=N` (`quadro_libras`) devolve o quadro mais recente com número maior que N, esperando até 2 s, com `X-Quadro` e `X-Capturado`. Devolve 204 enquanto a câmera abre.
    - O `libras_integration.js › _lbIniciarVideo` mantém 2 pedidos em voo e mostra cada quadro como `blob:` no `<img>`.
    - Antes era MJPEG num `<img>` (uma conexão longa), que congelava no navegador do totem.
    - Assim funciona em qualquer navegador, nunca acumula imagem velha, e um pedido travado desiste em 5 s em vez de congelar a conexão.
    - Medido: ~30 quadros/s direto; 4,2/s com 300 ms de latência e 300 KB/s, sem congelar.
  - **Câmera sempre ligada** (`FLEXMED_LIBRAS_SEMPRE_LIGADA`, padrão ligada; `manter_libras_ligada` no início do servidor): o painel abre já com imagem (1º quadro em ~125 ms).
    - Sem ninguém vendo por `LIBRAS_OCIOSO_S` (5 s), o laço só lê a câmera a 10 Hz, sem reconhecer nem codificar.
    - `/libras_stop` (`liberar_libras`) só zera o reconhecimento.
    - Os quadros de audiência do totem seguem processados normalmente (`processar_frame_remoto` não recusa nem desliga a câmera quando `sempre_ligada`).
  - **Rastreamento da mão:** a câmera do notebook usa o rastreamento contínuo do MediaPipe (`processar(..., continuo=True)`, Hands com `static_image_mode=False`), que segue a mão entre quadros. Os quadros que chegam pela rede continuam com detecção a cada quadro.
  - O totem decodifica cada quadro antes de exibir (`Image.decode`), então a troca é instantânea, sem piscar.
  - `/libras_start` (`iniciar_libras_local`) liga a câmera e abre uma sessão nova com o laço (com a câmera sempre ligada, só zera o reconhecimento). Sem pedidos de quadro por `LIBRAS_SEM_CLIENTE_S` (15 s), o laço desliga a câmera. Se o totem receber 204 por ~3 s, ele chama `/libras_start` de novo.
  - O `/video_feed` (MJPEG) continua existindo para compatibilidade: quadro mais recente, buffer de envio de `LIBRAS_VIDEO_BUFFER` (64 KB), e conta como cliente para o desligamento automático.
  - Cada thread é amarrada à sua sessão de vídeo (painel reaberto = sessão nova).
  - **Resultado por consulta aberta:** `/status?versao=N&espera=8` segura a resposta até a letra ou a frase mudarem (`avisar_status`/`esperar_status`, versão em `status_versao`). O totem mantém uma consulta aberta e recebe a letra na hora.
    - Antes eram consultas a cada 400 ms com limite de 800 ms. Pela rede do totem, a maioria estourava o limite (~10 respostas em 50 s), e a letra aparecia travada.
    - Sem parâmetros, `/status` responde na hora, como antes.
    - `diagnostico` traz quadros/s e ms por quadro do laço.
  - Ao fechar o painel, `/libras_stop` desliga a câmera do notebook.

### 4.3 Visão computacional (`visao.py`)
1. MediaPipe Face Detection (`model_selection=1`, até ~5 m).
2. Olhar: nariz centrado entre os olhos e entre olhos e boca. Liga no primeiro frame de frente e desliga após 0,4 s sem olhar.
3. Faixa etária: recorte do rosto (1,5× a caixa) em 112×112 → **MobileNetV3-Small ajustada** (`modelos/faixas_cnn.tflite`) → probabilidades de 8 classes (menor, 18–28 … 78–88).
   - As probabilidades das leituras de cada pessoa são somadas (votação, últimas 12).
   - Reserva: classificador logístico sobre as 256 características do genderage (`faixas_idade.npz`). Sem nenhum dos dois, vale a idade crua do genderage.
4. Idade numérica (registrada por passagem): InsightFace genderage (ONNX).
5. Retrato ao vivo (`/api/audiencia/agora`): pessoas, olhando, faixas, dominante, proximidade e lista de rostos (faixa, confiança, olhando).

Treino reproduzível em `backend/treino_idade/` (ver `LEIAME.md`). Teste com 3.514 rostos: faixa exata 56,4% (antes 36,2%); até 1 faixa de distância 90,2%.

---

## 5. Dados

### 5.1 SQLite local (`backend/data/flexmed.sqlite3`)
| Tabela | Conteúdo |
|---|---|
| `products`, `config`, `metrics` | Legado/local (catálogo de reserva, white label, contadores). |
| `campaigns`, `campaign_analytics` | Campanhas do standby (com `faixas` de público-alvo e `na_vitrine`: também como banner na grade). |
| `vitrine_config` | Intervalo e liga/desliga das campanhas entre as linhas. |
| `exibicoes_anuncio` | Cada exibição: motivo, faixa-alvo, espectadores, atenção, faixas, interação. |
| `audiencia` | Cada passagem pela câmera: faixa, idade, confiança, olhou, atenção, contexto. |
| `sessoes`, `sessao_eventos` | Sessões de uso e seus eventos (inclui `vitrine_ver`/`vitrine_clique`). |
| `presenca_config`, `presenca_eventos` | Regras de presença e eventos acordou/ausência. |
| `vitrine_blocos` | Blocos da vitrine: tipo, mídias, textos, ação, `apos_linha`, `repetir_cada`, `faixas`, `interesses`, prioridade, `extras`, período, ativo. |
| `produto_estoque`, `estoque_lotes`, `estoque_movimentos` | Gestão de estoque (ver 4.1). |
| `pedidos`, `pedido_itens` | Pedidos do totem (código, status, itens, preço, falta). |
| `loja_config` | Regras da loja (esconder esgotados, aviso de validade, mínimo/máximo padrão). |
| `nuvem_cursor` | Até onde cada tabela já foi enviada ao Supabase. |

### 5.2 Supabase
- **Catálogo** (`backend/supabase/schema.sql`): `products`, `categorias`, `coletas`, `historico_precos` + bucket de fotos.
- **Métricas e logs** (`backend/supabase/metricas.sql`, rodar uma vez no SQL Editor): `totem_audiencia`, `totem_exibicoes`, `totem_sessoes`, `totem_sessao_eventos` e `totem_presenca_eventos`.
  - A chave é (`totem_id`, id local). Os horários ficam em epoch, com colunas `*_em` em timestamptz.
  - RLS ligado, sem políticas públicas.
  - As métricas da vitrine viajam dentro de `totem_sessao_eventos`.
  - **Loja** (mesmo arquivo): `totem_estoque`, `totem_estoque_lotes`, `totem_estoque_movimentos`, `totem_pedidos` e `totem_pedido_itens`.
- **Cursores do `nuvem.py`**: `id` para tabelas só de inserção, ou uma coluna de tempo (`fim`, `atualizado`) para tabelas que mudam, como saldo, lote e status de pedido. Nas colunas de tempo, os últimos 10 s são reenviados por upsert.

### 5.3 Fluxo das métricas
```text
câmera → MotorVisao → passagem (audiencia) / atenção por anúncio e sessão
toques → FlexSessao → sessao_eventos         ┐
anúncios → exibicoes_anuncio                 ├→ SQLite → nuvem.py (15 s) → Supabase totem_*
presença → presenca_eventos                  ┘
admin (relatórios/logs) ← Supabase (ou SQLite se indisponível), campo "fonte"
```

---

## 6. Segurança e privacidade
- Secret key do Supabase só em `backend/.env`.
- Nenhuma imagem/dado facial persistido; o frame é descartado após o processamento.
- O login do admin é de demonstração (sem autenticação real na API). Ponto pendente para produção.
- Modelos de idade de uso acadêmico/não comercial (InsightFace genderage, UTKFace).

---

## 7. Vídeo de apresentação (`video/`)

Vídeo de motion vertical (1080×1920, 60 fps, 60 s em loop), feito com a UI real do totem e dados fictícios. Ver `video/README.md` e `video/STORYBOARD.md`.
- `serve.mjs`: serve o `frontend/index.html` **sem os scripts dele** (`/video/totem.html`). Extrai do `script.js`, em tempo de execução e pelo nome, as funções que desenham as telas (`/video/totem-real.js`), com `setTimeout`, `requestAnimationFrame` e `fetch` neutralizados.
  - Se uma dessas funções for renomeada no `script.js`, o vídeo para com "não achei <nome>": atualize `FUNCOES_REAIS`.
- `src/totem-controle.js`: monta cada tela a partir de um estado; o zoom usa o `--k` do totem em pé.
- `src/cenas.js`: `renderFrame(n)`, função pura do quadro.
- `render.mjs`: Playwright (Chrome instalado, modo determinístico) → PNG → `ffmpeg-static` (H.264, CRF 15).
- `verificar.mjs`: hash dos quadros em ordens diferentes e a emenda do loop.
- Dependências só em `video/node_modules` (nada no `.venv` nem no backend).

---

## Histórico de mudanças

| Data | Mudança na arquitetura |
|---|---|
| 2026-10-24 | **Banners do topo novos** (Ofertas da semana com fotos reais, Voz, Libras; `bannerMidia`, ações `ofertas`/`voz`/`libras`); lógica das ofertas compartilhada em `api.js › apiOfertasDaCasa`. |
| 2026-10-24 | **Descanso de tela com anúncios da casa** (`campaign_player.js › _renderCasa`, estilos `.cp-casa*` em `totem.css`; `fotoDoProduto` em `api.js`) quando não há campanha ativa, no lugar da tela fixa "Toque na tela para começar". |
| 2026-10-24 | **Produtos rápidos**: fotos reduzidas e em cache no notebook (`/foto/…`, `aquecer_fotos`), cache de 60 s da consulta ao Supabase (`listar_catalogo`) e gzip no JSON da API. Primeira tela com fotos em ~3 s numa rede de hotspot simulada. |
| 2026-10-24 | **Admin no totem**: engrenagem sem navegação (`preventDefault`), `painel_admin.js` primeiro, aviso de carregamento com saída, admin iniciando no `DOMContentLoaded`, fontes do Google sem bloquear a tela. **Frontend em gzip** com cache `immutable` para arquivos com `?v=`. |
| 2026-10-24 | **Câmera do notebook sempre ligada no Libras** (`manter_libras_ligada`, `liberar_libras`, ocioso após 5 s sem ninguém vendo); rastreamento contínuo da mão na câmera local (`continuo=True`, `LETRA_DETECCAO_LOCAL`); totem decodifica o quadro antes de trocar. |
| 2026-10-24 | **Vídeo do Libras quadro a quadro** (`/libras/quadro`, `iniciar_libras_local`, `quadro_libras`, `_lbIniciarVideo`) no lugar do MJPEG, que congelava no totem; a câmera desliga sozinha sem pedidos por 15 s (`LIBRAS_SEM_CLIENTE_S`). |
| 2026-10-24 | **Libras sem atraso**: vídeo do notebook sem limite de taxa (~26 quadros/s direto), buffer de envio de 64 KB na conexão do vídeo, JPEG 60; `/status` com espera (`versao`/`espera`) no lugar das consultas a cada 400 ms; janela da letra de 0,8 → 0,6 s (letra em ~0,57 s). O keep-alive passa o socket real em `werkzeug.socket`. |
| 2026-10-24 | **Libras pela câmera do notebook** (`FLEXMED_LIBRAS_CAMERA`, `/libras/config`): reconhecimento em `_laco_libras`, separado do vídeo para o totem (`_frames_libras`: quadro mais recente, 640 px, até 10/s). Reconhecedor de letras com 2ª tentativa no quadrado central e tolerância a quadros fora (`_fora_tolerados`, `LETRA_CONCORDANCIA`). **Keep-alive** consertado (`ManterConexao.run_wsgi`; o dreno do Werkzeug travava a requisição seguinte). **Admin** com menu em gaveta em telas ≤ 700 px. |
| 2026-10-24 | **Libras só letras**: modelo estático retreinado só com `dataset/train` (20 letras; aumento com espelho, rotação e ruído; peso por classe; `models/relatorio_estatico.txt`). Reconhecedor com `LIBRAS_MODO` (`letras` padrão = MediaPipe Hands 1 mão, confirmação por tempo; `completo` = Holistic). Features da mão em pixels. Rastreamento 27,6 → 9,2 ms/quadro. Totem com 8 envios em paralelo no Libras (`emVoo`). Sem desenho no servidor para o totem. Backup em `libras/backup/2026-10-24_antes_letras/`. |
| 2026-10-24 | Libras pela câmera do totem: quadro em pé vira 4:3 com faixas pretas antes do reconhecimento (`CameraBroker._quadro_4x3`); acerto simulado de 35% → 85%. |
| 2026-10-24 | `app.py › servidor_https`: o handshake TLS sai da thread principal (uma conexão parada travava o servidor) e `http://` na porta 5050 redireciona para `https://`. |
| 2026-10-24 | `video/`: vídeo de motion vertical com a UI real do totem (funções do `script.js` extraídas em tempo de execução, dados fictícios), `renderFrame(n)` determinístico, render com Playwright + ffmpeg-static e `verificar.mjs`. |
| 2026-10-24 | `flexmed.sh` na raiz (iniciar/parar/reiniciar/status/ip/logs/dev/abrir), log em `logs/`, tarefas em `.vscode/tasks.json`; README reescrito com guia de apresentação e sem a porta 3000/senhas antigas. |
| 2026-10-24 | `frontend/painel_admin.js`: o admin abre num iframe sobre o index em vez de navegar para `admin.html`, então a câmera (audiência e presença) não para; `audiencia.js` não marca anúncio com o painel aberto; `admin.html` com `verTotem()`/`doLogout()` que fecham o painel quando embutido. |
| 2026-10-24 | `frontend/icones.js` (ícones próprios; também no admin); `totem.css` reescrito com a identidade azul/vermelho/verde; `script.js` com blocos de categoria (`chipHtml(..., "cat-tile")`), selo e aviso de receita e "Preço no balcão"; `vitrine.js` com anúncios da casa e `vitrine_config.anuncios_casa`. |
| 2026-10-24 | `frontend/totem.css` (nova camada visual do totem em pé); `script.js` com barra do carrinho, pop-up de adicionado, animação até o carrinho, busca por voz e remoção da tela de abertura; campanhas na grade (`campaigns.na_vitrine`, `vitrine_config`, `/api/vitrine/config`, `escolherCampanha` em `vitrine.js`); admin sem login na demonstração. |
| 2026-10-23 | `taxonomia.py` (categorias editáveis; totem lê `/api/nichos`), `comportamento.py`, `marketing.py`; eventos novos em `sessao.js` (`toque`, `tela_tempo`, `produto_tempo`, `impressoes`, `rolagem`, `layout`) aceitos por `metricas.py` (detalhe até 2.500 caracteres, nunca cortado); `loja.py` com busca por código, cadastro em lote e entrada em lote; admin: `admin_marketing.js`, `admin_atividade.js`, `admin_categorias.js` e o leitor de código em `admin_catalogo.js`; barra lateral com Painel de marketing, Campanhas e Atividade em Marketing e Categorias em Loja. |
| 2026-10-23 | **Loja**: `backend/loja.py` (tabelas de estoque, lotes, movimentos, pedidos e config; `/api/loja`, `/api/estoque`, `/api/pedidos`); `/api/products` mescla o disponível e esconde esgotados (`sb.listar(excluir_ids=…)`); `nuvem.py` com cursor por coluna de tempo e 5 tabelas novas `totem_*`; admin com barra lateral por seções e `admin_catalogo.js`, `admin_estoque.js`, `admin_pedidos.js` (o código antigo de produtos do `admin.html` foi removido); checkout do totem com código de pedido. |
| 2026-10-23 | **Vitrine entre linhas**: `backend/vitrine.py` (tabela `vitrine_blocos`, `/api/vitrine*`), `frontend/vitrine.js` (`FlexVitrine`, ligado a `loadMoreProducts`/`renderProducts` e aos eventos de `rastrear`), `frontend/admin_vitrine.js`; eventos `vitrine_ver`/`vitrine_clique` aceitos em `metricas.py`. |
| 2026-10-23 | `nuvem.py` (sincronização com Supabase `totem_*`, `metricas.sql`); relatórios lidos do Supabase com SQLite de reserva; `/api/logs` e `admin_logs.js`; CNN de faixas (TFLite) e `treino_idade/`; faixas de 10 anos; audiência a 6 fps. |
| 2026-10 (anterior) | `presenca.py` + `presenca.js`; token de sessão no vídeo do Libras. |
| 2026-10 (anterior) | `visao.py` (MotorVisao), `metricas.py`, `sessao.js`, `audiencia.js`; câmera do totem via `/frame` em HTTPS; catálogo no Supabase com paginação; assistente com Whisper. |
