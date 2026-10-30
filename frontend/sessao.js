// =====================================================
// FlexMed — sessões de uso do totem (log anônimo de navegação)
// Uma sessão começa quando alguém toca o totem e termina quando ele volta ao
// modo de espera. Registra cliques, telas, buscas, produtos vistos, carrinho,
// voz e Libras; o backend calcula se finalizou ou desistiu e em qual tela.
// A atenção (tempo olhando para a tela) e a faixa etária vêm da câmera.
//
// Comportamento (página Atividade do admin):
//   clique / toque   onde o dedo tocou (x, y de 0 a 1) e em qual região da tela;
//                    "toque" = tocou onde não havia nada (toque sem resposta)
//   tela_tempo       quanto tempo ficou em cada tela e quanto disso olhou (câmera)
//   produto_tempo    quanto tempo ficou na página de um produto, olhando e rolando
//   impressoes       produtos que apareceram na tela por pelo menos ~1 s
//   rolagem          até qual linha de produtos a pessoa rolou
//   layout           caixas das regiões da tela (fundo do mapa de toques)
// =====================================================

const FlexSessao = (() => {
  let id = null, tela = "inicio", fila = [], timer = null;
  let telaDesde = 0, telaOlhando = 0, produtoAberto = null, impressoes = new Set(), pendentes = [], maxLinha = 0;
  let layouts = new Set();   // telas cujo desenho já foi registrado nesta sessão

  // regiões da tela do totem, da mais específica para a mais geral
  const REGIOES = [
    [".vt-slot", "vitrine"], ["#o-cart", "carrinho"], ["#o-lb", "libras"], ["#o-rate", "avaliacao"], ["#o-qr", "qr"],
    ["#ag-bub", "assistente"], ["#agent", "assistente"], ["#dp-rodape", "produto_comprar"], ["#detail", "produto"],
    ["#s-drop", "busca"], ["#s-area", "busca"], ["#subcats-row", "categorias"], ["#cats-bar", "nichos"],
    ["#banner-track", "banner"], ["#p-grid", "produtos"], ["#nav", "menu"], ["#hdr", "cabecalho"],
  ];

  const agora = () => Date.now() / 1000;
  const novoId = () => (crypto.randomUUID ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  function enviarFila(manterViva = false) {
    if (!id) return;
    // produtos que apareceram na tela vão em lotes pequenos (o detalhe tem limite de tamanho)
    while (pendentes.length) evento("impressoes", "", { ids: pendentes.splice(0, 40) }, false);
    if (!fila.length) return;
    const lote = fila.splice(0, fila.length);
    fetch(`${FLEXMED_API_BASE}/sessoes/${encodeURIComponent(id)}/eventos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventos: lote }),
      keepalive: manterViva,
    }).catch(() => {});
  }

  function evento(tipo, alvo = "", detalhe = {}, enviar = true) {
    if (!id) return;
    fila.push({ ts: agora(), tipo, alvo: String(alvo || "").slice(0, 120), tela, detalhe });
    if (enviar && fila.length >= 20) enviarFila();
  }

  const olhandoAgora = () => !!(window.FlexAudiencia && FlexAudiencia.retrato().olhando > 0);

  // a cada segundo: soma o tempo olhando para a tela atual e para o produto aberto
  setInterval(() => {
    if (!id || !olhandoAgora()) return;
    telaOlhando += 1;
    if (produtoAberto) produtoAberto.olhando += 1;
  }, 1000);

  function fecharTela() {
    if (!id || !telaDesde) return;
    const duracao = agora() - telaDesde;
    if (duracao >= 0.5) {
      evento("tela_tempo", tela, { duracao_s: +duracao.toFixed(1), olhando_s: Math.min(telaOlhando, Math.round(duracao)) });
    }
    telaDesde = agora();
    telaOlhando = 0;
  }

  // desenho das regiões visíveis da tela atual (uma vez por tela em cada sessão)
  function registrarLayout() {
    if (!id || layouts.has(tela)) return;
    layouts.add(tela);
    const caixas = {};
    for (const [sel, nome] of REGIOES) {
      const el = document.querySelector(sel);
      if (!el || caixas[nome] || sel === ".vt-slot") continue;
      const r = el.getBoundingClientRect(), css = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || css.display === "none" || css.visibility === "hidden" || +css.opacity === 0) continue;
      if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue;   // painel fechado fora da tela
      caixas[nome] = [r.left / innerWidth, r.top / innerHeight, r.width / innerWidth, r.height / innerHeight].map(v => +v.toFixed(3));
    }
    evento("layout", `${innerWidth}x${innerHeight}`, { w: innerWidth, h: innerHeight, regioes: caixas });
  }

  function iniciar(origem = "toque") {
    if (id) return id;
    id = novoId();
    tela = "inicio";
    telaDesde = agora();
    telaOlhando = 0;
    produtoAberto = null;
    impressoes = new Set();
    pendentes = [];
    maxLinha = 0;
    layouts = new Set();
    fetch(`${FLEXMED_API_BASE}/sessoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, origem }),
    }).catch(() => {});
    if (window.FlexAudiencia) FlexAudiencia.setSessao(id);
    timer = setInterval(() => enviarFila(), 5000);
    setTimeout(registrarLayout, 300);
    return id;
  }

  function finalizar(saida = "inatividade") {
    if (!id) return;
    const sid = id;
    produtoFechou();
    fecharTela();
    if (maxLinha) evento("rolagem", "", { max_linha: maxLinha, produtos_vistos: impressoes.size }, false);
    enviarFila(true);
    clearInterval(timer);
    // pequeno atraso para os últimos eventos chegarem antes do fechamento
    setTimeout(() => {
      fetch(`${FLEXMED_API_BASE}/sessoes/${encodeURIComponent(sid)}/fim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ultima_tela: tela, saida }),
        keepalive: true,
      }).catch(() => {});
    }, 300);
    if (window.FlexAudiencia) FlexAudiencia.setSessao(null);
    id = null;
  }

  function mudarTela(nova) {
    if (!id || !nova || nova === tela) return;
    fecharTela();
    tela = nova;
    evento("tela", nova);
    setTimeout(registrarLayout, 700);   // depois da animação de abertura
  }

  // ─── página do produto ────────────────────────────────────────────────────
  function produtoAbriu(p) {
    if (!id) return;
    produtoFechou();
    produtoAberto = { id: String(p.id), nome: p.nome, categoria: p.categoria, desde: agora(), olhando: 0, rolou: 0 };
  }

  function produtoRolou(pct) {
    if (produtoAberto) produtoAberto.rolou = Math.max(produtoAberto.rolou, Math.min(1, pct));
  }

  function produtoFechou() {
    if (!id || !produtoAberto) return;
    const p = produtoAberto, duracao = agora() - p.desde;
    produtoAberto = null;
    evento("produto_tempo", p.nome, {
      id: p.id, categoria: p.categoria, duracao_s: +duracao.toFixed(1),
      olhando_s: Math.min(p.olhando, Math.round(duracao)), rolou_pct: Math.round(p.rolou * 100),
    });
  }

  // ─── produtos que apareceram na tela ─────────────────────────────────────
  function impressao(produtoId, linha = 0) {
    if (!id) return;
    maxLinha = Math.max(maxLinha, linha);
    const pid = String(produtoId);
    if (impressoes.has(pid)) return;
    impressoes.add(pid);
    pendentes.push(pid);
  }

  // Descrição curta do que foi tocado (texto do botão/card, ou a ação do onclick)
  function descrever(el) {
    const rotulo = el.getAttribute("aria-label") || el.dataset.track;
    if (rotulo) return rotulo;
    const texto = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (texto) return texto.slice(0, 60);
    const acao = (el.getAttribute("onclick") || "").match(/^\s*([\w.]+)/);
    return acao ? acao[1] : el.tagName.toLowerCase();
  }

  function regiao(alvo) {
    for (const [sel, nome] of REGIOES) if (alvo.closest && alvo.closest(sel)) return nome;
    return "outro";
  }

  // Todo toque vira um evento com a posição: "clique" se acertou algo tocável, "toque" se não
  document.addEventListener("click", e => {
    if (!id) return;
    const onde = {
      x: +(e.clientX / innerWidth).toFixed(3), y: +(e.clientY / innerHeight).toFixed(3), regiao: regiao(e.target),
    };
    const el = e.target.closest("button, a, input, textarea, select, label, .p-card, .cat, .ag-prod, .dp-rel, .vt-tocavel, [onclick]");
    if (el) evento("clique", descrever(el), onde);
    else evento("toque", onde.regiao, onde);
  }, true);

  // Primeiro toque com o totem fora do modo de espera também abre sessão
  document.addEventListener("pointerdown", () => {
    if (!id && !(window.__standby && window.__standby.isActive())) iniciar("toque");
  }, true);

  window.addEventListener("pagehide", () => finalizar("saiu_da_pagina"));

  return {
    iniciar, finalizar, evento, tela: mudarTela, produtoAbriu, produtoRolou, produtoFechou, impressao,
    get id() { return id; },
    get ativa() { return !!id; },
  };
})();
// const no topo do script não vira window.*: expõe para os outros módulos
window.FlexSessao = FlexSessao;
