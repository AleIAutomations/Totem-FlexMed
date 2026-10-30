// =====================================================
// FlexMed Admin — Categorias (p-categorias), em Loja
// Dois níveis, como no totem: categorias (nichos do topo: Medicamentos,
// Beleza...) e subcategorias (Analgésicos, Dermocosméticos...). Criar, renomear,
// trocar ícone, ativar/desativar, reordenar e mover subcategorias de categoria.
// Excluir pede para onde vão os produtos/subcategorias. Backend: backend/taxonomia.py.
// =====================================================

// Mesmos ícones do totem (frontend/script.js › icon())
const CT_ICONES = {
        home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7"></path><path d="M5 10v10h14V10"></path></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
        hand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0z"/></svg>`,
        palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-4z"></path><circle cx="7.5" cy="10.5" r=".8" fill="currentColor" stroke="none"></circle><circle cx="10" cy="7.5" r=".8" fill="currentColor" stroke="none"></circle><circle cx="15" cy="7.5" r=".8" fill="currentColor" stroke="none"></circle></svg>`,
        star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"></polygon></svg>`,
        bar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M7 15v-3"></path><path d="M12 15V8"></path><path d="M17 15v-6"></path></svg>`,
        search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>`,
        pill: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 4.9 7.9a3.5 3.5 0 1 1 5-5l5.6 5.6"></path><path d="m13.5 10.5 5.6 5.6a3.5 3.5 0 1 1-5 5l-5.6-5.6"></path><path d="m8 6 10 10"></path></svg>`,
        shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
        leaf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 18 7c0 5-2 11-7 13Z"></path><path d="M6 4c6 0 9 3 9 9-6 0-9-3-9-9Z"></path></svg>`,
        drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"></path></svg>`,
        sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`,
        smile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><path d="M9 9h.01"></path><path d="M15 9h.01"></path></svg>`,
        spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"></path></svg>`,
        pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.3 7-11a7 7 0 0 0-14 0c0 5.7 7 11 7 11Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>`,
        pinSm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s5.4-4.2 5.4-8.9a5.4 5.4 0 1 0-10.8 0C6.6 15.8 12 20 12 20Z"></path><circle cx="12" cy="11" r="1.9"></circle></svg>`,
        snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="m4.93 6.93 14.14 10.14"></path><path d="M19.07 6.93 4.93 17.07"></path><path d="m8.5 4 3.5 2 3.5-2"></path><path d="m8.5 20 3.5-2 3.5 2"></path><path d="m3.5 9 3.5 2-3.5 2"></path><path d="m20.5 9-3.5 2 3.5 2"></path></svg>`,
        target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>`,
        doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>`,
        box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`,
        tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82Z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" stroke="none"></circle></svg>`,
        info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`,
        bot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="3"></rect><path d="M8 22h8"></path><path d="M12 18v4"></path><circle cx="9" cy="11" r="1"></circle><circle cx="15" cy="11" r="1"></circle><path d="M9 14c1 .7 2 .9 3 .9s2-.2 3-.9"></path></svg>`,
        cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`,
        arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>`,
        qr: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3h-3zM17 17h3v3h-3z" fill="currentColor" stroke="none" opacity=".65"></path></svg>`,
        store: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg>`
      };

let ctArvore = null, ctEdit = null;

// O totem usa o ícone próprio da categoria (icones.js) quando existe; senão, o escolhido aqui
const ctIcone = (slug, nome, icone) => (window.FlexIcones && FlexIcones.de(slug, nome)) || CT_ICONES[icone] || CT_ICONES.tag;

async function carregarCategorias() {
  const alvo = document.getElementById("ct-painel");
  if (!alvo) return;
  const r = await mtGet("/api/loja/taxonomia");
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  ctArvore = r;
  const subs = r.nichos.reduce((n, c) => n + c.categorias.length, 0);
  alvo.innerHTML = `
    <div class="mt-cabecalho">
      <div class="mt-legenda">O totem mostra as <b>categorias</b> no topo e, ao tocar numa delas, as <b>subcategorias</b> logo abaixo. Só aparecem no totem as subcategorias ativas e com produtos. Mudanças valem no totem na próxima vez que ele carregar as categorias.</div>
      <div class="mt-cabecalho-dir">
        <button class="tb-btn tb-btn-ghost" onclick="ctAbrir('nicho')">+ Nova categoria</button>
        <button class="tb-btn tb-btn-primary" onclick="ctAbrir('categoria')">+ Nova subcategoria</button>
      </div>
    </div>
    <div class="stat-row">
      ${mtCard("Categorias", r.nichos.length, `${r.nichos.filter(n => n.ativo).length} ativas no totem`)}
      ${mtCard("Subcategorias", subs, `${r.nichos.reduce((n, c) => n + c.categorias.filter(s => s.ativo).length, 0)} ativas`)}
      ${mtCard("Produtos classificados", r.nichos.reduce((n, c) => n + c.produtos, 0), "em alguma subcategoria")}
      ${mtCard("Subcategorias vazias", r.nichos.reduce((n, c) => n + c.categorias.filter(s => !s.total).length, 0), "não aparecem no totem")}
    </div>
    <div class="ct-arvore">${r.nichos.map((n, i) => `
      <div class="ct-nicho ${n.ativo ? "" : "ct-inativo"}">
        <div class="ct-nicho-topo">
          <span class="ct-ico">${ctIcone(n.slug, n.nome, n.icone)}</span>
          <div class="ct-nicho-nome"><b>${mtEsc(n.nome)}</b><span>${n.categorias.length} subcategorias · ${n.produtos} produtos</span></div>
          <div class="ct-acoes">
            <button class="ct-mini" title="Subir" ${i ? "" : "disabled"} onclick="ctMoverNicho(${i},-1)">↑</button>
            <button class="ct-mini" title="Descer" ${i < r.nichos.length - 1 ? "" : "disabled"} onclick="ctMoverNicho(${i},1)">↓</button>
            <label class="toggle-sw" title="${n.ativo ? "Ativa no totem" : "Escondida do totem"}"><input type="checkbox" ${n.ativo ? "checked" : ""} onchange="ctSalvarRapido('nicho','${n.slug}',{ativo:this.checked})"><span class="toggle-track"></span></label>
            <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="ctAbrir('nicho','${n.slug}')">Editar</button>
          </div>
        </div>
        <div class="ct-subs">${n.categorias.map((c, j) => `
          <div class="ct-sub ${c.ativo ? "" : "ct-inativo"}">
            <span class="ct-ico ct-ico-p">${ctIcone(c.slug, c.nome, c.icone)}</span>
            <div class="ct-sub-nome"><b>${mtEsc(c.nome)}</b><span>${c.total} produto(s)${c.total ? "" : " · não aparece no totem"}</span></div>
            <button class="ct-mini" ${j ? "" : "disabled"} onclick="ctMoverSub('${n.slug}',${j},-1)">↑</button>
            <button class="ct-mini" ${j < n.categorias.length - 1 ? "" : "disabled"} onclick="ctMoverSub('${n.slug}',${j},1)">↓</button>
            <label class="toggle-sw"><input type="checkbox" ${c.ativo ? "checked" : ""} onchange="ctSalvarRapido('categoria','${c.slug}',{ativo:this.checked})"><span class="toggle-track"></span></label>
            <button class="ct-mini ct-mini-txt" onclick="ctAbrir('categoria','${c.slug}')">Editar</button>
          </div>`).join("") || `<div class="ct-vazio">Nenhuma subcategoria. <a href="#" onclick="ctAbrir('categoria',null,'${n.slug}');return false">Criar a primeira</a></div>`}
          <button class="ct-add" onclick="ctAbrir('categoria',null,'${n.slug}')">+ Subcategoria em ${mtEsc(n.nome)}</button>
        </div>
      </div>`).join("")}</div>
    ${r.sem_nicho.length ? `<div class="card"><div class="card-title">Subcategorias sem categoria</div><div class="ct-subs">${r.sem_nicho.map(c =>
      `<div class="ct-sub"><div class="ct-sub-nome"><b>${mtEsc(c.nome)}</b><span>${c.total} produto(s)</span></div><button class="ct-mini ct-mini-txt" onclick="ctAbrir('categoria','${c.slug}')">Mover</button></div>`).join("")}</div></div>` : ""}`;
}

const ctTodasSubs = () => ctArvore.nichos.flatMap(n => n.categorias).concat(ctArvore.sem_nicho);

function ctAbrir(tipo, slug = null, nichoPadrao = null) {
  const atual = tipo === "nicho" ? ctArvore.nichos.find(n => n.slug === slug) : ctTodasSubs().find(c => c.slug === slug);
  ctEdit = { tipo, slug, nome: atual?.nome || "", icone: atual?.icone || "tag", ativo: atual ? atual.ativo : true,
             nicho: atual?.nicho || nichoPadrao || ctArvore.nichos[0]?.slug, total: atual?.total || 0,
             subs: tipo === "nicho" && atual ? atual.categorias.length : 0, destino: "" };
  let fundo = document.getElementById("ct-modal");
  if (!fundo) {
    fundo = Object.assign(document.createElement("div"), { id: "ct-modal", className: "modal-bg" });
    fundo.addEventListener("click", e => { if (e.target === fundo) ctFechar(); });
    document.body.appendChild(fundo);
  }
  fundo.innerHTML = `<div class="modal" style="max-width:560px"><div id="ct-form"></div></div>`;
  fundo.classList.add("on");
  ctForm();
}

function ctFechar() { document.getElementById("ct-modal")?.classList.remove("on"); ctEdit = null; }

function ctForm() {
  const e = ctEdit, nicho = e.tipo === "nicho";
  const destinos = nicho ? ctArvore.nichos.filter(n => n.slug !== e.slug).map(n => [n.slug, n.nome])
                         : ctTodasSubs().filter(c => c.slug !== e.slug).map(c => [c.slug, `${c.nome} (${c.nicho_nome})`]);
  const precisaDestino = nicho ? e.subs > 0 : e.total > 0;
  document.getElementById("ct-form").innerHTML = `
    <div class="modal-title">${e.slug ? "Editar" : "Nova"} ${nicho ? "categoria" : "subcategoria"}</div>
    <div class="modal-sub">${nicho ? "Aparece no topo do totem (1º nível)" : "Aparece abaixo da categoria escolhida (2º nível)"}</div>
    <div class="form-group"><label class="form-label">Nome</label><input class="form-input" id="ct-nome" value="${mtEsc(e.nome)}" maxlength="${nicho ? 40 : 60}" oninput="ctEdit.nome=this.value" placeholder="${nicho ? "Ex.: Dermocosméticos" : "Ex.: Protetor solar"}"></div>
    ${nicho ? "" : `<div class="form-group"><label class="form-label">Dentro da categoria</label>
      <select class="form-input" onchange="ctEdit.nicho=this.value">${ctArvore.nichos.map(n => `<option value="${n.slug}" ${n.slug === e.nicho ? "selected" : ""}>${mtEsc(n.nome)}</option>`).join("")}</select></div>`}
    ${e.slug && window.FlexIcones && FlexIcones.de(e.slug, e.nome) ? `<div class="form-group"><label class="form-label">Ícone da identidade visual</label>
      <div class="ct-icones"><button type="button" class="on" style="cursor:default">${FlexIcones.de(e.slug, e.nome)}</button></div>
      <span class="form-hint">Esta categoria tem um ícone desenhado para a marca; ele é usado no totem. O ícone abaixo só vale se ele for removido.</span></div>` : ""}
    <div class="form-group"><label class="form-label">Ícone no totem${e.slug && window.FlexIcones && FlexIcones.de(e.slug, e.nome) ? " (reserva)" : ""}</label>
      <div class="ct-icones">${ctArvore.icones.filter(i => CT_ICONES[i]).map(i => `<button type="button" class="${e.icone === i ? "on" : ""}" title="${i}" onclick="ctEdit.icone='${i}';ctForm()">${CT_ICONES[i]}</button>`).join("")}</div></div>
    <div class="lj-switches"><label><span class="toggle-sw"><input type="checkbox" ${e.ativo ? "checked" : ""} onchange="ctEdit.ativo=this.checked"><span class="toggle-track"></span></span> Mostrar no totem</label></div>
    ${e.slug ? `<div class="vt-secao">Excluir</div>
      ${precisaDestino ? `<div class="form-group"><label class="form-label">${nicho ? `As ${e.subs} subcategorias vão para` : `Os ${e.total} produtos vão para`}</label>
        <select class="form-input" onchange="ctEdit.destino=this.value"><option value="">Escolha…</option>${destinos.map(([v, t]) => `<option value="${v}">${mtEsc(t)}</option>`).join("")}</select></div>` : ""}
      <button class="tb-btn tb-btn-ghost" style="color:#c81e33" onclick="ctExcluir()">Excluir ${nicho ? "categoria" : "subcategoria"}</button>` : ""}
    <div class="vt-erro" id="ct-erro"></div>
    <div class="modal-actions"><button class="tb-btn tb-btn-ghost" onclick="ctFechar()">Cancelar</button>
      <button class="tb-btn tb-btn-primary" onclick="ctSalvar()">${e.slug ? "Salvar" : "Criar"}</button></div>`;
  setTimeout(() => document.getElementById("ct-nome")?.focus(), 50);
}

const CT_ERROS = { ja_existe: "Já existe uma com esse nome.", nome_obrigatorio: "Informe o nome.", nicho_invalido: "Escolha a categoria.",
                   escolha_destino: "Escolha para onde mover antes de excluir." };

async function ctSalvar() {
  const e = ctEdit, nicho = e.tipo === "nicho";
  if (!e.nome.trim()) { document.getElementById("ct-erro").textContent = CT_ERROS.nome_obrigatorio; return; }
  const corpo = { nome: e.nome.trim(), icone: e.icone, ativo: e.ativo, ...(nicho ? {} : { nicho: e.nicho }) };
  const caminho = `/api/loja/${nicho ? "nichos" : "categorias"}${e.slug ? `/${e.slug}` : ""}`;
  const r = await lojaEnviar(caminho, e.slug ? "PUT" : "POST", corpo);
  if (!r.ok) { document.getElementById("ct-erro").textContent = CT_ERROS[r.erro] || r.erro; return; }
  ctFechar();
  toast(e.slug ? "Alterações salvas" : `${nicho ? "Categoria" : "Subcategoria"} criada`);
  catCategorias = [];   // o catálogo recarrega a lista de subcategorias
  carregarCategorias();
}

async function ctSalvarRapido(tipo, slug, mudanca) {
  const r = await lojaEnviar(`/api/loja/${tipo === "nicho" ? "nichos" : "categorias"}/${slug}`, "PUT", mudanca);
  toast(r.ok ? (mudanca.ativo ? "Visível no totem" : "Escondida do totem") : r.erro);
  carregarCategorias();
}

async function ctExcluir() {
  const e = ctEdit, nicho = e.tipo === "nicho";
  if (!confirm(`Excluir “${e.nome}”?`)) return;
  const r = await lojaEnviar(`/api/loja/${nicho ? "nichos" : "categorias"}/${e.slug}?mover_para=${encodeURIComponent(e.destino)}`, "DELETE");
  if (!r.ok) { document.getElementById("ct-erro").textContent = CT_ERROS[r.erro] || r.erro; return; }
  ctFechar();
  toast(nicho ? "Categoria excluída" : `Subcategoria excluída${r.dados.movidos ? ` · ${r.dados.movidos} produtos movidos` : ""}`);
  catCategorias = [];
  carregarCategorias();
}

async function ctOrdem(corpo) {
  await lojaEnviar("/api/loja/taxonomia/ordem", "POST", corpo);
  carregarCategorias();
}

function ctMoverNicho(i, d) {
  const lista = ctArvore.nichos.map(n => n.slug);
  [lista[i], lista[i + d]] = [lista[i + d], lista[i]];
  ctOrdem({ nichos: lista });
}

function ctMoverSub(nicho, j, d) {
  const lista = ctArvore.nichos.find(n => n.slug === nicho).categorias.map(c => c.slug);
  [lista[j], lista[j + d]] = [lista[j + d], lista[j]];
  ctOrdem({ categorias: { [nicho]: lista } });
}
