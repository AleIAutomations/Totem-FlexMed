// =====================================================
// FlexMed Admin — Vitrine entre produtos (p-vitrine)
// Blocos (banner, carrossel, vídeo, faixa de produtos, aviso) intercalados na
// rolagem infinita do totem, depois da linha escolhida, com público por idade
// (câmera) e por interesse da sessão. Backend: backend/vitrine.py.
// Usa os utilitários de admin_metricas.js (mtGet, mtEsc, mtFonte, MT_FAIXAS...).
// =====================================================

const VT_TIPOS = {
  banner: { nome: "Banner", desc: "Uma imagem larga, com texto e botão opcionais" },
  carrossel: { nome: "Carrossel", desc: "Várias imagens que passam sozinhas" },
  video: { nome: "Vídeo", desc: "Vídeo sem som, toca quando aparece na tela" },
  produtos: { nome: "Faixa de produtos", desc: "Produtos em destaque, rolando para o lado" },
  aviso: { nome: "Aviso", desc: "Cartão colorido só com texto (ex.: fale com o farmacêutico)" },
};
const VT_NICHOS = [["medicamentos", "Medicamentos"], ["beleza", "Beleza"], ["higiene", "Higiene e Cuidados"],
                   ["infantil", "Infantil"], ["bem_estar", "Saúde e Bem-estar"]];
const VT_ACOES = { nenhuma: "Nada (só exibe)", categoria: "Abrir uma categoria", nicho: "Abrir um nicho",
                   busca: "Buscar um termo", produto: "Abrir um produto" };
const VT_CORES = { azul: "#1a4d8f", verde: "#1b7a43", laranja: "#d97706", roxo: "#7c3aed", escuro: "#0a1628" };
let vtBlocos = [], vtCategorias = [], vtRelatorio = {}, vtEditando = null, vtDias = 7;
let vtCfg = { campanhas_ativas: true, campanhas_a_cada: 5 }, vtCampanhas = [];

async function vtSalvarCfg(mudanca) {
  const r = await fetch(`${FLEXMED_SERVER}/api/vitrine/config`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mudanca) }).catch(() => null);
  toast(r && r.ok ? "Salvo — o totem aplica em até 1 minuto" : "Não foi possível salvar");
  carregarVitrine();
}

async function carregarVitrine() {
  const alvo = document.getElementById("vt-painel");
  if (!alvo) return;
  const [blocos, cats, rel, cfg, camps] = await Promise.all([
    mtGet("/api/vitrine"), vtCategorias.length ? vtCategorias : mtGet("/api/categorias"),
    mtGet(`/api/vitrine/relatorio?dias=${vtDias}`), mtGet("/api/vitrine/config"), mtGet("/api/campaigns?active=true"),
  ]);
  vtCfg = cfg || { campanhas_ativas: true, campanhas_a_cada: 5 };
  vtCampanhas = (camps || []).filter(c => c.na_vitrine !== false && (c.media_urls || []).length);
  if (!blocos) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  vtBlocos = blocos;
  vtCategorias = (cats || []).filter(c => c.slug);
  vtRelatorio = rel || { blocos: {} };
  const ativos = blocos.filter(b => b.ativo);
  const totais = Object.values(vtRelatorio.blocos || {}).reduce((t, b) => ({ v: t.v + b.exibicoes, c: t.c + b.toques }), { v: 0, c: 0 });
  alvo.innerHTML = `
    <div class="mt-cabecalho">
      <div class="mt-legenda">Blocos que aparecem <b>entre as linhas de produtos</b> do totem, para a lista não ficar só de produtos.
        Escolha depois de qual linha cada bloco entra e, se quiser, para quem: a faixa etária que a câmera estima de quem está olhando e os interesses da sessão (o que a pessoa navegou ou abriu).</div>
      <div class="mt-cabecalho-dir">
        <button class="tb-btn tb-btn-primary" onclick="vtAbrir()">+ Novo bloco</button>
      </div>
    </div>
    <div class="stat-row">
      ${mtCard("Blocos ativos", ativos.length, `${blocos.length - ativos.length} pausados`)}
      ${mtCard("Segmentados", ativos.filter(b => b.faixas.length || b.interesses.length).length, "por idade e/ou interesse")}
      ${mtCard(`Exibições (${vtDias === 1 ? "hoje" : `${vtDias} dias`})`, totais.v, "vezes que um bloco apareceu na tela")}
      ${mtCard("Toques", totais.c, totais.v ? `${(totais.c / totais.v * 100).toFixed(1)}% das exibições` : "—", "emerald")}
    </div>
    <div class="card vt-camp-cfg">
      <div><div class="card-title">Campanhas entre os produtos</div>
        <div class="card-sub">${vtCampanhas.length} campanha(s) ativas marcadas para aparecer na lista (configure em Marketing › Campanhas). Entram nas linhas sem bloco próprio, escolhidas pela faixa etária de quem está olhando.</div></div>
      <div class="mt-cabecalho-dir">
        <span class="lj-sub">a cada</span>
        <select class="form-input" style="width:110px" onchange="vtSalvarCfg({campanhas_a_cada:Number(this.value)})">${[3, 4, 5, 6, 8, 10].map(n => `<option value="${n}" ${vtCfg.campanhas_a_cada === n ? "selected" : ""}>${n} linhas</option>`).join("")}</select>
        <label class="toggle-sw" title="Ligar/desligar"><input type="checkbox" ${vtCfg.campanhas_ativas ? "checked" : ""} onchange="vtSalvarCfg({campanhas_ativas:this.checked})"><span class="toggle-track"></span></label>
      </div>
      <label class="lj-check" style="flex-basis:100%"><input type="checkbox" ${vtCfg.anuncios_casa !== false ? "checked" : ""} onchange="vtSalvarCfg({anuncios_casa:this.checked})">
        Sem campanha ativa, usar os anúncios da casa (ofertas da semana com os maiores descontos, assistente, busca por voz e Libras)</label>
    </div>
    <div class="grid-2 vt-grid">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Blocos cadastrados</div>
          <div class="card-sub">Com mais de um bloco na mesma linha, entra o que combina com o público; empate = maior prioridade</div></div>
          <div class="mt-cabecalho-dir">${mtFonte(vtRelatorio.fonte)}<div class="mt-periodo">${[[1, "Hoje"], [7, "7 dias"], [30, "30 dias"]].map(([d, t]) =>
            `<button type="button" class="${vtDias === d ? "on" : ""}" onclick="vtDias=${d};carregarVitrine()">${t}</button>`).join("")}</div></div></div>
        ${blocos.length ? `<div class="vt-lista">${blocos.map(vtItem).join("")}</div>`
          : `<div class="mt-vazio">Nenhum bloco ainda. Crie o primeiro em “+ Novo bloco”.</div>`}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Mapa da rolagem</div>
          <div class="card-sub">Como as primeiras linhas do totem ficam (4 produtos por linha)</div></div></div>
        ${vtMapa(ativos)}
      </div>
    </div>`;
}

function vtPosicao(b) {
  return `Depois da linha ${b.apos_linha}${b.repetir_cada ? `, e a cada ${b.repetir_cada} linhas` : ""}`;
}

function vtPublico(b) {
  const partes = [];
  if (b.faixas.length) partes.push(b.faixas.map(f => (MT_FAIXAS[f] || f).replace(" anos", "")).join(", ") + " anos");
  if (b.interesses.length) partes.push("interesse em " + b.interesses.map(vtNomeInteresse).join(", "));
  return partes.join(" · ") || "Todos";
}

function vtNomeInteresse(slug) {
  return (VT_NICHOS.find(n => n[0] === slug) || [])[1] || (vtCategorias.find(c => c.slug === slug) || {}).nome || slug;
}

function vtMiniatura(b) {
  if (b.tipo === "aviso") return `<div class="vt-mini" style="background:${VT_CORES[b.extras.cor] || VT_CORES.azul}"></div>`;
  if (b.tipo === "produtos") return `<div class="vt-mini vt-mini-prods"><i></i><i></i><i></i><i></i></div>`;
  if (b.tipo === "video") return `<video class="vt-mini" src="${mtEsc(b.midias[0])}" muted preload="metadata"></video>`;
  return `<img class="vt-mini" src="${mtEsc(b.midias[0] || "")}" alt="">`;
}

function vtItem(b) {
  const r = (vtRelatorio.blocos || {})[String(b.id)] || { exibicoes: 0, toques: 0, taxa_toque: 0, faixas: {} };
  const totalFaixas = Object.values(r.faixas).reduce((a, n) => a + n, 0);
  return `<div class="vt-item ${b.ativo ? "" : "vt-pausado"}">
    ${vtMiniatura(b)}
    <div class="vt-item-info">
      <div class="vt-item-nome">${mtEsc(b.nome)} <span class="badge badge-blue">${mtEsc(VT_TIPOS[b.tipo].nome)}</span>
        ${b.prioridade ? `<span class="badge badge-gray">prioridade ${b.prioridade}</span>` : ""}</div>
      <div class="vt-item-sub">${mtEsc(vtPosicao(b))} · Para: ${mtEsc(vtPublico(b))}</div>
      <div class="vt-item-sub">${r.exibicoes} exibições · ${r.toques} toques (${r.taxa_toque}%)${b.acao !== "nenhuma" ? ` · toque: ${mtEsc(VT_ACOES[b.acao].toLowerCase())} “${mtEsc(b.acao_valor)}”` : ""}</div>
      ${totalFaixas ? `<div class="mt-mini" style="margin-top:6px;max-width:260px">${Object.entries(r.faixas).map(([f, n]) =>
        `<span title="${mtEsc(MT_FAIXAS[f] || f)}: ${n}" style="width:${n / totalFaixas * 100}%;background:${MT_CORES[f] || "#94a3b8"}"></span>`).join("")}</div>` : ""}
    </div>
    <div class="vt-item-acoes">
      <label class="toggle-sw" title="${b.ativo ? "Ativo" : "Pausado"}"><input type="checkbox" ${b.ativo ? "checked" : ""} onchange="vtAtivar(${b.id}, this.checked)"/><span class="toggle-track"></span></label>
      <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="vtAbrir(${b.id})">Editar</button>
      <button class="tb-btn tb-btn-ghost" style="font-size:12px;color:var(--crimson,#c81e33)" onclick="vtExcluir(${b.id})">Excluir</button>
    </div>
  </div>`;
}

function vtMapa(ativos) {
  const linhas = [];
  for (let l = 1; l <= 12; l++) {
    linhas.push(`<div class="vt-mapa-linha"><span>Linha ${l}</span><i></i><i></i><i></i><i></i></div>`);
    const aqui = ativos.filter(b => l === b.apos_linha || (b.repetir_cada && l > b.apos_linha && (l - b.apos_linha) % b.repetir_cada === 0));
    if (!aqui.length && vtCfg.campanhas_ativas && (vtCampanhas.length || vtCfg.anuncios_casa !== false) && l % vtCfg.campanhas_a_cada === 0) {
      linhas.push(`<div class="vt-mapa-bloco vt-mapa-camp"><span>${vtCampanhas.length ? `Campanha: ${mtEsc(vtCampanhas.map(c => c.name).join(" / "))}` : "Anúncio da casa (rodízio)"}</span>
        ${vtCampanhas.length > 1 ? `<em>o totem alterna pelo público</em>` : ""}</div>`);
    }
    if (aqui.length) {
      linhas.push(`<div class="vt-mapa-bloco">${aqui.map(b => `<span title="${mtEsc(vtPublico(b))}">
        ${mtEsc(VT_TIPOS[b.tipo].nome)}: ${mtEsc(b.nome)}${b.faixas.length || b.interesses.length ? " 🎯" : ""}</span>`).join("")}
        ${aqui.length > 1 ? `<em>o totem escolhe 1 de ${aqui.length} pelo público</em>` : ""}</div>`);
    }
  }
  return `<div class="vt-mapa">${linhas.join("")}<div class="vt-mapa-linha vt-mapa-fim">… a lista continua (blocos com “repetir” seguem aparecendo)</div></div>
    <div class="mt-legenda" style="margin-top:10px">🎯 = segmentado: só aparece se a pessoa na frente combinar. Se nenhum bloco da linha combinar, a linha segue só com produtos.</div>`;
}

// ─── formulário ─────────────────────────────────────────────────────────────
function vtAbrir(id) {
  const b = vtBlocos.find(x => x.id === id) || {
    tipo: "banner", nome: "", midias: [], titulo: "", subtitulo: "", cta: "", acao: "nenhuma", acao_valor: "",
    apos_linha: 2, repetir_cada: 0, faixas: [], interesses: [], prioridade: 0, ativo: true, inicio: null, fim: null,
    extras: { fonte: "promocao", valor: "", limite: 8, cor: "azul", intervalo_s: 4 },
  };
  vtEditando = JSON.parse(JSON.stringify(b));
  let fundo = document.getElementById("vt-modal");
  if (!fundo) {
    fundo = Object.assign(document.createElement("div"), { id: "vt-modal", className: "modal-bg" });
    fundo.addEventListener("click", e => { if (e.target === fundo) vtFechar(); });
    document.body.appendChild(fundo);
  }
  fundo.innerHTML = `<div class="modal vt-modal"><div id="vt-form"></div></div>`;
  fundo.classList.add("on");
  vtRenderForm();
}

function vtFechar() {
  document.getElementById("vt-modal")?.classList.remove("on");
  vtEditando = null;
}

function vtCampo(campo, valor) {
  if (campo.startsWith("extras.")) vtEditando.extras[campo.slice(7)] = valor;
  else vtEditando[campo] = valor;
}

function vtMarcar(lista, valor, on) {
  const s = new Set(vtEditando[lista]);
  on ? s.add(valor) : s.delete(valor);
  vtEditando[lista] = [...s];
}

function vtRenderForm() {
  const b = vtEditando, x = b.extras;
  const precisaMidia = ["banner", "carrossel", "video"].includes(b.tipo);
  const opcoes = (pares, atual) => pares.map(([v, t]) => `<option value="${mtEsc(v)}" ${v === atual ? "selected" : ""}>${mtEsc(t)}</option>`).join("");
  const cats = vtCategorias.map(c => [c.slug, c.nome]);
  const valorAcao = b.acao === "categoria" ? `<select class="form-input" onchange="vtCampo('acao_valor',this.value)"><option value="">Escolha…</option>${opcoes(cats, b.acao_valor)}</select>`
    : b.acao === "nicho" ? `<select class="form-input" onchange="vtCampo('acao_valor',this.value)"><option value="">Escolha…</option>${opcoes(VT_NICHOS, b.acao_valor)}</select>`
    : b.acao !== "nenhuma" ? `<input class="form-input" value="${mtEsc(b.acao_valor)}" placeholder="${b.acao === "produto" ? "Nome do produto (abre o primeiro encontrado)" : "Termo de busca"}" oninput="vtCampo('acao_valor',this.value)">` : "";
  document.getElementById("vt-form").innerHTML = `
    <div class="modal-title">${b.id ? "Editar bloco" : "Novo bloco da vitrine"}</div>
    <div class="modal-sub">Aparece entre as linhas de produtos do totem</div>
    <div class="form-group"><label class="form-label">Tipo</label>
      <div class="vt-tipos">${Object.entries(VT_TIPOS).map(([t, info]) => `<button type="button" class="${b.tipo === t ? "on" : ""}" onclick="vtCampo('tipo','${t}');vtRenderForm()">
        <b>${info.nome}</b><span>${info.desc}</span></button>`).join("")}</div></div>
    <div class="form-group"><label class="form-label">Nome interno</label>
      <input class="form-input" value="${mtEsc(b.nome)}" placeholder="Ex.: Protetor solar — verão" oninput="vtCampo('nome',this.value)"></div>
    ${precisaMidia ? `<div class="form-group"><label class="form-label">${b.tipo === "video" ? "Vídeo (MP4)" : b.tipo === "carrossel" ? "Imagens (2 ou mais)" : "Imagem"}</label>
      <div class="vt-midias">${b.midias.map((u, i) => `<div class="vt-midia-item">
        ${b.tipo === "video" ? `<video src="${mtEsc(u)}" muted></video>` : `<img src="${mtEsc(u)}" alt="">`}
        <button type="button" onclick="vtEditando.midias.splice(${i},1);vtRenderForm()" aria-label="Remover">×</button></div>`).join("")}
        ${b.tipo !== "video" || !b.midias.length ? `<label class="vt-midia-add">+ Enviar<input type="file" accept="${b.tipo === "video" ? "video/mp4,video/webm" : "image/*"}" ${b.tipo === "carrossel" ? "multiple" : ""} hidden onchange="vtEnviar(this.files)"></label>` : ""}
      </div>
      <span class="form-hint">Imagem larga (proporção ~16:5, ex.: 1600×500). Ou cole um link:</span>
      <input class="form-input" style="margin-top:6px" placeholder="https://…" onkeydown="if(event.key==='Enter'){event.preventDefault();vtAddUrl(this)}" onblur="vtAddUrl(this)"></div>` : ""}
    ${b.tipo === "produtos" ? `<div class="form-row">
      <div class="form-group"><label class="form-label">Quais produtos</label>
        <select class="form-input" onchange="vtCampo('extras.fonte',this.value);vtRenderForm()">${opcoes([["promocao", "Em promoção"], ["categoria", "De uma categoria"], ["nicho", "De um nicho"], ["busca", "De uma busca"]], x.fonte)}</select></div>
      <div class="form-group"><label class="form-label">${x.fonte === "busca" ? "Termo" : x.fonte === "promocao" ? "Quantidade" : "Qual"}</label>
        ${x.fonte === "categoria" ? `<select class="form-input" onchange="vtCampo('extras.valor',this.value)"><option value="">Escolha…</option>${opcoes(cats, x.valor)}</select>`
          : x.fonte === "nicho" ? `<select class="form-input" onchange="vtCampo('extras.valor',this.value)"><option value="">Escolha…</option>${opcoes(VT_NICHOS, x.valor)}</select>`
          : x.fonte === "busca" ? `<input class="form-input" value="${mtEsc(x.valor)}" oninput="vtCampo('extras.valor',this.value)">`
          : `<input class="form-input" type="number" min="4" max="16" value="${x.limite}" oninput="vtCampo('extras.limite',Number(this.value))">`}</div></div>` : ""}
    ${b.tipo === "aviso" ? `<div class="form-group"><label class="form-label">Cor</label><div class="vt-cores">${Object.entries(VT_CORES).map(([c, hex]) =>
      `<button type="button" class="${x.cor === c ? "on" : ""}" style="background:${hex}" onclick="vtCampo('extras.cor','${c}');vtRenderForm()" aria-label="${c}"></button>`).join("")}</div></div>` : ""}
    ${b.tipo === "carrossel" ? `<div class="form-group"><label class="form-label">Trocar de imagem a cada</label>
      <select class="form-input" onchange="vtCampo('extras.intervalo_s',Number(this.value))">${opcoes([3, 4, 6, 8, 10].map(s => [s, `${s} segundos`]), x.intervalo_s)}</select></div>` : ""}
    <div class="form-row">
      <div class="form-group"><label class="form-label">Título ${b.tipo === "aviso" ? "" : "(opcional)"}</label><input class="form-input" value="${mtEsc(b.titulo)}" maxlength="90" oninput="vtCampo('titulo',this.value)"></div>
      <div class="form-group"><label class="form-label">Texto do botão (opcional)</label><input class="form-input" value="${mtEsc(b.cta)}" maxlength="30" placeholder="Ver ofertas" oninput="vtCampo('cta',this.value)"></div>
    </div>
    <div class="form-group"><label class="form-label">Subtítulo (opcional)</label><input class="form-input" value="${mtEsc(b.subtitulo)}" maxlength="160" oninput="vtCampo('subtitulo',this.value)"></div>
    ${b.tipo !== "produtos" ? `<div class="form-row">
      <div class="form-group"><label class="form-label">Ao tocar</label><select class="form-input" onchange="vtCampo('acao',this.value);vtCampo('acao_valor','');vtRenderForm()">${opcoes(Object.entries(VT_ACOES), b.acao)}</select></div>
      <div class="form-group"><label class="form-label">&nbsp;</label>${valorAcao}</div></div>` : ""}
    <div class="vt-secao">Onde aparece</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Depois da linha</label>
        <input class="form-input" type="number" min="1" max="200" value="${b.apos_linha}" oninput="vtCampo('apos_linha',Number(this.value))">
        <span class="form-hint">Linha 1 = primeiros 4 produtos</span></div>
      <div class="form-group"><label class="form-label">Repetir</label>
        <select class="form-input" onchange="vtCampo('repetir_cada',Number(this.value))">${opcoes([[0, "Não repetir"], ...[2, 3, 4, 5, 6, 8, 10].map(n => [n, `A cada ${n} linhas`])], b.repetir_cada)}</select></div>
    </div>
    <div class="vt-secao">Para quem (visão computacional e interesse)</div>
    <div class="form-group"><label class="form-label">Faixa etária de quem está olhando</label>
      <div class="camp-faixas">${MT_SEGMENTADAS.map(f => `<label><input type="checkbox" ${b.faixas.includes(f) ? "checked" : ""} onchange="vtMarcar('faixas','${f}',this.checked)"> ${mtEsc(MT_FAIXAS[f])}</label>`).join("")}</div>
      <span class="form-hint">Nenhuma marcada = qualquer idade. Marcadas = só aparece quando a câmera estima uma dessas faixas.</span></div>
    <div class="form-group"><label class="form-label">Interesse da sessão</label>
      <div class="camp-faixas vt-interesses">${[...VT_NICHOS, ...cats].map(([s, n]) => `<label><input type="checkbox" ${b.interesses.includes(s) ? "checked" : ""} onchange="vtMarcar('interesses','${mtEsc(s)}',this.checked)"> ${mtEsc(n)}</label>`).join("")}</div>
      <span class="form-hint">Nenhum marcado = qualquer pessoa. Marcados = só aparece para quem está navegando, abriu ou pôs na lista algo desses nichos/categorias.</span></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Prioridade</label>
        <select class="form-input" onchange="vtCampo('prioridade',Number(this.value))">${opcoes([0, 1, 2, 3, 5, 8, 10].map(n => [n, n ? `${n}${n >= 8 ? " (alta)" : ""}` : "0 (normal)"]), b.prioridade)}</select></div>
      <div class="form-group"><label class="form-label">Ativo</label>
        <label class="toggle-sw" style="margin-top:8px"><input type="checkbox" ${b.ativo ? "checked" : ""} onchange="vtCampo('ativo',this.checked)"><span class="toggle-track"></span></label></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Começa em (opcional)</label><input class="form-input" type="datetime-local" value="${mtEsc(b.inicio || "")}" onchange="vtCampo('inicio',this.value)"></div>
      <div class="form-group"><label class="form-label">Termina em (opcional)</label><input class="form-input" type="datetime-local" value="${mtEsc(b.fim || "")}" onchange="vtCampo('fim',this.value)"></div>
    </div>
    <div class="vt-erro" id="vt-erro"></div>
    <div class="modal-actions">
      <button class="tb-btn tb-btn-ghost" onclick="vtFechar()">Cancelar</button>
      <button class="tb-btn tb-btn-primary" onclick="vtSalvar()">${b.id ? "Salvar" : "Criar bloco"}</button>
    </div>`;
}

function vtAddUrl(input) {
  const u = input.value.trim();
  if (!/^https?:\/\//.test(u)) return;
  if (vtEditando.tipo === "carrossel") vtEditando.midias.push(u); else vtEditando.midias = [u];
  input.value = "";
  vtRenderForm();
}

async function vtEnviar(arquivos) {
  for (const arq of arquivos) {
    const fd = new FormData();
    fd.append("file", arq);
    try {
      const r = await fetch(`${FLEXMED_SERVER}/api/upload`, { method: "POST", body: fd });
      const j = await r.json();
      if (!j.url) continue;
      if (vtEditando.tipo === "carrossel") vtEditando.midias.push(j.url); else vtEditando.midias = [j.url];
    } catch (_) { toast("Falha ao enviar o arquivo"); }
  }
  vtRenderForm();
}

const VT_ERROS = { midia_obrigatoria: "Envie a imagem ou o vídeo do bloco.", tipo_invalido: "Escolha o tipo do bloco." };

async function vtSalvar() {
  const b = vtEditando;
  const erro = document.getElementById("vt-erro");
  if (b.tipo === "carrossel" && b.midias.length < 2) { erro.textContent = "O carrossel precisa de pelo menos 2 imagens."; return; }
  if (b.tipo === "aviso" && !b.titulo.trim()) { erro.textContent = "O aviso precisa de um título."; return; }
  if (b.acao !== "nenhuma" && !b.acao_valor) { erro.textContent = "Diga o que o toque deve abrir."; return; }
  const r = await fetch(`${FLEXMED_SERVER}/api/vitrine${b.id ? `/${b.id}` : ""}`, {
    method: b.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  }).catch(() => null);
  if (!r || !r.ok) {
    const j = r ? await r.json().catch(() => ({})) : {};
    erro.textContent = VT_ERROS[j.error] || "Não foi possível salvar. O backend está ligado?";
    return;
  }
  vtFechar();
  toast(b.id ? "Bloco atualizado — o totem aplica em até 1 minuto" : "Bloco criado — o totem aplica em até 1 minuto");
  carregarVitrine();
}

async function vtAtivar(id, ativo) {
  await fetch(`${FLEXMED_SERVER}/api/vitrine/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo }),
  }).catch(() => null);
  toast(ativo ? "Bloco ativado" : "Bloco pausado");
  carregarVitrine();
}

async function vtExcluir(id) {
  const b = vtBlocos.find(x => x.id === id);
  if (!b || !confirm(`Excluir o bloco “${b.nome}”?`)) return;
  await fetch(`${FLEXMED_SERVER}/api/vitrine/${id}`, { method: "DELETE" }).catch(() => null);
  toast("Bloco excluído");
  carregarVitrine();
}
