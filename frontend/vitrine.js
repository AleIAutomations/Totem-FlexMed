// =====================================================
// FlexMed — Vitrine entre linhas (blocos na rolagem infinita de produtos)
// O admin cadastra blocos (banner, carrossel, vídeo, faixa de produtos, aviso)
// com a linha depois da qual aparecem (e se repetem a cada N linhas). Aqui:
//   1. intercalar(): a cada página carregada, abre "vagas" (.vt-slot) depois
//      das linhas que têm algum bloco cadastrado;
//   2. quando a vaga está para entrar na tela, escolhe o bloco: só entram os
//      que combinam com a faixa etária de quem está olhando (câmera) e com os
//      interesses da sessão (nichos/categorias navegados ou abertos); vence a
//      maior prioridade + quem é mais específico; empate = o menos exibido;
//   3. exibição e toque viram eventos da sessão (vitrine_ver / vitrine_clique).
// Campanhas do modo de espera marcadas "mostrar entre os produtos" entram a cada N
// linhas (Marketing › Vitrine), escolhidas pela faixa etária de quem olha, quando
// nenhum bloco da vitrine ocupa aquela linha. Sem campanha ativa, entram os anúncios
// da casa (ofertas reais do catálogo, assistente, busca por voz, Libras), para a
// lista sempre ter um anúncio a cada N linhas.
// =====================================================

const FlexVitrine = (() => {
  let blocos = [];
  let campanhas = [], cfgCampanhas = { campanhas_ativas: true, campanhas_a_cada: 5, anuncios_casa: true }, casaVez = 0;
  let exibidos = {};                 // id -> vezes escolhido nesta listagem
  let ultimoNaVaga = null;           // evita o mesmo bloco em duas vagas seguidas
  let timers = [];
  let interesses = new Set(), sessaoDosInteresses = null, faixaDaSessao = null;
  let obsVaga = null, obsVisto = null, obsVideo = null;

  async function carregar() {
    try {
      const r = await fetch(`${FLEXMED_API_BASE}/vitrine?ativos=1`);
      if (r.ok) blocos = await r.json();
      const [rc, rcfg] = await Promise.all([fetch(`${FLEXMED_API_BASE}/campaigns?active=true`), fetch(`${FLEXMED_API_BASE}/vitrine/config`)]);
      if (rcfg.ok) cfgCampanhas = await rcfg.json();
      if (rc.ok) {
        const agora = new Date();
        campanhas = (await rc.json()).filter(c => c.na_vitrine !== false && (c.media_urls || []).length
          && (!c.start_date || new Date(c.start_date) <= agora) && (!c.end_date || new Date(c.end_date) >= agora));
      }
    } catch (_) { /* backend fora: sem vitrine */ }
    // a primeira página de produtos pode ter chegado antes dos blocos
    const grid = document.getElementById("p-grid");
    if (grid) intercalar(grid, typeof catalog !== "undefined" && catalog.done);
  }

  // ─── quem está na frente e o que interessa a ele ─────────────────────────
  function sincronizarSessao() {
    const sid = window.FlexSessao ? FlexSessao.id : null;
    if (sid !== sessaoDosInteresses) {         // pessoa nova: começa do zero
      sessaoDosInteresses = sid;
      interesses = new Set();
      faixaDaSessao = null;
    }
  }

  function faixaAtual() {
    sincronizarSessao();
    const f = window.FlexAudiencia ? FlexAudiencia.retrato().dominante : null;
    if (f) faixaDaSessao = f;                  // guarda a última faixa vista na sessão
    return f || faixaDaSessao;
  }

  function interessesAtuais() {
    sincronizarSessao();
    const atuais = new Set(interesses);
    if (typeof currentNicho !== "undefined" && currentNicho !== "todos") atuais.add(currentNicho);
    if (typeof currentCategory !== "undefined" && currentCategory !== "todos") atuais.add(currentCategory);
    return atuais;
  }

  function observar(tipo, alvo, detalhe = {}) {
    sincronizarSessao();
    if (tipo === "categoria" && alvo && alvo !== "todos") interesses.add(alvo);
    if ((tipo === "produto" || tipo === "carrinho_add") && detalhe.categoria) {
      interesses.add(detalhe.categoria);
      const nicho = typeof NICHO_DA_CATEGORIA !== "undefined" && NICHO_DA_CATEGORIA[detalhe.categoria];
      if (nicho) interesses.add(nicho);
    }
  }

  // ─── vagas na grade ──────────────────────────────────────────────────────
  const naLinha = (b, linha) => linha === b.apos_linha ||
    (b.repetir_cada > 0 && linha > b.apos_linha && (linha - b.apos_linha) % b.repetir_cada === 0);
  const linhaDeCampanha = linha => cfgCampanhas.campanhas_ativas && (campanhas.length || cfgCampanhas.anuncios_casa !== false)
    && linha % cfgCampanhas.campanhas_a_cada === 0;

  function colunas(grid) {
    const n = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    return Math.max(n, 1);
  }

  function intercalar(grid, terminou) {
    if (!blocos.length && !linhaDeCampanha(cfgCampanhas.campanhas_a_cada)) return;   // nada para intercalar
    const cards = grid.querySelectorAll(":scope > .p-card");
    const cols = colunas(grid);
    const linhas = Math.floor(cards.length / cols);
    for (let linha = 1; linha <= linhas; linha++) {
      // só abre a vaga com produtos depois dela (ou no fim da lista)
      if (linha * cols >= cards.length && !terminou) break;
      if (grid.querySelector(`:scope > .vt-slot[data-linha="${linha}"]`)) continue;
      if (!blocos.some(b => naLinha(b, linha)) && !linhaDeCampanha(linha)) continue;
      const vaga = document.createElement("div");
      vaga.className = "vt-slot";
      vaga.dataset.linha = linha;
      cards[linha * cols - 1].after(vaga);
      observarVaga(vaga);
    }
  }

  function observarVaga(vaga) {
    const root = typeof productScroller === "function" ? productScroller() : null;
    if (!obsVaga || obsVaga.root !== root) {
      obsVaga = new IntersectionObserver(entradas => entradas.forEach(en => {
        if (en.isIntersecting) { obsVaga.unobserve(en.target); preencher(en.target); }
      }), { root, rootMargin: "0px 0px 500px 0px" });
      obsVisto = new IntersectionObserver(entradas => entradas.forEach(en => {
        if (en.isIntersecting) { obsVisto.unobserve(en.target); registrar("vitrine_ver", en.target); }
      }), { root, threshold: 0.5 });
      obsVideo = new IntersectionObserver(entradas => entradas.forEach(en => {
        const v = en.target;
        if (en.isIntersecting) v.play().catch(() => {}); else v.pause();
      }), { root, threshold: 0.25 });
    }
    obsVaga.observe(vaga);
  }

  // ─── escolha do bloco ────────────────────────────────────────────────────
  function escolher(linha) {
    const faixa = faixaAtual();
    const meus = interessesAtuais();
    const candidatos = [];
    for (const b of blocos) {
      if (!naLinha(b, linha)) continue;
      const porIdade = b.faixas.length > 0, porInteresse = b.interesses.length > 0;
      if (porIdade && !(faixa && b.faixas.includes(faixa))) continue;
      if (porInteresse && !b.interesses.some(i => meus.has(i))) continue;
      const motivo = porIdade && porInteresse ? "idade+interesse" : porIdade ? "idade" : porInteresse ? "interesse" : "geral";
      candidatos.push({ b, motivo, nota: b.prioridade * 10 + (porIdade ? 5 : 0) + (porInteresse ? 5 : 0) });
    }
    if (!candidatos.length) return linhaDeCampanha(linha) ? (escolherCampanha(faixa) || escolherCasa(faixa)) : null;
    candidatos.sort((x, y) => y.nota - x.nota || (exibidos[x.b.id] || 0) - (exibidos[y.b.id] || 0));
    const escolhido = candidatos.find(c => c.b.id !== ultimoNaVaga) || candidatos[0];
    exibidos[escolhido.b.id] = (exibidos[escolhido.b.id] || 0) + 1;
    ultimoNaVaga = escolhido.b.id;
    return { ...escolhido, faixa };
  }

  // Campanha (anúncio do standby) como banner entre as linhas: a do público presente primeiro
  function escolherCampanha(faixa) {
    const daFaixa = campanhas.filter(c => (c.faixas || []).length && faixa && c.faixas.includes(faixa));
    const gerais = campanhas.filter(c => !(c.faixas || []).length);
    const lista = daFaixa.length ? daFaixa : gerais.length ? gerais : [];
    if (!lista.length) return null;
    lista.sort((a, b) => (exibidos[`c${a.id}`] || 0) - (exibidos[`c${b.id}`] || 0) || (b.priority || 0) - (a.priority || 0));
    const c = lista.find(x => `c${x.id}` !== ultimoNaVaga) || lista[0];
    exibidos[`c${c.id}`] = (exibidos[`c${c.id}`] || 0) + 1;
    ultimoNaVaga = `c${c.id}`;
    const tipo = c.type === "video" ? "video" : c.type === "carousel" && c.media_urls.length > 1 ? "carrossel" : "banner";
    return { b: { id: `campanha:${c.id}`, tipo, midias: c.media_urls, nome: c.name, titulo: "", subtitulo: "", cta: "",
                  acao: "nenhuma", extras: { intervalo_s: c.duration_seconds ? Math.max(3, Math.round(c.duration_seconds / Math.max(c.media_urls.length, 1))) : 4 } },
             motivo: daFaixa.length ? "idade" : "geral", faixa };
  }

  // Anúncios da casa: vêm do próprio totem, em rodízio
  const CASA = ["ofertas", "farmaceutico", "voz", "libras"];
  function escolherCasa(faixa) {
    if (cfgCampanhas.anuncios_casa === false) return null;
    const tipo = CASA[casaVez++ % CASA.length];
    return { b: { id: `casa:${tipo}`, tipo: "casa", casa: tipo, nome: `Anúncio da casa: ${tipo}`, acao: "nenhuma", midias: [], extras: {} },
             motivo: "geral", faixa };
  }

  function preencher(vaga) {
    const e = escolher(Number(vaga.dataset.linha));
    // nenhum bloco combina com quem está na frente: a linha segue só com produtos
    // (a vaga fica oculta, não removida, para o intercalar() não recriá-la)
    if (!e) { vaga.classList.add("vt-vazia"); return; }
    const b = e.b;
    vaga.dataset.bloco = b.id;
    vaga.dataset.tipo = b.tipo;
    vaga.dataset.motivo = e.motivo;
    vaga.dataset.faixa = e.faixa || "";
    vaga.classList.add(`vt-${b.tipo}`);
    if (String(b.id).startsWith("campanha:")) vaga.classList.add("vt-campanha");   // anúncio do standby: arte inteira, sem corte
    vaga.innerHTML = ({ banner, carrossel, video, produtos: faixaProdutos, aviso, casa })[b.tipo](b, vaga);
    if (b.acao !== "nenhuma") {
      vaga.classList.add("vt-tocavel");
      vaga.addEventListener("click", ev => {
        if (ev.target.closest(".p-card, .vt-dot")) return;   // card de produto / ponto do carrossel
        registrar("vitrine_clique", vaga);
        executar(b);
      });
    }
    vaga.querySelectorAll("video").forEach(v => obsVideo.observe(v));
    obsVisto.observe(vaga);
  }

  function registrar(tipo, vaga) {
    if (!window.FlexSessao) return;
    FlexSessao.evento(tipo, vaga.dataset.bloco, {
      tipo: vaga.dataset.tipo, linha: Number(vaga.dataset.linha),
      motivo: vaga.dataset.motivo, faixa: vaga.dataset.faixa || null,
    });
  }

  // ─── tipos de bloco ──────────────────────────────────────────────────────
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function textos(b) {
    if (!b.titulo && !b.subtitulo && !b.cta) return "";
    return `<div class="vt-textos">
      ${b.titulo ? `<div class="vt-titulo">${esc(b.titulo)}</div>` : ""}
      ${b.subtitulo ? `<div class="vt-sub">${esc(b.subtitulo)}</div>` : ""}
      ${b.cta ? `<span class="vt-cta">${esc(b.cta)} →</span>` : ""}
    </div>`;
  }

  function banner(b) {
    const fundo = String(b.id).startsWith("campanha:") ? `<img class="vt-fundo" src="${esc(b.midias[0])}" alt="" aria-hidden="true">` : "";
    return `<div class="vt-midia">${fundo}<img src="${esc(b.midias[0])}" alt="${esc(b.titulo || b.nome)}" loading="lazy"></div>${textos(b)}`;
  }

  function carrossel(b, vaga) {
    const html = `<div class="vt-midia"><div class="vt-trilho">${b.midias.map(u =>
      `<img src="${esc(u)}" alt="${esc(b.titulo || b.nome)}" loading="lazy">`).join("")}</div></div>
      ${textos(b)}
      <div class="vt-dots">${b.midias.map((_, i) => `<button type="button" class="vt-dot ${i ? "" : "on"}" data-i="${i}" aria-label="Imagem ${i + 1}"></button>`).join("")}</div>`;
    let atual = 0;
    const ir = i => {
      atual = (i + b.midias.length) % b.midias.length;
      vaga.querySelector(".vt-trilho").style.transform = `translateX(-${atual * 100}%)`;
      vaga.querySelectorAll(".vt-dot").forEach((d, k) => d.classList.toggle("on", k === atual));
    };
    setTimeout(() => vaga.querySelectorAll(".vt-dot").forEach(d =>
      d.addEventListener("click", () => ir(Number(d.dataset.i)))));
    if (b.midias.length > 1) timers.push(setInterval(() => vaga.isConnected && ir(atual + 1), (b.extras.intervalo_s || 4) * 1000));
    return html;
  }

  function video(b) {
    return `<div class="vt-midia"><video src="${esc(b.midias[0])}" muted loop playsinline preload="metadata"></video></div>${textos(b)}`;
  }

  const L3 = (pt, en, es) => (typeof L === "function" ? L(pt, en, es) : pt);
  function casa(b, vaga) {
    vaga.classList.add("vt-casa", `vt-casa-${b.casa}`, "vt-tocavel");
    const acao = { farmaceutico: () => openChatbot(), voz: () => falarNaBusca(), libras: () => openOv("o-lb") }[b.casa];
    if (acao) vaga.addEventListener("click", () => { registrar("vitrine_clique", vaga); acao(); });
    if (b.casa === "ofertas") {
      carregarOfertas().then(lista => {
        const alvo = vaga.querySelector(".vt-casa-prods");
        if (!alvo || !lista.length) { if (!lista.length) vaga.classList.add("vt-vazia"); return; }
        vaga.querySelector(".vt-casa-pct").textContent = `-${lista[0].pct}%`;
        alvo.innerHTML = lista.map(({ p }) => `<button type="button" class="vt-casa-prod" data-id="${esc(p.id)}">
          ${productImageOrIcon(getTranslatedProduct(p), "card")}<b>${esc(precoLabel(p))}</b></button>`).join("");
        alvo.querySelectorAll(".vt-casa-prod").forEach(bt => bt.addEventListener("click", () => {
          registrar("vitrine_clique", vaga); openDetail(bt.dataset.id);
        }));
      });
      return `<div class="vt-casa-txt"><span class="vt-casa-pct">-%</span>
          <div class="vt-titulo">${esc(L3("Ofertas da semana", "Deals of the week", "Ofertas de la semana"))}</div>
          <div class="vt-sub">${esc(L3("Os maiores descontos da loja agora", "The biggest discounts right now", "Los mayores descuentos ahora"))}</div></div>
        <div class="vt-casa-prods"><div class="vt-carregando"></div></div>`;
    }
    const t = {
      farmaceutico: [L3("Dúvida sobre um remédio?", "Questions about a medicine?", "¿Dudas sobre un medicamento?"),
                     L3("Pergunte ao assistente ou fale com o farmacêutico no balcão.", "Ask the assistant or talk to the pharmacist.", "Pregunta al asistente o al farmacéutico."),
                     L3("Perguntar agora", "Ask now", "Preguntar"), "bot"],
      voz: [L3("Não achou? É só falar.", "Can't find it? Just say it.", "¿No lo encuentras? Dilo."),
            L3("Diga o nome do produto ou o que está sentindo.", "Say the product name or how you feel.", "Di el producto o lo que sientes."),
            L3("Falar agora", "Speak now", "Hablar"), "mic"],
      libras: [L3("Atendimento em Libras", "Sign language support", "Atención en lengua de señas"),
               L3("A câmera do totem reconhece os sinais e monta a frase.", "The kiosk camera reads the signs.", "La cámara reconoce las señas."),
               L3("Abrir Libras", "Open", "Abrir"), "hand"],
    }[b.casa];
    const ico = { bot: icon("bot"), hand: icon("hand"),
                  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>` }[t[3]];
    return `<div class="vt-casa-txt"><div class="vt-titulo">${esc(t[0])}</div><div class="vt-sub">${esc(t[1])}</div>
        <span class="vt-cta">${esc(t[2])}</span></div><div class="vt-casa-arte">${ico}</div>`;
  }

  let ofertasCache = null;
  async function carregarOfertas() {
    if (ofertasCache) return ofertasCache;
    const page = typeof apiGetProductsPage === "function" ? await apiGetProductsPage({ limit: 80, offset: 0 }) : null;
    const lista = (page ? page.items : [])
      .map(p => ({ p, pct: Number(p.precoOriginal) > Number(p.precoValor) ? Math.round((1 - p.precoValor / p.precoOriginal) * 100) : 0 }))
      .filter(x => x.pct > 0 && x.p.imgUrl && !x.p.esgotado).sort((a, b) => b.pct - a.pct).slice(0, 3);
    lista.forEach(({ p }) => { if (!produtos.some(x => String(x.id) === String(p.id))) produtos.push(p); });
    ofertasCache = lista;
    return lista;
  }

  function aviso(b) {
    return `<div class="vt-aviso-cor vt-cor-${esc(b.extras.cor || "azul")}">${textos(b)}</div>`;
  }

  function faixaProdutos(b, vaga) {
    carregarProdutos(b).then(lista => {
      const trilho = vaga.querySelector(".vt-prods");
      if (!trilho) return;
      if (!lista.length) { vaga.classList.add("vt-vazia"); return; }
      trilho.innerHTML = lista.map(p => productCardHtml(getTranslatedProduct(p), -1)).join("");
      if (typeof observarImpressoes === "function") observarImpressoes(trilho);
    });
    return `<div class="vt-prods-topo">${b.titulo ? `<div class="vt-titulo">${esc(b.titulo)}</div>` : ""}
      ${b.subtitulo ? `<div class="vt-sub">${esc(b.subtitulo)}</div>` : ""}</div>
      <div class="vt-prods"><div class="vt-carregando"></div></div>`;
  }

  async function carregarProdutos(b) {
    const { fonte, valor, limite } = b.extras;
    const filtro = { limit: fonte === "promocao" ? 60 : limite, offset: 0 };
    if (fonte === "categoria") filtro.categoria = valor;
    if (fonte === "nicho") filtro.nicho = valor;
    if (fonte === "busca") filtro.q = valor;
    const page = typeof apiGetProductsPage === "function" ? await apiGetProductsPage(filtro) : null;
    let itens = page ? page.items : [];
    if (fonte === "promocao") itens = itens.filter(p => Number(p.precoOriginal) > Number(p.precoValor)).slice(0, limite);
    itens.forEach(item => {   // openDetail procura no catálogo carregado
      if (!produtos.some(p => String(p.id) === String(item.id))) produtos.push(item);
    });
    return itens;
  }

  // ─── o que o toque faz ───────────────────────────────────────────────────
  async function executar(b) {
    const v = b.acao_valor;
    if (b.acao === "categoria") setCategory(v);
    else if (b.acao === "nicho") setNicho(v);
    else if (b.acao === "busca") {
      const campo = document.getElementById("s-in");
      if (campo) campo.value = v;
      onSrch(v);
    } else if (b.acao === "produto") {
      if (!produtos.some(p => String(p.id) === String(v))) {
        const page = await apiGetProductsPage({ q: v, limit: 1 });
        const item = page && page.items[0];
        if (!item) return;
        produtos.push(item);
        return openDetail(item.id);
      }
      openDetail(v);
    }
  }

  function reiniciar() {
    timers.forEach(clearInterval);
    timers = [];
    exibidos = {};
    ultimoNaVaga = null;
  }

  carregar();
  setInterval(carregar, 60000);   // mudanças do admin chegam sem recarregar o totem

  return {
    intercalar, observar, reiniciar, recarregar: carregar,
    get blocos() { return blocos; },
  };
})();
window.FlexVitrine = FlexVitrine;
