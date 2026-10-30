# FlexMed v5 — Funcionalidades do totem

O que o totem faz, do ponto de vista de quem usa (o cliente na farmácia) e de quem o configura (o painel administrativo).
Este documento é atualizado a cada funcionalidade nova ou alterada; o histórico fica no fim.

> Arquitetura técnica (módulos, APIs, dados): ver [ARQUITETURA.md](ARQUITETURA.md).

---

## 1. Visão geral

O FlexMed é um totem de autoatendimento para farmácias, numa tela de 32" em pé (Android com Fully Kiosk).
O cliente procura produtos tocando, falando ou em Libras, monta uma lista e pede no balcão.
Quando ninguém está usando, o totem passa anúncios e acorda sozinho quando alguém se aproxima.

Tudo o que a câmera mede é **anônimo** (LGPD): nenhuma imagem ou dado do rosto é guardado. Ficam só a faixa etária estimada, se a pessoa olhou e por quanto tempo.

---

## 2. Para o cliente

### 2.1 Modo anúncios (standby) e acordar por aproximação
- **Anúncios em tela cheia** (imagem, vídeo ou carrossel) passam quando ninguém está usando o totem.
- **Anúncio escolhido pelo público**: a câmera estima a faixa etária de quem está olhando, e o totem prioriza os anúncios daquele público. Cada faixa recebe exibições proporcionais à sua fatia do público presente.
- **Acorda sozinho**: quando uma pessoa chega perto (distância configurável, olhando para a tela), por um tempo mínimo, o totem sai dos anúncios e mostra a tela inicial.
- **Volta aos anúncios** quando ninguém está na frente da câmera e ninguém toca a tela pelo tempo configurado.
- Um toque na tela também sai do modo anúncios.
- **Sem campanha ativa**, a tela de descanso passa os **anúncios da própria farmácia**, um a cada 8 s:
  - **Ofertas da semana**: os 3 maiores descontos reais do catálogo, com foto e preço "de/por". Só entram itens fora do nicho Medicamentos e sem receita, porque propaganda de medicamento ao público tem regras da Anvisa. Descontos acima de 70% ficam de fora, porque costumam ser erro no preço "de".
  - **Atendimento em Libras**, **"Não achou? É só falar"** (busca por voz) e **"Escolha aqui. Retire no balcão"**.
  - **"Sua marca nesta tela"**: convite para empresas anunciarem, com anúncio por público e medição anônima.
  - Campanhas cadastradas em **Campanhas** continuam com prioridade sobre esses banners.

### 2.1b Tela de compras (visual do totem)
- O totem abre direto na tela de compras, sem animação de abertura.
- No topo ficam a marca, o botão **Libras**, o idioma, a hora e um acesso discreto ao **painel administrativo** (ícone de engrenagem, sem senha na demonstração). O painel abre **por cima do totem**, e a câmera continua medindo público e presença enquanto ele está aberto; "Ver Totem" ou "Sair" fecham o painel e voltam ao totem. Nesse tempo nenhum anúncio recebe visualização. Na tela do totem, as páginas do painel ficam no botão **Menu**, no topo.
- Logo abaixo vem a saudação conforme a hora ("Boa tarde! O que você procura hoje?") e a **busca grande com microfone**: tocar no microfone abre o assistente já ouvindo.
- **Carrossel de banners** logo abaixo das categorias, trocando sozinho:
  - **Ofertas da semana**: fotos reais dos produtos em promoção e o maior desconto; o toque abre a oferta.
  - **"Não achou? É só falar."**: o toque abre o assistente já ouvindo.
  - **Atendimento em Libras**: o toque abre o Libras.
- O texto usa a fonte **Atkinson Hyperlegible Next**, criada para quem enxerga pouco, com números alinhados nos preços.
- **Identidade visual em azul e vermelho**:
  - faixa azul no topo com saudação, busca e categorias;
  - **preços em verde**, **descontos em vermelho** e ações de compra em vermelho.
- **Ícones próprios** desenhados para cada categoria e subcategoria, em traço azul com um detalhe vermelho. As categorias do topo aparecem como blocos grandes. Subcategorias novas recebem um ícone pelo nome (ex.: "Higiene Oral" → dente).
- **Produtos com receita**:
  - mostram o preço com o selo **"Com receita"** (ícone ℞);
  - na página do produto, logo abaixo do preço, aparece um aviso para apresentar a receita no balcão;
  - no pedido, o carrinho avisa quantos itens exigem receita;
  - sem preço cadastrado, aparece "Preço no balcão".
- **Barra do carrinho sempre visível** embaixo, com quantidade de itens, total e **"Fechar pedido"**, além dos atalhos Início e Assistente.
- **Ao adicionar um produto**, a foto voa até o carrinho e abre um pop-up com:
  - o item e o total do carrinho;
  - sugestões do tipo "quem leva este também leva";
  - os botões **"Fechar pedido"** e "Continuar comprando".
  Com "reduzir movimento" ligado no aparelho, só o pop-up aparece.
- **Revisão do pedido**: fotos, quantidade, subtotal por item, total estimado e "Enviar pedido ao balcão", que gera o código de retirada.

### 2.2 Catálogo de produtos
- **Cards no estilo de farmácia online**: foto grande, nome, preço e preço "de" riscado com o selo de desconto (%), 4 por linha.
- **Navegação em dois níveis**: nichos no topo (Medicamentos, Beleza, Higiene e Cuidados, Infantil, Saúde e Bem-estar) e as categorias do nicho logo abaixo.
- **Rolagem infinita**: os produtos carregam em páginas conforme a pessoa rola.
- **Busca** por nome, tipo, uso ou indicação, com sugestões enquanto digita.
- **Fotos padronizadas**: fundo branco, produto centralizado e nítido.

### 2.3 Vitrine entre linhas de produtos (novo)
Para a rolagem não ficar só de produtos, entre as linhas aparecem **blocos** definidos no admin:
- **Banner**: imagem larga com título, subtítulo e botão.
- **Carrossel**: várias imagens que passam sozinhas, com pontos para trocar.
- **Vídeo**: sem som, toca só enquanto está na tela.
- **Faixa de produtos**: destaques rolando para o lado (em promoção, de uma categoria, de um nicho ou de uma busca).
- **Aviso**: cartão colorido só com texto (ex.: "Dúvida sobre um remédio? Fale com o farmacêutico").

**Para quem aparece.** Um bloco pode ser para todos ou segmentado:
- **Por idade (visão computacional)**: só aparece quando a câmera estima que a pessoa olhando está numa das faixas escolhidas.
- **Por interesse**: só aparece para quem, nesta sessão, navegou, abriu ou pôs na lista algo dos nichos ou categorias escolhidos.

**Anúncio a cada 5 linhas** (intervalo configurável). Entra como banner, nesta ordem de preferência:
1. um bloco próprio da vitrine para aquela linha;
2. uma **campanha do modo de espera** marcada para isso, escolhida pela faixa etária de quem está olhando e com a arte inteira;
3. sem campanha ativa, os **anúncios da casa**, em rodízio:
   - "Ofertas da semana", com os 3 maiores descontos reais do catálogo;
   - "Dúvida sobre um remédio?", que abre o assistente;
   - "Não achou? É só falar", que abre a busca por voz;
   - "Atendimento em Libras".

O bloco de cada posição é escolhido **quando ela está prestes a aparecer na tela**, então reflete quem está na frente naquele momento. Se nenhum bloco combina, a linha segue só com produtos.

**Ao tocar**, o bloco pode abrir uma categoria, um nicho, uma busca ou um produto.

### 2.4 Página do produto
- Foto, preço com desconto, para que serve, indicações e se precisa de receita.
- **Onde encontrar** na loja (prateleira, balcão, geladeira).
- **Quantidade** e botão para adicionar à lista.
- **Recomendações**: "Leve junto" (complementos; ex.: protetor solar → hidratante) e "Parecidos" (mesma categoria).
- **QR code** com o nome e o local do produto.

### 2.5 Lista e pedido no balcão
- Carrinho/lista com quantidades. "Solicitar" envia o pedido ao balcão e mostra na tela um **código curto** (ex.: `DP40`) para retirar. O balcão vê o pedido na hora.
- **Estoque de verdade**: produtos com controle de estoque mostram o selo **"Últimas unidades"** ou **"Esgotado"** (foto em cinza). O totem não deixa pedir mais do que há disponível.
- Esgotados podem ser **escondidos** do totem (regra no admin).
- Se um item ficou sem saldo entre a escolha e o pedido, a tela avisa que o farmacêutico vai confirmar.

### 2.6 Assistente por voz
- O cliente toca no microfone e fala o produto ou o sintoma ("estou com dor de cabeça").
- **Transcrição ao vivo** na tela enquanto fala; a gravação para sozinha no silêncio.
- O assistente entende o pedido mesmo com erros de transcrição (ex.: "ir de piruna" → dipirona) e mostra os produtos. "Ver na vitrine" leva a busca para o catálogo.

### 2.7 Libras
- Painel de atendimento em Libras: reconhece o **alfabeto manual** e monta a frase letra por letra. São 20 letras: A, C, D, E, F, G, I, L, M, N, O, P, Q, R, S, T, U, V, W, Y.
  - **A pessoa faz as letras em frente à câmera do notebook.** O totem mostra o vídeo dessa câmera, com a mão desenhada, e pede: "Faça a letra em frente à câmera do notebook". O reconhecimento roda no notebook em tempo real, sem depender da rede até o totem.
  - Pode voltar a usar a câmera do totem (`FLEXMED_LIBRAS_CAMERA=totem` no backend).
  - A letra entra quando a mão fica parada fazendo o sinal por cerca de 1 segundo. Para repetir a mesma letra, tire a mão da frente da câmera e faça de novo.
  - Vale a mão direita ou a esquerda.
  - O reconhecimento de palavras (sinais com movimento) está desligado por padrão, porque errava muito. Pode ser religado no backend (`LIBRAS_MODO=completo`).
- Pode ser aberto e fechado quantas vezes for preciso; ao fechar, a câmera volta para a medição de audiência.

### 2.8 Outros
- **Idiomas**: português e inglês.
- **Avaliação do atendimento**: de 1 a 5 estrelas.
- **Marca da farmácia**: nome, cores e logotipo definidos no admin.

---

## 3. Para a farmácia (painel administrativo)

A barra lateral é organizada por áreas:

| Área | Página | O que dá para fazer |
|---|---|---|
| **Visão geral** | **Painel geral** | Pessoas que passaram hoje, quantas olharam, consultas, sessões, conversão, buscas mais feitas e avaliação média. |
| | **Jornada do cliente** | Funil (iniciou → tocou → viu produto → pôs na lista → finalizou), onde desistiram, mais tocados, produtos mais vistos, buscas, faixa de quem usou e a linha do tempo de cada sessão. |
| **Loja** | **Pedidos** | Quadro do balcão (Novos → Separando → Prontos → Entregue), com código, itens, foto, SKU e onde pegar cada produto. Aviso sonoro e contador na barra lateral quando chega pedido; pedidos esperando há mais de 10 min ficam destacados. Mostra faturamento, ticket médio e tempo até a entrega. **Entregar baixa o estoque**; cancelar libera a reserva. |
| | **Catálogo** | **Bipar código**: um leitor USB/Bluetooth ou a câmera acha o produto pelo código de barras/SKU, ou começa um cadastro com o código já preenchido. **Cadastro em lote**: vários produtos de uma vez, bipando um atrás do outro, digitando numa grade ou colando linhas do Excel, com estoque inicial, lote e validade. Cadastro completo do produto em abas: informações (nome, categoria, tipo, marca, fabricante, descrição, indicações, receita, visível no totem, destaque); preço e estoque (preço, preço "de", custo com margem e markup calculados, controle de estoque, mínimo/máximo, estoque inicial com lote e validade, localização); **fotos enviadas do computador** (arrastar e soltar, várias de uma vez, padronização automática, escolher a principal); códigos: **campo grande para bipar o código de barras** (leitor ou câmera; avisa se o código for inválido ou já pertencer a outro produto), SKU automático, unidade e fornecedor. Filtros: sem foto, sem código de barras, sem custo, exige receita, em promoção. Inclui um botão para aplicar de uma vez os EANs encontrados nas descrições. |
| | **Categorias** | Organização do catálogo em dois níveis, como no totem: **categorias** (topo: Medicamentos, Beleza…) e **subcategorias** (Analgésicos, Dermocosméticos…). Criar, renomear, escolher o ícone do totem, ativar/esconder, reordenar e mover subcategorias de categoria. Ao excluir, o sistema pergunta para onde vão os produtos. |
| | **Estoque** | **Receber mercadoria**: bipe cada item da nota (bipar de novo soma +1) e informe quantidade, lote, validade e custo; tudo entra de uma vez. **Visão geral**: valor em estoque (custo e venda), alertas de esgotado, abaixo do mínimo e validade, e as regras (esconder esgotados, antecedência do aviso de validade, mínimo e máximo padrão). **Produtos**: saldo, reservado, disponível, cobertura em dias, ações em massa e importação/exportação de planilha. **Movimentações**: entradas, saídas, perdas, devoluções, contagens e vendas, com quem fez e por quê. **Lotes & validade**: o que vence primeiro, com baixa de vencidos. **Reposição**: sugestão de compra (até o máximo), lista de compra em CSV, curva ABC e estoque parado. |
| **Marketing** | **Painel de marketing** | Visão para o time de marketing, sempre comparada ao período anterior: alcance, taxa de atenção, engajamento, conversão, receita, ticket médio, exibições de campanha e receita em promoção. Inclui:<br>• **funil completo** (passou → olhou → usou → viu produto → pôs na lista → pediu → retirou);<br>• **público por idade** com conversão e receita;<br>• **de onde vêm as vendas** (toque, campanha, aproximação);<br>• **efeito da segmentação** por idade;<br>• desempenho de cada **campanha** e da **vitrine**;<br>• **melhores horários** (dia × hora);<br>• **o que procuram** (buscas, buscas sem resultado, sintomas falados);<br>• **interesse × venda** (mais vendidos, abertos e não comprados, receita por categoria);<br>• **insights** em texto e exportação do relatório. |
| | **Vitrine** | Blocos entre as linhas de produtos: tipo, mídia, textos, ação do toque, linha e repetição, público por faixa etária e por interesse, prioridade e período. Mostra o mapa da rolagem e as métricas por bloco. |
| | **Campanhas** | Opção **"Mostrar também como banner entre os produtos do totem"**. Campanhas do modo de espera (imagem/vídeo/carrossel), público-alvo por faixa, prioridade, período e tempo de inatividade. |
| | **Audiência** | Público ao vivo (cada pessoa, faixa e confiança), perfil por faixa etária, audiência por hora, desempenho dos anúncios e precisão do modelo de idade. |
| | **Atividade** | **Comportamento**:<br>• **mapa de calor dos toques** sobre o desenho real da tela, por tela;<br>• regiões mais tocadas e **toques sem resposta** (onde tentam tocar e nada acontece);<br>• o que mais tocam e **tempo por tela**, com quanto disso estavam olhando;<br>• **produtos**: quantas vezes apareceram, abertura, tempo na página, quanto rolaram, se puseram na lista;<br>• até onde rolam a lista e o que cada faixa etária abre.<br>**Sessões**: o caminho de cada cliente, com linha do tempo e toques numerados. **Registros**: linha do tempo bruta, CSV e envio ao Supabase. |
| **Inteligência** | **Assistente IA** | Módulos de IA. |
| | **Câmera & presença** | Liga/desliga a câmera e o acordar por aproximação, com distância (e calibração), olhar obrigatório, tempo de presença e volta aos anúncios. |
| **Totem & marca** | **Identidade visual**, **Layout do totem**, **Lojas & totens** | Marca, cores, módulos e lojas. |
| **Sistema** | **Equipe & acesso**, **Integrações** | Usuários e serviços externos. |

**Regras do estoque.** Disponível = saldo − reservado em pedidos abertos.
- Saídas e vendas consomem primeiro o lote que vence antes.
- Entradas com custo atualizam o custo médio.
- Cada alteração de saldo vira uma movimentação no histórico.
- Um produto só passa a ter controle quando a farmácia liga o controle (no cadastro, em massa ou ao movimentar). Até lá ele aparece no totem normalmente.

**Faixas etárias** usadas na segmentação: 18–28, 28–38, 38–48, 48–58, 58–68, 68–78 e 78–88 anos. Menores de 18 contam como público, mas não são segmentados.

---

## 4. Privacidade (LGPD)
- A câmera processa cada imagem em memória e a descarta. Ficam só faixa etária estimada, se olhou e por quanto tempo.
- O número temporário de cada pessoa some quando ela sai da frente da câmera.
- Os logs de sessão registram o que foi tocado na tela, nunca quem tocou.
- O modelo de idade foi treinado numa base pública (UTKFace, uso acadêmico), nunca com imagens do totem.

---

## Histórico de mudanças

| Data | Mudança |
|---|---|
| 2026-10-24 | **Banners novos no topo do totem**: Ofertas da semana (com fotos e desconto real), busca por voz e Libras, cada um abrindo a função ao toque. |
| 2026-10-24 | **Descanso de tela com anúncios da farmácia**: sem campanha ativa, o totem passa ofertas reais, os serviços do totem e um convite para marcas anunciarem, em vez de uma tela parada. |
| 2026-10-24 | **Produtos aparecem bem mais rápido**: as fotos vêm do notebook, menores e já preparadas, em vez da internet; a lista de produtos é guardada por 1 minuto. |
| 2026-10-24 | **Admin abre no totem**: o painel aparece por cima do totem com o aviso "Carregando o painel…" (e um botão para voltar), mesmo com a internet lenta. Antes, a tela ficava em branco ou o toque saía do totem. O site do totem e do admin carrega bem mais rápido (arquivos comprimidos). |
| 2026-10-24 | **Libras abre na hora**: a câmera do notebook fica sempre ligada para o Libras, e a imagem aparece assim que o painel abre. A mão é rastreada de forma contínua, mais estável, e o vídeo não pisca. |
| 2026-10-24 | **Vídeo do Libras não congela mais no totem**: a imagem da câmera do notebook chega quadro a quadro, sempre a mais recente. Se a rede piora, ela fica mais lenta, mas não congela. |
| 2026-10-24 | **Libras sem travar**: o vídeo da câmera do notebook ficou fluido (antes eram 10 quadros por segundo), a letra aparece no totem assim que é reconhecida e é confirmada mais rápido (~0,6 s com a mão parada). |
| 2026-10-24 | **Libras pela câmera do notebook**: a pessoa faz as letras em frente ao notebook, que reconhece em tempo real e mostra o vídeo no totem. **Admin no totem**: as páginas ficam no botão Menu (antes o menu sumia na tela em pé). A tela branca do admin e o layout sem as cores do totem eram o servidor travando conexões, o que foi corrigido. |
| 2026-10-24 | **Libras só com letras, mais rápido e preciso**: o totem reconhece o alfabeto (20 letras) com a mão direita ou a esquerda, e as palavras ficam desligadas por padrão. O rastreamento da mão ficou 3× mais rápido no servidor, e o totem manda o dobro de imagens por segundo. |
| 2026-10-24 | **Libras mais preciso no totem**: a câmera em pé do totem passou a ser tratada como a do treino, e os sinais erram bem menos (em teste com os vídeos do dataset, o acerto foi de 35% para 85%). |
| 2026-10-24 | **Câmera não para ao abrir o admin**: o painel administrativo abre por cima do totem, e a câmera segue capturando audiência e presença; "Ver Totem" e "Sair" fecham o painel. |
| 2026-10-24 | **Identidade azul e vermelha**: preços em verde, descontos em vermelho, faixa azul no topo e categorias em blocos; **ícones próprios** para categorias e subcategorias, também no admin; **produtos com receita** com preço, selo ℞, aviso na página e no pedido; **anúncio garantido a cada 5 linhas**, com anúncios da casa quando não há campanha. |
| 2026-10-24 | **Novo visual do totem de compras**:<br>• sem tela de abertura e sem chat abrindo sozinho;<br>• saudação e busca grande com microfone;<br>• fonte de alta legibilidade e etiqueta amarela de oferta;<br>• barra fixa do carrinho com total e "Fechar pedido";<br>• **pop-up ao adicionar** (animação até o carrinho, sugestões, "Fechar pedido");<br>• revisão do pedido com fotos e total;<br>• **banner de campanha a cada 5 linhas** (configurável no admin);<br>• botão discreto para o admin;<br>• **admin sem senha** na demonstração. |
| 2026-10-23 | **Painel de marketing** (indicadores com comparação, funil, público, origem das vendas, segmentação, campanhas, horários, demanda, interesse × venda, insights); "Anúncios" passa a se chamar **Campanhas**; **Atividade** movida para Marketing, com mapa de calor dos toques, toques sem resposta, tempo por tela, funil por produto, rolagem e replay de sessões; **leitor de código de barras** (leitor ou câmera) no cadastro, no catálogo e no estoque; **cadastro em lote** e **receber mercadoria**; página **Categorias** (categorias e subcategorias editáveis, refletidas no totem). |
| 2026-10-23 | **Loja**: pedidos com código e quadro do balcão; catálogo com cadastro completo (fotos do computador, SKU, EAN, custo/margem); estoque com alertas, lotes e validade, movimentações, planilha, reposição e curva ABC; selos de estoque no totem. Barra lateral do admin reorganizada em áreas, com nomes novos. |
| 2026-10-23 | **Vitrine entre linhas de produtos**: banners, carrosséis, vídeos, faixas de produtos e avisos entre as linhas do catálogo, segmentados por idade (câmera) e por interesse da sessão; nova página no admin com mapa da rolagem e métricas por bloco. |
| 2026-10-23 | Faixas etárias de 10 anos (18–28 … 78–88) com novo modelo de idade treinado; detecção de olhar mais rápida; painel ao vivo por pessoa; página **Logs**; métricas e logs enviados ao Supabase. |
| 2026-10 (anterior) | Acordar por aproximação e página **Câmera & Presença**; correção do Libras ao reabrir. |
| 2026-10 (anterior) | Anúncios segmentados por faixa etária, métricas de anúncio e logs anônimos de sessão; preço "de/por"; white label só no admin. |
| 2026-10 (anterior) | Catálogo no Supabase com rolagem infinita, nichos e categorias, fotos melhoradas; layout em pé; assistente por voz com transcrição ao vivo; página do produto simplificada; Libras com a câmera do totem via HTTPS. |
