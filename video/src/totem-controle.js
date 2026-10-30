// Controlador do totem dentro do vídeo. Roda no index.html REAL (sem os scripts dele)
// e monta cada tela com as funções reais do script.js (window.TotemReal).
//
// aplicar(estado) é idempotente: a parte estrutural (qual tela, o que está no carrinho...)
// é reconstruída do zero a partir do HTML original sempre que muda; a parte contínua
// (rolagem, volume do microfone, opacidades) é aplicada em todo quadro. Assim o mesmo
// estado produz o mesmo DOM, em qualquer ordem de quadros.
window.TotemControle = (() => {
  const R = window.TotemReal;
  const $ = id => document.getElementById(id);
  let C = null, original = "", chaveAtual = "";

  // Embalagem fictícia desenhada (sem marca real), como data URL
  function embalagem(p) {
    const { cor, linha1, linha2 } = p.emb;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <rect width="400" height="400" fill="#fff"/>
      <ellipse cx="200" cy="352" rx="128" ry="12" fill="#0b1b33" opacity=".08"/>
      <path d="M96 72 L292 72 L318 92 L318 340 L122 340 L96 320 Z" fill="${cor}" opacity=".18"/>
      <rect x="96" y="72" width="196" height="268" rx="10" fill="#fff" stroke="#dbe3ef" stroke-width="3"/>
      <path d="M96 82 a10 10 0 0 1 10 -10 h176 a10 10 0 0 1 10 10 v96 h-196 z" fill="${cor}"/>
      <rect x="116" y="198" width="74" height="8" rx="4" fill="${cor}" opacity=".35"/>
      <rect x="116" y="216" width="120" height="8" rx="4" fill="#0b1b33" opacity=".12"/>
      <rect x="116" y="232" width="96" height="8" rx="4" fill="#0b1b33" opacity=".12"/>
      <circle cx="252" cy="294" r="22" fill="${cor}" opacity=".12"/>
      <text x="116" y="126" font-family="Atkinson Hyperlegible Next, sans-serif" font-weight="800" font-size="${linha1.length > 9 ? 25 : 30}" fill="#fff">${linha1}</text>
      <text x="116" y="160" font-family="Atkinson Hyperlegible Next, sans-serif" font-weight="600" font-size="22" fill="#fff" opacity=".9">${linha2}</text>
    </svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // Todos os pesos da fonte carregados de antemão: um peso pedido pela primeira vez no
  // meio do vídeo chegaria depois da captura e o quadro sairia com a fonte reserva.
  async function carregarFontes(doc) {
    await Promise.all([400, 500, 600, 700, 800].map(p => doc.fonts.load(`${p} 16px "Atkinson Hyperlegible Next"`)));
    await doc.fonts.ready;
  }

  async function iniciar() {
    C = await (await fetch("/video/content.json")).json();
    C.totem.produtos.forEach(p => { p.imgUrl = embalagem(p); });
    R.produtos = C.totem.produtos;
    original = $("totem").innerHTML;
    await carregarFontes(document);
  }
  const pronto = iniciar();

  const produto = id => C.totem.produtos.find(p => p.id === id);
  const itemCarrinho = p => ({ id: p.id, name: p.nome, price: R.fmtBRL(p.precoValor), valor: p.precoValor, qty: 1, img: p.imgUrl });

  function montarBase(est) {
    $("totem").innerHTML = original;
    R.cart = est.carrinho ? est.carrinho.map(id => itemCarrinho(produto(id))) : [];
    $("h-pharm").textContent = C.totem.farmacia;
    $("clock").textContent = C.totem.hora;
    $("s-saudacao").textContent = C.totem.saudacao;
    $("cats-row").innerHTML = C.totem.nichos.map(n => R.chipHtml(n, n.key === "todos", "setNicho", "cat-tile")).join("");
    $("subcats-row").classList.add("vazio");
    const lista = est.grade ? est.grade.map(produto) : C.totem.produtos;
    $("p-grid").innerHTML = lista.map(p => R.productCardHtml(p, -1)).join("");
    $("t-dest").textContent = est.tituloGrade || "Produtos em Destaque";
    $("t-conta").textContent = `${lista.length} produtos`;
    R.renderNav();
  }

  function montarAnuncio() {
    const a = C.totem.anuncio;
    const ov = $("standby-overlay");
    ov.classList.add("standby-visible");
    $("standby-clock").textContent = C.totem.hora;
    $("standby-player-container").innerHTML = `
      <div class="vd-anuncio" style="position:absolute;inset:0;background:linear-gradient(160deg, ${a.cor}, #003b97 70%);
        display:flex;flex-direction:column;justify-content:center;padding:0 34px;color:#fff;font-family:var(--tv-fonte)">
        <img src="${produto("m5").imgUrl}" style="width:250px;align-self:center;border-radius:28px;margin-bottom:26px;box-shadow:0 30px 60px rgba(0,0,0,.35)">
        <div style="font-size:44px;font-weight:800;line-height:1.02;letter-spacing:-.02em;white-space:pre-line">${a.titulo}</div>
        <div style="margin-top:12px;font-size:20px;font-weight:600;opacity:.85">${a.sub}</div>
      </div>`;
  }

  function montarAgente(est) {
    $("ag-bub").classList.add("on");
    $("ag-msgs").innerHTML = "";
    R.addChatMessage("bot", "Olá! Fale o nome do remédio ou o que você está sentindo.", false);
    const mic = $("ag-mic");
    if (est.agente === "ouvindo") {
      mic.classList.add("ouvindo");
      $("ag-voz-status").textContent = "Ouvindo... pode falar";
      R.agFalaAoVivo(est.parcial || "…");
    } else {
      const r = {
        texto: est.falaFinal, resposta: C.cenas.voz.respostaTotem,
        produtos: C.totem.resultadoVoz.map(produto),
      };
      R.mostrarResultadoVoz(r);
      $("ag-voz-status").textContent = "Toque no microfone para uma nova busca";
    }
  }

  function montarLibras(est) {
    $("o-lb").classList.add("on");
    $("lb-offline").style.display = "none";
    $("lb-conn-badge").style.display = "";
    $("lb-st").textContent = est.librasFrase ? "Sinal reconhecido" : "Aguardando sinal...";
    $("lb-frase-txt").textContent = est.librasFrase || "---";
    const vc = $("lb-video-container");
    vc.style.background = "#0b1b33";
    vc.insertAdjacentHTML("beforeend", `<svg id="vd-esqueleto" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet"
      style="position:absolute;inset:0;width:100%;height:100%"></svg>`);
    if (est.librasLetra) {
      $("lb-letter-badge").style.display = "";
      $("lb-letter-char").textContent = est.librasLetra;
    }
  }

  function montarDetalhe(est) {
    R.openDetail(est.detalhe);
    const local = C.cenas.fluxo.local;
    $("dp-conteudo").querySelector(".dp-cabecalho").insertAdjacentHTML("afterend",
      `<div class="dp-onde" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px;font-weight:700;color:var(--tv-azul)">
        <span style="display:inline-block;width:18px;height:18px">${R.icon("pin") || ""}</span>Onde encontrar: ${local}</div>`);
  }

  function montarAdicionado(est) {
    montarDetalhe(est);
    const p = produto(est.detalhe);
    R.mostrarAdicionado(p, 1);
    const recs = $("ad-recs");
    $("ad-recs-lista").innerHTML = C.totem.recomendados.map(produto).map(x => `
      <div class="ad-rec"><div class="ad-rec-foto"><img src="${x.imgUrl}" class="pc-prod-img" alt=""></div>
      <span>${x.nome}</span><b>${R.fmtBRL(x.precoValor)}</b><button type="button">Adicionar</button></div>`).join("");
    recs.hidden = false;
  }

  function montarPedido() {
    $("o-cart").classList.add("on");
    R.renderCart();
  }

  function montarCodigo() {
    const p = produto(C.totem.produtoFluxo);
    R.mostrarCodigoPedido({ codigo: C.cenas.fluxo.codigo, total: p.precoValor });
  }

  const MONTAR = {
    anuncio: montarAnuncio, home: () => {}, agente: montarAgente, libras: montarLibras,
    detalhe: montarDetalhe, adicionado: montarAdicionado, pedido: montarPedido, codigo: montarCodigo,
  };

  async function esperarImagens() {
    const imgs = [...document.images];
    imgs.forEach(i => { i.loading = "eager"; i.decoding = "sync"; });
    await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  }

  // Ampliação pelo mesmo mecanismo do totem real (styles.css: html.totem-v #totem { zoom: var(--k) }):
  // é layout, não transform, então a rasterização não depende dos quadros anteriores.
  function escala(k) {
    const raiz = document.documentElement.style;
    raiz.setProperty("--k", k.toFixed(5));
    raiz.setProperty("--tela-w", `${(480 * k).toFixed(3)}px`);
    raiz.setProperty("--tela-h", `${(853 * k).toFixed(3)}px`);
  }

  // Estado contínuo: aplicado em todo quadro, depois da estrutura
  function aplicarContinuo(est) {
    const sc = $("scroll");
    if (sc) sc.scrollTop = est.rolagem || 0;
    const mic = $("ag-mic");
    if (mic) mic.style.setProperty("--vol", (est.volume || 0).toFixed(3));
    // o script.js rola a conversa até o fim quando a mensagem entra; com o zoom da câmera
    // mudando, a altura muda, então a rolagem é refeita em todo quadro
    const msgs = $("ag-msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const ov = $("standby-overlay");
    if (ov) ov.style.opacity = est.tela === "anuncio" ? String(est.anuncioOpacidade ?? 1) : "";
    const esq = $("vd-esqueleto");
    if (esq) esq.innerHTML = est.esqueleto || "";
    const fundoAd = document.querySelector(".ad-fundo");
    if (fundoAd) fundoAd.style.opacity = String(est.adOpacidade ?? 1);
    const painelAd = document.querySelector(".ad-painel");
    if (painelAd) painelAd.style.transform = `translateY(${est.adY || 0}px)`;
    const detalhe = $("detail");
    if (detalhe && detalhe.classList.contains("on")) detalhe.style.transform = `translateX(${est.detalheX || 0}px)`;
    const folha = document.querySelector(".overlay.on .sheet");
    if (folha) folha.style.transform = `translateY(${est.folhaY || 0}px)`;
    const fundoOv = document.querySelector(".overlay.on");
    if (fundoOv) fundoOv.style.opacity = String(est.folhaOpacidade ?? 1);
    const codigo = document.querySelector(".pedido-ok");
    if (codigo) {
      codigo.style.opacity = String(est.codigoOpacidade ?? 1);
      codigo.querySelector(".pedido-ok-card").style.transform = `translateY(${(est.codigoY || 0).toFixed(2)}px)`;
    }
  }

  async function aplicar(est) {
    await pronto;
    const { k, rolagem, volume, anuncioOpacidade, esqueleto, adOpacidade, adY, detalheX, folhaY, folhaOpacidade,
            codigoY, codigoOpacidade, ...estrutura } = est;
    escala(k || 1);
    const chave = JSON.stringify(estrutura);
    if (chave !== chaveAtual) {
      montarBase(est);
      (MONTAR[est.tela] || (() => {}))(est);
      chaveAtual = chave;
      await esperarImagens();
    }
    aplicarContinuo(est);
    void document.body.offsetHeight;          // força o layout para pedir qualquer fonte pendente
    await document.fonts.ready;
  }

  return { pronto, aplicar, get conteudo() { return C; } };
})();
