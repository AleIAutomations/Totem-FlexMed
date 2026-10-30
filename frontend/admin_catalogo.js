// =====================================================
// FlexMed Admin — Catálogo (p-produtos)
// Cadastro completo do produto: dados de vitrine (Supabase: nome, preço, fotos,
// descrição, categoria) + dados da loja (loja.py: SKU, EAN, marca, custo,
// estoque mínimo/máximo, controle de estoque, galeria). Fotos sobem do
// computador e passam pelo melhorador (fundo branco, recorte, nitidez).
// Usa utilitários de admin_metricas.js (mtGet, mtEsc, mtCard).
// =====================================================

const lojaBRL = v => v == null || v === "" || isNaN(v) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const lojaNum = v => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) && String(v ?? "").trim() !== "" ? n : null; };
const LOJA_STATUS = {
  ok: ["badge-green", "Em estoque"], baixo: ["badge-amber", "Estoque baixo"], zerado: ["badge-red", "Esgotado"],
  sem_controle: ["badge-gray", "Sem controle"],
};
const LOJA_ERROS = {
  sku_duplicado: "Já existe outro produto com esse SKU.", ean_invalido: "Código de barras inválido (confira os dígitos).",
  nome_obrigatorio: "Informe o nome do produto.", estoque_insuficiente: "Não há saldo suficiente para essa saída.",
  quantidade_invalida: "Informe uma quantidade válida.", validade_invalida: "Data de validade inválida.",
  imagem_invalida: "Arquivo de imagem inválido.", imagem_grande_demais: "Imagem maior que 15 MB.",
  supabase_error: "O Supabase recusou a operação. Tente de novo.", ean_ja_cadastrado: "Código de barras já cadastrado em outro produto.",
  lista_vazia: "Adicione pelo menos um produto.",
};
let catItens = [], catCategorias = [], catFiltro = { q: "", chip: "todos", categoria: "", limite: 60 }, catEdit = null;

async function lojaEnviar(caminho, metodo, corpo) {
  try {
    const r = await fetch(`${FLEXMED_SERVER}${caminho}`, {
      method: metodo, headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, dados: j } : { ok: false, erro: LOJA_ERROS[j.error] || j.error || `Erro ${r.status}` };
  } catch (_) { return { ok: false, erro: "Backend do totem fora do ar." }; }
}

function lojaStatus(l) {
  const [cls, txt] = LOJA_STATUS[l.status] || LOJA_STATUS.sem_controle;
  return `<span class="badge ${cls}" style="white-space:nowrap">${txt}</span>`;
}

function lojaFoto(url, cls = "lj-foto") {
  return url ? `<img class="${cls}" src="${mtEsc(url)}" alt="" loading="lazy">` : `<div class="${cls} lj-sem-foto">sem foto</div>`;
}

async function carregarCatalogo() {
  const alvo = document.getElementById("cat-painel");
  if (!alvo) return;
  const [r, arvore] = await Promise.all([mtGet("/api/estoque?limite=500"), catCategorias.length ? null : mtGet("/api/loja/taxonomia")]);
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  catItens = r.itens;
  // todas as subcategorias (inclusive vazias), agrupadas pela categoria do topo
  if (arvore) catCategorias = [...arvore.nichos.flatMap(n => n.categorias.map(c => ({ ...c, nicho_nome: n.nome }))), ...arvore.sem_nicho];
  const n = f => catItens.filter(f).length;
  alvo.innerHTML = `
    <div class="stat-row">
      ${mtCard("Produtos", catItens.length, `${n(p => p.active)} ativos no totem`)}
      ${mtCard("Sem foto", n(p => !p.imgUrl), "aparecem com ícone no totem", n(p => !p.imgUrl) ? "crimson" : "blue")}
      ${mtCard("Sem código de barras", n(p => !p.ean), `${n(p => !p.ean && p.ean_sugerido)} com EAN achado na descrição`)}
      ${mtCard("Sem custo", n(p => p.custo == null), "margem não calculada")}
    </div>
    <div class="card">
      <div class="mt-cabecalho" style="margin-bottom:12px">
        <div class="lg-filtros" id="cat-chips"></div>
        <div class="mt-cabecalho-dir">
          <select class="form-input" style="width:190px" onchange="catFiltro.categoria=this.value;catRender()">
            <option value="">Todas as categorias</option>
            ${catCategorias.map(c => `<option value="${mtEsc(c.slug)}" ${catFiltro.categoria === c.slug ? "selected" : ""}>${mtEsc(c.nome)}</option>`).join("")}
          </select>
          <input class="form-input lg-busca" placeholder="Nome, SKU, EAN ou marca…" value="${mtEsc(catFiltro.q)}" oninput="catFiltro.q=this.value;catRender()">
          ${n(p => !p.ean && p.ean_sugerido) ? `<button class="tb-btn tb-btn-ghost" style="font-size:12px" title="Preenche o código de barras dos produtos que têm o EAN escrito na descrição" onclick="catAplicarEans()">Aplicar ${n(p => !p.ean && p.ean_sugerido)} EANs da descrição</button>` : ""}
          <button class="tb-btn tb-btn-ghost lj-btn-bip" onclick="catBipar()">${LJ_ICONE_BARRAS} Bipar código</button>
          <button class="tb-btn tb-btn-ghost" onclick="catLote()">Cadastro em lote</button>
          <button class="tb-btn tb-btn-primary" onclick="catAbrir()">+ Novo produto</button>
        </div>
      </div>
      <div id="cat-tabela"></div>
    </div>`;
  catRender();
}

const CAT_CHIPS = {
  todos: ["Todos", () => true], ativos: ["Ativos", p => p.active], inativos: ["Inativos", p => !p.active],
  sem_foto: ["Sem foto", p => !p.imgUrl], sem_ean: ["Sem código de barras", p => !p.ean],
  sem_custo: ["Sem custo", p => p.custo == null], receita: ["Exige receita", p => p.receita],
  promocao: ["Em promoção", p => p.precoOriginal > p.preco],
};

function catRender() {
  const q = catFiltro.q.trim().toLowerCase();
  const lista = catItens.filter(CAT_CHIPS[catFiltro.chip][1])
    .filter(p => !catFiltro.categoria || p.categoria === catFiltro.categoria)
    .filter(p => !q || [p.nome, p.sku, p.ean, p.ean_sugerido, p.marca].some(v => (v || "").toLowerCase().includes(q)));
  document.getElementById("cat-chips").innerHTML = Object.entries(CAT_CHIPS).map(([k, [nome, f]]) =>
    `<button type="button" class="${catFiltro.chip === k ? "on" : ""}" onclick="catFiltro.chip='${k}';catFiltro.limite=60;catRender()">${nome} <small>${catItens.filter(f).length}</small></button>`).join("");
  const nomeCat = slug => (catCategorias.find(c => c.slug === slug) || {}).nome || slug || "—";
  document.getElementById("cat-tabela").innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th></th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Margem</th><th>Disponível</th><th>No totem</th><th></th></tr></thead>
      <tbody>${lista.slice(0, catFiltro.limite).map(p => `<tr>
        <td style="width:56px">${lojaFoto(p.imgUrl)}</td>
        <td><div class="td-bold lj-nome">${mtEsc(p.nome)}</div>
          <div class="lj-sub">${p.sku ? `SKU ${mtEsc(p.sku)}` : "sem SKU"} · ${p.ean ? `EAN ${mtEsc(p.ean)}` : p.ean_sugerido ? `<span title="Achado na descrição">EAN? ${mtEsc(p.ean_sugerido)}</span>` : "sem EAN"}${p.marca ? ` · ${mtEsc(p.marca)}` : ""}${p.receita ? ` · <b style="color:#b45309">receita</b>` : ""}</div></td>
        <td>${mtEsc(nomeCat(p.categoria))}</td>
        <td style="white-space:nowrap">${p.precoOriginal > p.preco ? `<s class="lj-sub">${lojaBRL(p.precoOriginal)}</s><br>` : ""}<b>${lojaBRL(p.preco)}</b></td>
        <td>${p.margem != null ? `${p.margem}%` : "—"}</td>
        <td>${p.controla ? `<b>${p.disponivel}</b> ${mtEsc(p.unidade)}<br>` : ""}${lojaStatus(p)}</td>
        <td><label class="toggle-sw"><input type="checkbox" ${p.active ? "checked" : ""} onchange="catAtivo('${mtEsc(p.id)}',this.checked)"><span class="toggle-track"></span></label></td>
        <td><button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="catAbrir('${mtEsc(p.id)}')">Editar</button></td>
      </tr>`).join("") || `<tr><td colspan="8" style="color:var(--text3)">Nenhum produto com esses filtros.</td></tr>`}</tbody>
    </table></div>
    ${lista.length > catFiltro.limite ? `<div style="text-align:center;margin-top:12px"><button class="tb-btn tb-btn-ghost" onclick="catFiltro.limite+=60;catRender()">Mostrar mais (${lista.length - catFiltro.limite} restantes)</button></div>` : ""}`;
}

async function catAplicarEans() {
  const r = await lojaEnviar("/api/estoque/em-massa", "POST", { acao: "ean_sugerido" });
  toast(r.ok ? `Código de barras preenchido em ${r.dados.alterados} produto(s)` : r.erro);
  carregarCatalogo();
}

async function catAtivo(id, ativo) {
  const r = await lojaEnviar(`/api/loja/produtos/${encodeURIComponent(id)}`, "PUT", { active: ativo });
  toast(r.ok ? (ativo ? "Produto visível no totem" : "Produto escondido do totem") : r.erro);
  const p = catItens.find(x => x.id === id);
  if (p && r.ok) p.active = ativo;
}

// ─── editor do produto ──────────────────────────────────────────────────────
async function catAbrir(id, preset = {}) {
  let base = { nome: "", marca: "", fabricante: "", fornecedor: "", categoria: catCategorias[0]?.slug || "outros", tipo: "",
    uso: "", indicacoes: [], info: "", receita: false, active: true, destaque: false, sku: "", ean: "", unidade: "un",
    preco: "", precoOriginal: "", custo: "", controla: true, minimo: "", maximo: "", local: "", imgUrl: "", galeria: [],
    estoque_inicial: "", lote: "", validade: "" };
  if (id) {
    const d = await mtGet(`/api/estoque/${encodeURIComponent(id)}`);
    if (!d) { toast("Não foi possível abrir o produto"); return; }
    const pr = d.produto || {};
    base = { ...base, ...d, uso: pr.uso || "", indicacoes: pr.indicacoes || [], info: pr.info || "", destaque: !!pr.destaque,
      tipo: pr.tipo || "", ean: d.ean || "", preco: d.preco ?? "", precoOriginal: d.precoOriginal ?? "", custo: d.custo ?? "",
      galeria: d.galeria || [], imgUrl: d.imgUrl || "" };
  }
  catEdit = { id: id || null, aba: preset.aba || "info", melhorar: true, d: { ...base, ...preset, aba: undefined } };
  let fundo = document.getElementById("cat-modal");
  if (!fundo) {
    fundo = Object.assign(document.createElement("div"), { id: "cat-modal", className: "modal-bg" });
    fundo.addEventListener("click", e => { if (e.target === fundo) catFechar(); });
    document.body.appendChild(fundo);
  }
  document.body.appendChild(fundo);   // por cima de outra janela aberta (ex.: Receber mercadoria)
  fundo.innerHTML = `<div class="modal lj-modal"><div id="cat-form"></div></div>`;
  fundo.classList.add("on");
  catForm();
}

function catFechar() {
  if (catLeitorAtivo) lojaLeitorParar(catLeitorAtivo);
  document.getElementById("cat-modal")?.classList.remove("on");
  catEdit = null;
}
function catSet(campo, valor) { catEdit.d[campo] = valor; }

function catMargem() {
  const preco = lojaNum(catEdit.d.preco), custo = lojaNum(catEdit.d.custo);
  if (!preco || custo == null) return "Informe preço e custo para ver a margem.";
  const margem = (preco - custo) / preco * 100, markup = custo ? (preco / custo - 1) * 100 : null;
  return `Margem <b style="color:${margem < 15 ? "#c81e33" : "#1b7a43"}">${margem.toFixed(1)}%</b> · lucro por unidade ${lojaBRL(preco - custo)}${markup != null ? ` · markup ${markup.toFixed(0)}%` : ""}`;
}

function catForm() {
  const { d, aba, id } = catEdit;
  const opt = (pares, atual) => pares.map(([v, t]) => `<option value="${mtEsc(v)}" ${String(v) === String(atual) ? "selected" : ""}>${mtEsc(t)}</option>`).join("");
  const campo = (rotulo, chave, extra = "", dica = "") => `<div class="form-group"><label class="form-label">${rotulo}</label>
    <input class="form-input" value="${mtEsc(d[chave] ?? "")}" oninput="catSet('${chave}',this.value)${chave === "preco" || chave === "custo" ? ";document.getElementById('cat-margem').innerHTML=catMargem()" : ""}" ${extra}>${dica ? `<span class="form-hint">${dica}</span>` : ""}</div>`;
  const abas = { info: "Informações", preco: "Preço & estoque", fotos: `Fotos (${(d.imgUrl ? 1 : 0) + d.galeria.length})`, codigos: "Códigos & fornecedor" };
  const corpo = {
    info: `
      ${campo("Nome do produto *", "nome", 'maxlength="160" placeholder="Ex.: Dipirona Monoidratada 500mg 10 comprimidos"')}
      <div class="form-row">
        <div class="form-group"><label class="form-label">Subcategoria</label><select class="form-input" onchange="catSet('categoria',this.value)">${catOpcoesCategoria(d.categoria)}</select>
          <span class="form-hint">Crie e organize em <a href="#" onclick="catFechar();goPage('categorias');return false">Loja › Categorias</a>.</span></div>
        ${campo("Tipo (subcategoria)", "tipo", 'placeholder="Ex.: Analgésico e antitérmico"')}
      </div>
      <div class="form-row">${campo("Marca", "marca")}${campo("Fabricante / laboratório", "fabricante")}</div>
      <div class="form-group"><label class="form-label">Para que serve (descrição)</label>
        <textarea class="form-input" rows="4" oninput="catSet('uso',this.value)">${mtEsc(d.uso)}</textarea></div>
      <div class="form-group"><label class="form-label">Indicações</label>
        <input class="form-input" value="${mtEsc((d.indicacoes || []).join(", "))}" placeholder="dor de cabeça, febre, cólica" oninput="catSet('indicacoes',this.value.split(',').map(s=>s.trim()).filter(Boolean))">
        <span class="form-hint">Separadas por vírgula. Ajudam a busca e o assistente por voz a achar o produto.</span></div>
      <div class="form-group"><label class="form-label">Informações adicionais</label>
        <textarea class="form-input" rows="2" oninput="catSet('info',this.value)" placeholder="Posologia, advertências, composição…">${mtEsc(d.info || "")}</textarea></div>
      <div class="lj-switches">
        <label><span class="toggle-sw"><input type="checkbox" ${d.active ? "checked" : ""} onchange="catSet('active',this.checked)"><span class="toggle-track"></span></span> Visível no totem</label>
        <label><span class="toggle-sw"><input type="checkbox" ${d.receita ? "checked" : ""} onchange="catSet('receita',this.checked)"><span class="toggle-track"></span></span> Exige receita</label>
        <label><span class="toggle-sw"><input type="checkbox" ${d.destaque ? "checked" : ""} onchange="catSet('destaque',this.checked)"><span class="toggle-track"></span></span> Destaque</label>
      </div>`,
    preco: `
      <div class="form-row">${campo("Preço de venda (R$)", "preco", 'inputmode="decimal" placeholder="12,90"')}${campo("Preço “de” (riscado)", "precoOriginal", 'inputmode="decimal" placeholder="opcional"', "Preencha para mostrar desconto no totem.")}</div>
      <div class="form-row">${campo("Custo unitário (R$)", "custo", 'inputmode="decimal" placeholder="opcional"', id ? "Entradas com custo atualizam o custo médio." : "")}
        <div class="form-group"><label class="form-label">Margem</label><div class="lj-margem" id="cat-margem">${catMargem()}</div></div></div>
      <div class="vt-secao">Estoque</div>
      <div class="lj-switches"><label><span class="toggle-sw"><input type="checkbox" ${d.controla ? "checked" : ""} onchange="catSet('controla',this.checked);catForm()"><span class="toggle-track"></span></span> Controlar estoque deste produto</label></div>
      ${d.controla ? `<div class="form-row">${campo("Estoque mínimo (alerta)", "minimo", 'type="number" min="0"', "Abaixo disso o produto entra nos alertas de reposição.")}${campo("Estoque máximo (reposição)", "maximo", 'type="number" min="0"', "A sugestão de compra completa até esse número.")}</div>
        ${id ? `<div class="lj-saldo"><div><b>${d.estoque}</b><span>em estoque</span></div><div><b>${d.reservado}</b><span>reservado em pedidos</span></div><div><b>${d.disponivel}</b><span>disponível no totem</span></div>
          <button class="tb-btn tb-btn-ghost" onclick="catFechar();goPage('estoque');setTimeout(()=>estMovimentar('${mtEsc(id)}'),400)">Movimentar estoque →</button></div>`
        : `<div class="form-row">${campo("Estoque inicial", "estoque_inicial", 'type="number" min="0" placeholder="0"')}${campo("Lote (opcional)", "lote")}</div>
          <div class="form-row"><div class="form-group"><label class="form-label">Validade do lote (opcional)</label><input class="form-input" type="date" value="${mtEsc(d.validade)}" onchange="catSet('validade',this.value)"></div>
            ${campo("Localização na loja", "local", 'placeholder="Corredor A · Prateleira 2"')}</div>`}` : ""}
      ${id || !d.controla ? campo("Localização na loja", "local", 'placeholder="Corredor A · Prateleira 2"', "Aparece no totem em “Onde encontrar”.") : ""}`,
    fotos: `
      <div class="lj-drop" id="cat-drop" ondragover="event.preventDefault();this.classList.add('on')" ondragleave="this.classList.remove('on')"
           ondrop="event.preventDefault();this.classList.remove('on');catEnviarFotos(event.dataTransfer.files)">
        <b>Arraste as fotos aqui</b> ou <label class="lj-link">escolha no computador<input type="file" accept="image/*" multiple hidden onchange="catEnviarFotos(this.files)"></label>
        <span>JPG, PNG ou WebP até 15 MB. A primeira foto vira a principal.</span>
        <label class="lj-check"><input type="checkbox" ${catEdit.melhorar ? "checked" : ""} onchange="catEdit.melhorar=this.checked"> Padronizar automaticamente (fundo branco, recorte e nitidez)</label>
      </div>
      <div class="lj-fotos" id="cat-fotos">${[d.imgUrl, ...d.galeria].filter(Boolean).map((u, i) => `
        <div class="lj-foto-item ${i === 0 ? "principal" : ""}"><img src="${mtEsc(u)}" alt="">
          ${i === 0 ? `<span class="lj-foto-tag">Principal</span>` : `<button type="button" class="lj-foto-btn" onclick="catPrincipal(${i})">Tornar principal</button>`}
          <button type="button" class="lj-foto-x" onclick="catRemoverFoto(${i})" aria-label="Remover">×</button></div>`).join("")}</div>
      <div class="form-group" style="margin-top:12px"><label class="form-label">Ou cole o link de uma imagem</label>
        <input class="form-input" placeholder="https://…" onkeydown="if(event.key==='Enter'){event.preventDefault();catAddUrl(this)}" onblur="catAddUrl(this)"></div>`,
    codigos: `
      <div class="lj-leitor-bloco">
        <div class="form-label" style="margin-bottom:6px">Código de barras</div>
        ${lojaLeitorHtml("cat-leitor", "Bipe o produto com o leitor ou digite o código e Enter")}
        <div class="lj-leitor-atual">${d.ean ? `<span class="lj-barras">${mtEsc(d.ean)}</span><b class="lj-green">✓ código registrado</b>
          <button type="button" class="ct-mini ct-mini-txt" onclick="catSet('ean','');catForm()">Remover</button>` : `<span class="lj-sub">Nenhum código ainda.</span>`}</div>
      </div>
      <div class="form-row">${campo("SKU (código interno)", "sku", 'placeholder="gerado automaticamente"', "Deixe em branco para gerar (ex.: ANA-00012).")}
        ${campo("Código de barras (EAN)", "ean", 'inputmode="numeric" maxlength="14"', d.ean_sugerido && !d.ean ? `Achamos <b>${mtEsc(d.ean_sugerido)}</b> na descrição. <a href="#" onclick="catSet('ean','${mtEsc(d.ean_sugerido)}');catForm();return false">Usar</a>` : "EAN-13, EAN-8 ou GTIN-14; o dígito verificador é conferido.")}</div>
      <div class="form-row"><div class="form-group"><label class="form-label">Unidade</label><select class="form-input" onchange="catSet('unidade',this.value)">${opt([["un", "Unidade"], ["cx", "Caixa"], ["fr", "Frasco"], ["tb", "Tubo"], ["pct", "Pacote"], ["kit", "Kit"]], d.unidade)}</select></div>
        ${campo("Fornecedor / distribuidor", "fornecedor")}</div>`,
  }[aba];
  if (catLeitorAtivo) lojaLeitorParar(catLeitorAtivo);
  document.getElementById("cat-form").innerHTML = `
    <div class="lj-modal-topo">
      <div><div class="modal-title">${id ? "Editar produto" : "Novo produto"}</div><div class="modal-sub" style="margin-bottom:0">${id ? mtEsc(d.nome) : "Cadastro completo para o totem e para o estoque"}</div></div>
      ${d.imgUrl ? `<img class="lj-modal-foto" src="${mtEsc(d.imgUrl)}" alt="">` : ""}
    </div>
    <div class="lj-abas">${Object.entries(abas).map(([k, t]) => `<button type="button" class="${aba === k ? "on" : ""}" onclick="catEdit.aba='${k}';catForm()">${t}</button>`).join("")}</div>
    <div class="lj-corpo">${corpo}</div>
    <div class="vt-erro" id="cat-erro"></div>
    <div class="modal-actions">
      ${id ? `<button class="tb-btn tb-btn-ghost" style="margin-right:auto;color:#c81e33" onclick="catExcluir()">Excluir</button>` : ""}
      <button class="tb-btn tb-btn-ghost" onclick="catFechar()">Cancelar</button>
      <button class="tb-btn tb-btn-primary" id="cat-salvar" onclick="catSalvar()">${id ? "Salvar alterações" : "Cadastrar produto"}</button>
    </div>`;
  if (aba === "codigos") catLeitorAtivo = lojaLeitorLigar("cat-leitor", catCodigoLido);
}

let catLeitorAtivo = null;

// Código lido na aba Códigos: valida, confere se já existe em outro produto e preenche
async function catCodigoLido(codigo, status) {
  const digitos = codigo.replace(/\D/g, "");
  if (!lojaEanValido(digitos)) { status("erro", `“${codigo}” não é um código de barras válido (EAN-8/13 ou GTIN-14).`); return; }
  const existente = await mtGet(`/api/estoque/codigo/${digitos}`);
  if (existente && existente.id !== catEdit.id && (existente.ean || existente.ean_sugerido) === digitos) {
    status("erro", `Esse código já está em “${existente.nome}”.`, { texto: "Abrir esse produto", acao: () => { catFechar(); catAbrir(existente.id); } });
    return;
  }
  catEdit.d.ean = digitos;
  catForm();
  lojaBipe(true);
  setTimeout(() => document.getElementById("cat-leitor-status") && lojaLeitorStatus("cat-leitor", "ok", `Código ${digitos} registrado. Salve o produto para gravar.`), 0);
}

function catOpcoesCategoria(atual) {
  const grupos = {};
  catCategorias.forEach(c => (grupos[c.nicho_nome || "Sem categoria"] = grupos[c.nicho_nome || "Sem categoria"] || []).push(c));
  return Object.entries(grupos).map(([g, cs]) => `<optgroup label="${mtEsc(g)}">${cs.map(c =>
    `<option value="${mtEsc(c.slug)}" ${c.slug === atual ? "selected" : ""}>${mtEsc(c.nome)}</option>`).join("")}</optgroup>`).join("");
}

async function catEnviarFotos(arquivos) {
  const lista = [...arquivos].filter(a => a.type.startsWith("image/"));
  if (!lista.length) return;
  const drop = document.getElementById("cat-drop");
  for (const [i, arq] of lista.entries()) {
    if (drop) drop.querySelector("b").textContent = `Enviando ${i + 1} de ${lista.length}…`;
    const fd = new FormData();
    fd.append("file", arq);
    try {
      const r = await fetch(`${FLEXMED_SERVER}/api/loja/imagem?melhorar=${catEdit.melhorar ? 1 : 0}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { toast(LOJA_ERROS[j.error] || "Falha ao enviar a foto"); continue; }
      if (!catEdit.d.imgUrl) catEdit.d.imgUrl = j.url; else catEdit.d.galeria.push(j.url);
    } catch (_) { toast("Falha ao enviar a foto"); }
  }
  catForm();
}

function catFotos() { return [catEdit.d.imgUrl, ...catEdit.d.galeria].filter(Boolean); }
function catGravarFotos(lista) { catEdit.d.imgUrl = lista[0] || ""; catEdit.d.galeria = lista.slice(1); catForm(); }
function catPrincipal(i) { const l = catFotos(); l.unshift(l.splice(i, 1)[0]); catGravarFotos(l); }
function catRemoverFoto(i) { const l = catFotos(); l.splice(i, 1); catGravarFotos(l); }
function catAddUrl(input) {
  const u = input.value.trim();
  if (!/^https?:\/\//.test(u)) return;
  input.value = "";
  catGravarFotos([...catFotos(), u]);
}

async function catSalvar() {
  const { d, id } = catEdit;
  const erro = document.getElementById("cat-erro");
  if (!d.nome.trim()) { erro.textContent = "Informe o nome do produto."; catEdit.aba = "info"; return; }
  const preco = lojaNum(d.preco);
  const corpo = {
    nome: d.nome.trim(), categoria: d.categoria, tipo: d.tipo || d.categoria, uso: d.uso, indicacoes: d.indicacoes,
    info: d.info, receita: d.receita, active: d.active, destaque: d.destaque, local: d.local,
    locaisDisponiveis: d.local ? [d.local] : [], imgUrl: d.imgUrl,
    precoValor: preco, preco: preco != null ? lojaBRL(preco) : "", precoOriginal: lojaNum(d.precoOriginal),
    sku: d.sku, ean: d.ean, marca: d.marca, fabricante: d.fabricante, fornecedor: d.fornecedor, unidade: d.unidade,
    custo: lojaNum(d.custo), controla_estoque: d.controla, galeria: d.galeria,
    estoque_minimo: d.minimo === "" ? undefined : d.minimo, estoque_maximo: d.maximo === "" ? undefined : d.maximo,
    usuario: typeof currentUser !== "undefined" ? currentUser : "",
  };
  if (!id) Object.assign(corpo, { estoque_inicial: Number(d.estoque_inicial) || 0, lote: d.lote, validade: d.validade || null });
  const botao = document.getElementById("cat-salvar");
  botao.disabled = true;
  const r = await lojaEnviar(id ? `/api/loja/produtos/${encodeURIComponent(id)}` : "/api/loja/produtos", id ? "PUT" : "POST", corpo);
  botao.disabled = false;
  if (!r.ok) { erro.textContent = r.erro; return; }
  catFechar();
  toast(id ? "Produto atualizado" : `Produto cadastrado · SKU ${r.dados.sku}`);
  carregarCatalogo();
}

async function catExcluir() {
  const { d, id } = catEdit;
  if (!confirm(`Excluir “${d.nome}” do catálogo? O histórico de movimentações é mantido.`)) return;
  const r = await lojaEnviar(`/api/loja/produtos/${encodeURIComponent(id)}`, "DELETE");
  if (!r.ok) { document.getElementById("cat-erro").textContent = r.erro; return; }
  catFechar();
  toast("Produto excluído");
  carregarCatalogo();
}


// ─── leitor de código de barras (leitor USB/Bluetooth ou câmera) ─────────────
// Leitores comuns funcionam como teclado: digitam o código e dão Enter. Com
// câmera, usa o BarcodeDetector do navegador (Chrome/Edge/Android) quando existe.
const LJ_ICONE_BARRAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="width:16px;height:16px"><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14M8 5v14M19 5v14" stroke-width="1.2"/></svg>`;

function lojaEanValido(ean) {
  if (!/^(\d{8}|\d{12,14})$/.test(ean || "")) return false;
  const d = ean.split("").map(Number), dv = d.pop();
  const soma = d.reverse().reduce((t, n, i) => t + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - soma % 10) % 10 === dv;
}

function lojaBipe(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 220;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.3));
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.3);
  } catch (_) { /* sem áudio */ }
}

function lojaLeitorHtml(id, placeholder) {
  return `<div class="lj-leitor" id="${id}">
      <span class="lj-leitor-ico">${LJ_ICONE_BARRAS.replace('style="width:16px;height:16px"', "")}</span>
      <input class="lj-leitor-input" id="${id}-input" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="${mtEsc(placeholder)}">
      <button type="button" class="lj-leitor-cam" id="${id}-cam" title="Ler com a câmera">📷 Câmera</button>
    </div>
    <video class="lj-leitor-video" id="${id}-video" muted playsinline hidden></video>
    <div class="lj-leitor-status" id="${id}-status"></div>`;
}

function lojaLeitorStatus(id, tipo, texto, botao) {
  const el = document.getElementById(`${id}-status`);
  if (!el) return;
  el.className = `lj-leitor-status lj-leitor-${tipo}`;
  el.innerHTML = mtEsc(texto) + (botao ? ` <button type="button" class="ct-mini ct-mini-txt">${mtEsc(botao.texto)}</button>` : "");
  if (botao) el.querySelector("button").onclick = botao.acao;
  if (tipo === "erro") lojaBipe(false);
}

// Liga o leitor: chama aoLer(codigo, status) a cada código; devolve o id (para parar a câmera)
function lojaLeitorLigar(id, aoLer) {
  const input = document.getElementById(`${id}-input`);
  if (!input) return null;
  const status = (tipo, texto, botao) => lojaLeitorStatus(id, tipo, texto, botao);
  setTimeout(() => input.focus(), 60);
  input.addEventListener("keydown", ev => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const codigo = input.value.trim();
    input.value = "";
    if (codigo) aoLer(codigo, status);
  });
  const cam = document.getElementById(`${id}-cam`);
  if (!("BarcodeDetector" in window)) {
    cam.title = "Este navegador não lê código pela câmera — use um leitor USB ou digite";
    cam.disabled = true;
  }
  cam.onclick = async () => {
    const video = document.getElementById(`${id}-video`);
    if (video.srcObject) { lojaLeitorParar(id); return; }
    try {
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.hidden = false;
      await video.play();
      cam.textContent = "Parar câmera";
      status("info", "Aponte o código de barras para a câmera…");
      const ler = async () => {
        if (!video.srcObject) return;
        const achados = await detector.detect(video).catch(() => []);
        if (achados.length) { lojaLeitorParar(id); aoLer(achados[0].rawValue, status); return; }
        setTimeout(ler, 250);
      };
      ler();
    } catch (_) { status("erro", "Não foi possível abrir a câmera."); }
  };
  return id;
}

function lojaLeitorParar(id) {
  const video = document.getElementById(`${id}-video`);
  if (video && video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; video.hidden = true; }
  const cam = document.getElementById(`${id}-cam`);
  if (cam && !cam.disabled) cam.textContent = "📷 Câmera";
}

function lojaModal(id, largura = 620) {
  let fundo = document.getElementById(id);
  if (!fundo) {
    fundo = Object.assign(document.createElement("div"), { id, className: "modal-bg" });
    fundo.addEventListener("click", e => { if (e.target === fundo) lojaFecharModal(id); });
    document.body.appendChild(fundo);
  }
  fundo.innerHTML = `<div class="modal lj-modal" style="max-width:${largura}px"><div id="${id}-corpo"></div></div>`;
  fundo.classList.add("on");
  return document.getElementById(`${id}-corpo`);
}

function lojaFecharModal(id) {
  const fundo = document.getElementById(id);
  if (!fundo) return;
  fundo.querySelectorAll("video").forEach(v => v.srcObject && v.srcObject.getTracks().forEach(t => t.stop()));
  fundo.classList.remove("on");
}

// ─── Bipar no catálogo: acha o produto ou começa o cadastro com o código ─────
function catBipar() {
  const corpo = lojaModal("cat-bip", 640);
  corpo.innerHTML = `<div class="modal-title">Bipar produto</div>
    <div class="modal-sub">Encontre um produto pelo código de barras ou SKU, ou cadastre um novo com o código já preenchido.</div>
    ${lojaLeitorHtml("bip-leitor", "Bipe o código de barras…")}
    <div id="bip-resultado"></div>
    <div class="modal-actions"><button class="tb-btn tb-btn-ghost" onclick="lojaFecharModal('cat-bip')">Fechar</button></div>`;
  lojaLeitorLigar("bip-leitor", async (codigo, status) => {
    const p = await mtGet(`/api/estoque/codigo/${encodeURIComponent(codigo)}`);
    const alvo = document.getElementById("bip-resultado");
    if (p) {
      lojaBipe(true);
      status("ok", `Encontrado: ${p.nome}`);
      alvo.innerHTML = `<div class="lj-bip-card">${lojaFoto(p.imgUrl)}<div><b>${mtEsc(p.nome)}</b>
        <span>${mtEsc(p.sku || "sem SKU")} · ${lojaBRL(p.preco)} · ${p.controla ? `${p.disponivel} disponível(is)` : "sem controle de estoque"}</span></div>
        <button class="tb-btn tb-btn-primary" onclick="lojaFecharModal('cat-bip');catAbrir('${mtEsc(p.id)}')">Abrir</button>
        <button class="tb-btn tb-btn-ghost" onclick="lojaFecharModal('cat-bip');goPage('estoque');setTimeout(()=>estMovimentar('${mtEsc(p.id)}'),400)">Movimentar</button></div>`;
    } else {
      const digitos = codigo.replace(/\D/g, "");
      const valido = lojaEanValido(digitos);
      status(valido ? "info" : "erro", valido ? `Código ${digitos} não cadastrado.` : `“${codigo}” não é um código de barras válido.`);
      alvo.innerHTML = valido ? `<button class="tb-btn tb-btn-primary" onclick="lojaFecharModal('cat-bip');catAbrir(null,{ean:'${digitos}'})">Cadastrar produto com este código</button>` : "";
    }
  });
}

// ─── Cadastro em lote: vários produtos de uma vez (bipando, digitando ou colando planilha) ─
let catLinhas = [];
const CAT_COLUNAS = [["ean", "Código de barras", 150], ["nome", "Nome do produto *", 260], ["categoria", "Subcategoria", 170],
  ["preco", "Preço", 80], ["custo", "Custo", 80], ["estoque_inicial", "Estoque", 70], ["lote", "Lote", 90], ["validade", "Validade", 130]];

function catLote() {
  catLinhas = [{}, {}, {}];
  const corpo = lojaModal("cat-lote", 1180);
  corpo.innerHTML = `<div class="modal-title">Cadastro em lote</div>
    <div class="modal-sub">Bipe os produtos um atrás do outro (cada bipe cria uma linha), digite direto na grade ou cole linhas copiadas do Excel. Linhas sem nome são ignoradas.</div>
    ${lojaLeitorHtml("lote-leitor", "Bipe para adicionar uma linha com o código…")}
    <details class="lj-colar"><summary>Colar do Excel / planilha</summary>
      <textarea class="form-input" id="lote-colar" rows="4" placeholder="Colunas nesta ordem: código de barras · nome · subcategoria · preço · custo · estoque · lote · validade (AAAA-MM-DD)"></textarea>
      <button class="tb-btn tb-btn-ghost" style="font-size:12px;margin-top:6px" onclick="catColar()">Adicionar linhas coladas</button></details>
    <div class="tbl-wrap lj-grade-lote" id="lote-grade"></div>
    <button class="ct-add" onclick="catLinhas.push({});catGrade()">+ Linha</button>
    <div class="vt-erro" id="lote-erro"></div>
    <div class="modal-actions"><button class="tb-btn tb-btn-ghost" onclick="lojaFecharModal('cat-lote')">Cancelar</button>
      <button class="tb-btn tb-btn-primary" id="lote-salvar" onclick="catSalvarLote()">Cadastrar produtos</button></div>`;
  catGrade();
  lojaLeitorLigar("lote-leitor", async (codigo, status) => {
    const digitos = codigo.replace(/\D/g, "");
    if (!lojaEanValido(digitos)) { status("erro", `“${codigo}” não é um código de barras válido.`); return; }
    if (catLinhas.some(l => l.ean === digitos)) { status("erro", `O código ${digitos} já está na grade.`); return; }
    const existe = await mtGet(`/api/estoque/codigo/${digitos}`);
    if (existe && (existe.ean || existe.ean_sugerido) === digitos) { status("erro", `Já cadastrado: ${existe.nome}.`); return; }
    const vazia = catLinhas.find(l => !l.ean && !l.nome);
    if (vazia) vazia.ean = digitos; else catLinhas.push({ ean: digitos });
    lojaBipe(true);
    status("ok", `Linha criada para ${digitos}. Preencha o nome.`);
    catGrade();
    const i = catLinhas.findIndex(l => l.ean === digitos);
    setTimeout(() => document.querySelector(`#lote-grade [data-l="${i}"][data-c="nome"]`)?.focus(), 30);
  });
}

function catGrade() {
  const padrao = catCategorias[0]?.slug || "outros";
  document.getElementById("lote-grade").innerHTML = `<table><thead><tr><th>#</th>${CAT_COLUNAS.map(([, t]) => `<th>${t}</th>`).join("")}<th></th></tr></thead>
    <tbody>${catLinhas.map((l, i) => `<tr class="${l.erro ? "lj-linha-erro" : l.ok ? "lj-linha-ok" : ""}"><td>${i + 1}</td>${CAT_COLUNAS.map(([c, , w]) => `<td>${
      c === "categoria" ? `<select class="form-input" data-l="${i}" data-c="${c}" style="width:${w}px" onchange="catLinhas[${i}].categoria=this.value">${catOpcoesCategoria(l.categoria || padrao)}</select>`
      : `<input class="form-input" data-l="${i}" data-c="${c}" style="width:${w}px" ${c === "validade" ? 'type="date"' : ""} value="${mtEsc(l[c] || "")}" oninput="catLinhas[${i}]['${c}']=this.value">`}</td>`).join("")}
      <td>${l.erro ? `<span class="lj-red" title="${mtEsc(l.erro)}">⚠ ${mtEsc(LOJA_ERROS[l.erro] || l.erro)}</span>` : ""}<button class="lj-foto-x" style="position:static" onclick="catLinhas.splice(${i},1);catGrade()">×</button></td></tr>`).join("")}</tbody></table>`;
}

function catColar() {
  const texto = document.getElementById("lote-colar").value.trim();
  if (!texto) return;
  const porNome = Object.fromEntries(catCategorias.map(c => [c.nome.toLowerCase(), c.slug]));
  texto.split(/\r?\n/).forEach(linha => {
    const cols = linha.split(linha.includes("\t") ? "\t" : ";").map(c => c.trim());
    if (!cols.some(Boolean) || /nome/i.test(cols[1] || "") && /c[óo]digo|ean/i.test(cols[0] || "")) return;   // cabeçalho
    const [ean, nome, categoria, preco, custo, estoque_inicial, lote, validade] = cols;
    catLinhas.push({ ean: (ean || "").replace(/\D/g, ""), nome, categoria: porNome[(categoria || "").toLowerCase()] || categoria || "",
                     preco, custo, estoque_inicial, lote, validade });
  });
  catLinhas = catLinhas.filter(l => l.nome || l.ean);
  document.getElementById("lote-colar").value = "";
  catGrade();
}

async function catSalvarLote() {
  const padrao = catCategorias[0]?.slug || "outros";
  const itens = catLinhas.map((l, i) => ({ ...l, i, categoria: l.categoria || padrao })).filter(l => (l.nome || "").trim());
  const erro = document.getElementById("lote-erro");
  if (!itens.length) { erro.textContent = "Preencha o nome de pelo menos um produto."; return; }
  const ruins = itens.filter(l => l.ean && !lojaEanValido(l.ean));
  if (ruins.length) { erro.textContent = `Código de barras inválido na(s) linha(s) ${ruins.map(l => l.i + 1).join(", ")}.`; return; }
  const botao = document.getElementById("lote-salvar");
  botao.disabled = true; botao.textContent = `Cadastrando ${itens.length}…`;
  const r = await lojaEnviar("/api/loja/produtos/lote", "POST", {
    itens: itens.map(({ i, erro, ok, ...l }) => l), usuario: typeof currentUser !== "undefined" ? currentUser || "" : "" });
  botao.disabled = false; botao.textContent = "Cadastrar produtos";
  if (!r.ok) { erro.textContent = r.erro; return; }
  r.dados.resultados.forEach((res, k) => { const l = catLinhas[itens[k].i]; if (res.ok) l.ok = true; else l.erro = res.erro; });
  catLinhas = catLinhas.filter(l => !l.ok && (l.nome || l.ean));   // sobram só as linhas com erro
  toast(`${r.dados.criados} produto(s) cadastrado(s)`);
  if (!catLinhas.length) { lojaFecharModal("cat-lote"); carregarCatalogo(); return; }
  erro.textContent = `${catLinhas.length} linha(s) não foram cadastradas — veja o aviso em cada uma.`;
  catGrade();
  carregarCatalogo();
}
