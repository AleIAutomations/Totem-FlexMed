// =====================================================
// FlexMed Admin — Estoque (p-estoque)
// Abas: Visão geral (indicadores, alertas e regras) · Produtos (saldo, ações em
// massa, planilha) · Movimentações · Lotes & validade · Reposição (sugestão de
// compra, curva ABC e estoque parado). Toda alteração de saldo passa por uma
// movimentação (backend/loja.py), que fica no histórico.
// Usa admin_metricas.js (mtGet, mtEsc, mtCard, mtSeg) e admin_catalogo.js (lojaBRL, lojaEnviar...).
// =====================================================

const EST_TIPOS = {
  entrada: { nome: "Entrada", desc: "Compra ou recebimento de mercadoria", sinal: "+" },
  saida: { nome: "Saída", desc: "Uso interno, transferência ou venda fora do totem", sinal: "−" },
  perda: { nome: "Perda", desc: "Vencido, avariado ou extraviado", sinal: "−" },
  devolucao: { nome: "Devolução", desc: "Cliente devolveu o produto", sinal: "+" },
  ajuste: { nome: "Contagem", desc: "Informe a quantidade contada na prateleira", sinal: "=" },
};
const EST_ROTULO_MOV = { ...Object.fromEntries(Object.entries(EST_TIPOS).map(([k, v]) => [k, v.nome])), venda: "Venda", ajuste: "Ajuste" };
let estAba = "geral", estFiltro = { filtro: "controlados", q: "", ordem: "nome" }, estSelecionados = new Set();
let estMovFiltro = { dias: 30, tipo: "", q: "" }, estMov = null;

async function carregarEstoque() {
  const alvo = document.getElementById("est-painel");
  if (!alvo) return;
  const abas = { geral: "Visão geral", produtos: "Produtos", movimentos: "Movimentações", lotes: "Lotes & validade", reposicao: "Reposição" };
  alvo.innerHTML = `
    <div class="lj-abas lj-abas-pagina est-topo">${Object.entries(abas).map(([k, t]) =>
      `<button type="button" class="${estAba === k ? "on" : ""}" onclick="estAba='${k}';carregarEstoque()">${t}</button>`).join("")}
      <span class="est-topo-acoes"><button class="tb-btn tb-btn-ghost lj-btn-bip" onclick="catBipar()">${LJ_ICONE_BARRAS} Bipar</button>
        <button class="tb-btn tb-btn-primary" onclick="estReceber()">Receber mercadoria</button></span></div>
    <div id="est-conteudo"><div class="mt-vazio">Carregando…</div></div>`;
  ({ geral: estGeral, produtos: estProdutos, movimentos: estMovimentos, lotes: estLotes, reposicao: estReposicao })[estAba]();
}

const estConteudo = html => { const el = document.getElementById("est-conteudo"); if (el) el.innerHTML = html; };

// ─── Visão geral ────────────────────────────────────────────────────────────
async function estGeral() {
  const [r, alertas] = await Promise.all([mtGet("/api/estoque/resumo"), mtGet("/api/estoque?filtro=alerta&ordem=disponivel&limite=40")]);
  if (!r) return estConteudo(`<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`);
  const cfg = r.config, abertos = Object.values(r.pedidos_abertos).reduce((a, b) => a + b, 0);
  estConteudo(`
    <div class="stat-row">
      ${mtCard("Produtos controlados", r.controlados, `de ${r.produtos} no catálogo · ${r.unidades} unidades`)}
      ${mtCard("Valor em estoque", lojaBRL(r.valor_custo), `a preço de venda: ${lojaBRL(r.valor_venda)}${r.sem_custo ? ` · ${r.sem_custo} sem custo` : ""}`)}
      ${mtCard("Precisam de atenção", r.zerado + r.baixo + r.vencidos, `${r.zerado} esgotados · ${r.baixo} baixos · ${r.vencidos} vencidos`, r.zerado + r.baixo + r.vencidos ? "crimson" : "emerald")}
      ${mtCard("Vendas hoje", lojaBRL(r.vendas_hoje.valor), `${r.vendas_hoje.pedidos} pedidos entregues · ${abertos} em aberto`, "emerald")}
    </div>
    <div class="grid-2 vt-grid">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Alertas de estoque</div>
          <div class="card-sub">Esgotados, abaixo do mínimo e lotes vencidos ou vencendo em até ${cfg.dias_alerta_validade} dias</div></div>
          <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="estAba='reposicao';carregarEstoque()">Ver reposição</button></div>
        ${alertas && alertas.itens.length ? `<div class="lj-alertas">${alertas.itens.map(l => `
          <div class="lj-alerta lj-alerta-${l.status === "zerado" || l.vencido ? "red" : "amber"}">
            ${lojaFoto(l.imgUrl)}
            <div class="lj-alerta-info"><b>${mtEsc(l.nome)}</b>
              <span>${[l.status === "zerado" ? "Esgotado" : l.status === "baixo" ? `Só ${l.disponivel} disponível(is) — mínimo ${l.minimo}` : "",
                l.vencido ? `Lote vencido (${estData(l.validade_proxima)})` : l.vencendo ? `Lote vence em ${estData(l.validade_proxima)}` : ""].filter(Boolean).join(" · ")}</span></div>
            <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="estMovimentar('${mtEsc(l.id)}','${l.vencido ? "perda" : "entrada"}')">${l.vencido ? "Baixar perda" : "Dar entrada"}</button>
          </div>`).join("")}</div>` : `<div class="mt-vazio">Nenhum alerta. Tudo em ordem. ✅</div>`}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Regras do estoque</div><div class="card-sub">Valem para o totem e para os alertas</div></div></div>
        <div class="pr-regras">
          <div class="pr-regra"><div><div class="pr-regra-t">Esconder esgotados no totem</div><div class="pr-regra-s">Desligado: aparecem com o selo “Esgotado” e não podem ser pedidos</div></div>
            <label class="toggle-sw"><input type="checkbox" ${cfg.ocultar_esgotados ? "checked" : ""} onchange="estConfig({ocultar_esgotados:this.checked})"><span class="toggle-track"></span></label></div>
          <div class="pr-regra"><div><div class="pr-regra-t">Avisar validade com antecedência de</div><div class="pr-regra-s">Lotes que vencem dentro desse prazo entram nos alertas</div></div>
            <select class="form-input" style="width:120px" onchange="estConfig({dias_alerta_validade:Number(this.value)})">${[15, 30, 60, 90, 120, 180].map(n => `<option value="${n}" ${cfg.dias_alerta_validade === n ? "selected" : ""}>${n} dias</option>`).join("")}</select></div>
          <div class="pr-regra"><div><div class="pr-regra-t">Mínimo e máximo padrão</div><div class="pr-regra-s">Usados quando um produto passa a ser controlado</div></div>
            <div style="display:flex;gap:6px;align-items:center"><input class="form-input" style="width:70px" type="number" min="0" value="${cfg.estoque_minimo_padrao}" onchange="estConfig({estoque_minimo_padrao:Number(this.value)})">
              <span class="lj-sub">a</span><input class="form-input" style="width:70px" type="number" min="1" value="${cfg.estoque_maximo_padrao}" onchange="estConfig({estoque_maximo_padrao:Number(this.value)})"></div></div>
        </div>
        <div class="lj-resumo-linhas">
          <div><span>Sugestões de compra</span><b>${r.repor}</b></div>
          <div><span>Lotes vencendo</span><b>${r.vencendo}</b></div>
          <div><span>Controlados sem código de barras</span><b>${r.sem_ean}</b></div>
          <div><span>Movimentações hoje</span><b>${r.movimentos_hoje}</b></div>
        </div>
      </div>
    </div>`);
}

async function estConfig(mudanca) {
  const r = await lojaEnviar("/api/loja/config", "POST", mudanca);
  toast(r.ok ? "Regra salva — o totem aplica na próxima busca de produtos" : r.erro);
}

const estData = iso => iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "—";

// ─── Produtos ───────────────────────────────────────────────────────────────
const EST_FILTROS = { controlados: "Controlados", baixo: "Estoque baixo", zerado: "Esgotados", vencendo: "Validade", repor: "Repor",
                      sem_controle: "Sem controle", todos: "Todos" };

async function estProdutos() {
  const r = await mtGet(`/api/estoque?filtro=${estFiltro.filtro}&ordem=${estFiltro.ordem}&q=${encodeURIComponent(estFiltro.q)}&limite=500`);
  if (!r) return estConteudo(`<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`);
  estSelecionados = new Set([...estSelecionados].filter(id => r.itens.some(l => l.id === id)));
  estConteudo(`
    <div class="card">
      <div class="mt-cabecalho" style="margin-bottom:12px">
        <div class="lg-filtros">${Object.entries(EST_FILTROS).map(([k, t]) => `<button type="button" class="${estFiltro.filtro === k ? "on" : ""}" onclick="estFiltro.filtro='${k}';estProdutos()">${t}</button>`).join("")}</div>
        <div class="mt-cabecalho-dir">
          <select class="form-input" style="width:160px" onchange="estFiltro.ordem=this.value;estProdutos()">${[["nome", "Nome"], ["disponivel", "Menor saldo"], ["validade", "Validade"], ["vendas", "Mais vendidos"], ["sku", "SKU"]].map(([v, t]) => `<option value="${v}" ${estFiltro.ordem === v ? "selected" : ""}>${t}</option>`).join("")}</select>
          <input class="form-input lg-busca" placeholder="Nome, SKU ou EAN…" value="${mtEsc(estFiltro.q)}" onchange="estFiltro.q=this.value;estProdutos()">
          <a class="tb-btn tb-btn-ghost" style="font-size:12px" href="${FLEXMED_SERVER}/api/estoque/exportar.csv">Exportar planilha</a>
          <label class="tb-btn tb-btn-ghost" style="font-size:12px;cursor:pointer">Importar planilha<input type="file" accept=".csv,text/csv" hidden onchange="estImportar(this.files[0])"></label>
        </div>
      </div>
      <div class="lj-massa" id="est-massa"></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th><input type="checkbox" onchange="estSelTodos(this.checked)" ${r.itens.length && r.itens.every(l => estSelecionados.has(l.id)) ? "checked" : ""}></th>
          <th></th><th>Produto</th><th>Saldo</th><th>Reservado</th><th>Disponível</th><th>Mín · Máx</th><th>Validade</th><th>Vendas 30d</th><th>Situação</th><th></th></tr></thead>
        <tbody>${r.itens.map(l => `<tr>
          <td><input type="checkbox" ${estSelecionados.has(l.id) ? "checked" : ""} onchange="estSel('${mtEsc(l.id)}',this.checked)"></td>
          <td style="width:48px">${lojaFoto(l.imgUrl)}</td>
          <td><div class="td-bold lj-nome">${mtEsc(l.nome)}</div><div class="lj-sub">${l.sku ? mtEsc(l.sku) : "sem SKU"}${l.local ? ` · ${mtEsc(l.local)}` : ""}</div></td>
          <td>${l.controla ? l.estoque : "—"}</td><td>${l.reservado || "—"}</td>
          <td><b>${l.controla ? l.disponivel : "—"}</b>${l.cobertura_dias != null ? `<div class="lj-sub">~${l.cobertura_dias} dias</div>` : ""}</td>
          <td>${l.controla ? `${l.minimo} · ${l.maximo}` : "—"}</td>
          <td>${l.validade_proxima ? `<span class="${l.vencido ? "lj-red" : l.vencendo ? "lj-amber" : ""}">${estData(l.validade_proxima)}</span>` : "—"}</td>
          <td>${l.vendas_30d || "—"}</td>
          <td>${lojaStatus(l)}</td>
          <td style="white-space:nowrap"><button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="estMovimentar('${mtEsc(l.id)}')">Movimentar</button></td>
        </tr>`).join("") || `<tr><td colspan="11" style="color:var(--text3)">${estFiltro.filtro === "controlados" ? "Nenhum produto com controle de estoque ainda. Veja “Sem controle” e ative em massa." : "Nada nesse filtro."}</td></tr>`}</tbody>
      </table></div>
      <div class="mt-legenda" style="margin-top:10px">Planilha (CSV com ; ou ,): colunas <code>sku</code>, <code>ean</code> ou <code>id</code> para achar o produto e <code>estoque</code> (contagem), <code>minimo</code>, <code>maximo</code>, <code>custo</code>, <code>marca</code> para atualizar. A coluna estoque vira um ajuste de contagem no histórico.</div>
    </div>`);
  estRenderMassa();
}

function estSel(id, on) { on ? estSelecionados.add(id) : estSelecionados.delete(id); estRenderMassa(); }
function estSelTodos(on) {
  document.querySelectorAll("#est-conteudo tbody input[type=checkbox]").forEach(c => { c.checked = on; c.onchange(); });
}
function estRenderMassa() {
  const el = document.getElementById("est-massa");
  if (!el) return;
  const n = estSelecionados.size;
  el.innerHTML = n ? `<b>${n} selecionado(s)</b>
    <button class="tb-btn tb-btn-ghost" onclick="estMassa('controlar')">Controlar estoque</button>
    <button class="tb-btn tb-btn-ghost" onclick="estMassa('parar')">Parar de controlar</button>
    <button class="tb-btn tb-btn-ghost" onclick="estMassa('minimo')">Definir mínimo…</button>
    <button class="tb-btn tb-btn-ghost" onclick="estMassa('maximo')">Definir máximo…</button>` : "";
  el.classList.toggle("on", n > 0);
}

async function estMassa(acao) {
  let valor;
  if (acao === "minimo" || acao === "maximo") {
    valor = prompt(`Novo estoque ${acao} para ${estSelecionados.size} produto(s):`);
    if (valor === null || isNaN(Number(valor))) return;
  }
  const r = await lojaEnviar("/api/estoque/em-massa", "POST", { ids: [...estSelecionados], acao, valor: Number(valor) });
  toast(r.ok ? `${r.dados.alterados} produto(s) atualizados` : r.erro);
  estSelecionados.clear();
  estProdutos();
}

async function estImportar(arquivo) {
  if (!arquivo) return;
  const fd = new FormData();
  fd.append("file", arquivo);
  try {
    const r = await fetch(`${FLEXMED_SERVER}/api/estoque/importar?usuario=${encodeURIComponent(typeof currentUser !== "undefined" ? currentUser || "" : "")}`, { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) { toast("Planilha inválida"); return; }
    toast(`${j.atualizados} produto(s) atualizados${j.erros.length ? ` · ${j.erros.length} linha(s) com erro` : ""}`);
    if (j.erros.length) alert("Linhas não importadas:\n" + j.erros.join("\n"));
  } catch (_) { toast("Falha ao enviar a planilha"); }
  estProdutos();
}

// ─── Movimentações ──────────────────────────────────────────────────────────
async function estMovimentos() {
  const f = estMovFiltro;
  const r = await mtGet(`/api/estoque/movimentos?dias=${f.dias}&tipo=${f.tipo}&q=${encodeURIComponent(f.q)}`);
  if (!r) return estConteudo(`<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`);
  estConteudo(`
    <div class="card">
      <div class="mt-cabecalho" style="margin-bottom:12px">
        <div class="lg-filtros">${[["", "Todas"], ["entrada", "Entradas"], ["venda", "Vendas"], ["saida", "Saídas"], ["perda", "Perdas"], ["devolucao", "Devoluções"], ["ajuste", "Contagens"]].map(([k, t]) =>
          `<button type="button" class="${f.tipo === k ? "on" : ""}" onclick="estMovFiltro.tipo='${k}';estMovimentos()">${t}${k && r.totais[k] ? ` <small>${r.totais[k]} un</small>` : ""}</button>`).join("")}</div>
        <div class="mt-cabecalho-dir">
          <input class="form-input lg-busca" placeholder="Produto, SKU ou motivo…" value="${mtEsc(f.q)}" onchange="estMovFiltro.q=this.value;estMovimentos()">
          <div class="mt-periodo">${[[1, "Hoje"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"]].map(([d, t]) => `<button type="button" class="${f.dias === d ? "on" : ""}" onclick="estMovFiltro.dias=${d};estMovimentos()">${t}</button>`).join("")}</div>
        </div>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Quando</th><th>Tipo</th><th>Produto</th><th>Qtd</th><th>Saldo depois</th><th>Lote</th><th>Custo un.</th><th>Motivo</th><th>Quem</th></tr></thead>
        <tbody>${r.itens.map(m => `<tr>
          <td style="white-space:nowrap">${new Date(m.ts * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
          <td><span class="badge ${m.quantidade > 0 ? "badge-green" : m.quantidade < 0 ? "badge-red" : "badge-gray"}">${mtEsc(EST_ROTULO_MOV[m.tipo] || m.tipo)}</span></td>
          <td><div class="td-bold lj-nome">${mtEsc(m.nome || m.product_id)}</div><div class="lj-sub">${mtEsc(m.sku || "")}</div></td>
          <td><b class="${m.quantidade > 0 ? "lj-green" : m.quantidade < 0 ? "lj-red" : ""}">${m.quantidade > 0 ? "+" : ""}${m.quantidade}</b></td>
          <td>${m.saldo_apos}</td><td>${mtEsc(m.lote || "—")}</td><td>${m.custo_unit != null ? lojaBRL(m.custo_unit) : "—"}</td>
          <td>${mtEsc(m.motivo || "—")}</td><td>${mtEsc(m.usuario || "—")}</td>
        </tr>`).join("") || `<tr><td colspan="9" style="color:var(--text3)">Nenhuma movimentação no período.</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

// ─── Lotes & validade ───────────────────────────────────────────────────────
async function estLotes() {
  const r = await mtGet("/api/estoque/lotes");
  if (!r) return estConteudo(`<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`);
  const n = s => r.itens.filter(l => l.situacao === s).length;
  const cor = { vencido: "badge-red", vencendo: "badge-amber", ok: "badge-green", sem_validade: "badge-gray" };
  const txt = l => l.situacao === "sem_validade" ? "Sem validade" : l.dias < 0 ? `Venceu há ${-l.dias} dia(s)` : l.dias === 0 ? "Vence hoje" : `Vence em ${l.dias} dia(s)`;
  estConteudo(`
    <div class="stat-row">
      ${mtCard("Lotes com saldo", r.itens.length, "saídas e vendas consomem primeiro o que vence antes")}
      ${mtCard("Vencidos", n("vencido"), "retire da prateleira e baixe como perda", n("vencido") ? "crimson" : "blue")}
      ${mtCard(`Vencendo em ${r.dias_alerta} dias`, n("vencendo"), "priorize na vitrine e no balcão")}
      ${mtCard("Sem validade informada", n("sem_validade"), "informe na próxima entrada")}
    </div>
    <div class="card"><div class="tbl-wrap"><table>
      <thead><tr><th></th><th>Produto</th><th>Lote</th><th>Validade</th><th>Quantidade</th><th>Situação</th><th></th></tr></thead>
      <tbody>${r.itens.map(l => `<tr>
        <td style="width:48px">${lojaFoto(l.imgUrl)}</td>
        <td><div class="td-bold lj-nome">${mtEsc(l.nome || l.product_id)}</div><div class="lj-sub">${mtEsc(l.sku || "")}</div></td>
        <td>${mtEsc(l.lote || "sem lote")}</td><td>${estData(l.validade)}</td><td><b>${l.quantidade}</b></td>
        <td><span class="badge ${cor[l.situacao]}">${txt(l)}</span></td>
        <td>${l.situacao === "vencido" ? `<button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="estMovimentar('${mtEsc(l.product_id)}','perda',${JSON.stringify(l.lote || "").replace(/"/g, "&quot;")},${l.quantidade})">Baixar perda</button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="7" style="color:var(--text3)">Nenhum lote com saldo. Lotes e validades entram pelas entradas de estoque.</td></tr>`}</tbody>
    </table></div></div>`);
}

// ─── Reposição e relatórios ─────────────────────────────────────────────────
async function estReposicao() {
  const [rep, rel] = await Promise.all([mtGet("/api/estoque?filtro=repor&ordem=disponivel&limite=500"), mtGet("/api/estoque/relatorio?dias=90")]);
  if (!rep || !rel) return estConteudo(`<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`);
  const custoTotal = rep.itens.reduce((t, l) => t + l.sugestao_compra * (l.custo || 0), 0);
  window.estListaCompra = rep.itens;
  estConteudo(`
    <div class="card">
      <div class="card-head"><div><div class="card-title">Sugestão de compra</div>
        <div class="card-sub">Produtos no mínimo ou abaixo dele; a quantidade completa até o estoque máximo${custoTotal ? ` · custo estimado ${lojaBRL(custoTotal)}` : ""}</div></div>
        ${rep.itens.length ? `<button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="estExportarCompra()">Baixar lista de compra</button>` : ""}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th></th><th>Produto</th><th>Fornecedor</th><th>Disponível</th><th>Mín · Máx</th><th>Vendas 30d</th><th>Comprar</th><th>Custo estimado</th><th></th></tr></thead>
        <tbody>${rep.itens.map(l => `<tr>
          <td style="width:48px">${lojaFoto(l.imgUrl)}</td>
          <td><div class="td-bold lj-nome">${mtEsc(l.nome)}</div><div class="lj-sub">${mtEsc(l.sku || "")}${l.ean ? ` · ${mtEsc(l.ean)}` : ""}</div></td>
          <td>${mtEsc(l.fornecedor || "—")}</td><td><b class="${l.disponivel <= 0 ? "lj-red" : "lj-amber"}">${l.disponivel}</b></td>
          <td>${l.minimo} · ${l.maximo}</td><td>${l.vendas_30d || "—"}</td><td><b>${l.sugestao_compra}</b> ${mtEsc(l.unidade)}</td>
          <td>${l.custo ? lojaBRL(l.custo * l.sugestao_compra) : "—"}</td>
          <td><button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="estMovimentar('${mtEsc(l.id)}','entrada','',${l.sugestao_compra})">Receber</button></td>
        </tr>`).join("") || `<tr><td colspan="9" style="color:var(--text3)">Nenhum produto precisa de reposição agora.</td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="grid-2" style="margin-top:20px">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Curva ABC (90 dias)</div>
          <div class="card-sub">Faturamento dos pedidos entregues: ${lojaBRL(rel.faturamento)} · A = 80% do faturamento</div></div></div>
        ${rel.curva.length ? `<div class="lj-abc">${["A", "B", "C"].map(c => `<div class="lj-abc-${c}"><b>${rel.classes[c] || 0}</b><span>classe ${c}</span></div>`).join("")}</div>
          ${mtBarras(rel.curva.slice(0, 12).map(c => ({ rotulo: `${c.classe} · ${c.nome}`, valor: c.qtd, pct: c.participacao, cor: { A: "#1b6b4e", B: "#b45309", C: "#64748b" }[c.classe] })), " un")}`
          : `<div class="mt-vazio">Sem vendas entregues no período.</div>`}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Estoque parado</div><div class="card-sub">Com saldo e nenhuma venda em 90 dias (maior valor primeiro)</div></div></div>
        ${rel.parados.length ? mtBarras(rel.parados.map(p => ({ rotulo: p.nome, valor: p.estoque, cor: "#94a3b8" })), " un")
          : `<div class="mt-vazio">Nenhum produto parado.</div>`}
      </div>
    </div>`);
}

function estExportarCompra() {
  const cel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["sku", "ean", "produto", "fornecedor", "disponivel", "comprar", "custo_unit", "custo_total"].join(";"),
    ...(window.estListaCompra || []).map(l => [l.sku, l.ean, l.nome, l.fornecedor, l.disponivel, l.sugestao_compra,
      l.custo ?? "", l.custo ? (l.custo * l.sugestao_compra).toFixed(2) : ""].map(cel).join(";"))];
  const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: `flexmed-compra-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Movimentar (janela) ────────────────────────────────────────────────────
async function estMovimentar(id, tipo = "entrada", lote = "", quantidade = "") {
  const d = await mtGet(`/api/estoque/${encodeURIComponent(id)}`);
  if (!d) { toast("Não foi possível abrir o produto"); return; }
  estMov = { d, tipo, lote, quantidade, validade: "", custo: "", motivo: "" };
  let fundo = document.getElementById("est-modal");
  if (!fundo) {
    fundo = Object.assign(document.createElement("div"), { id: "est-modal", className: "modal-bg" });
    fundo.addEventListener("click", e => { if (e.target === fundo) estFecharMov(); });
    document.body.appendChild(fundo);
  }
  fundo.innerHTML = `<div class="modal lj-modal"><div id="est-form"></div></div>`;
  fundo.classList.add("on");
  estFormMov();
}

function estFecharMov() { document.getElementById("est-modal")?.classList.remove("on"); estMov = null; }

function estPrevia() {
  const { d, tipo } = estMov, q = Number(estMov.quantidade) || 0;
  const novo = tipo === "ajuste" ? q : d.estoque + (EST_TIPOS[tipo].sinal === "+" ? q : -q);
  return { novo, ok: novo >= 0 && (tipo === "ajuste" || q > 0) };
}

function estFormMov() {
  const { d, tipo } = estMov;
  const p = estPrevia();
  document.getElementById("est-form").innerHTML = `
    <div class="lj-modal-topo"><div><div class="modal-title">Movimentar estoque</div>
      <div class="modal-sub" style="margin-bottom:0">${mtEsc(d.nome)} · ${mtEsc(d.sku || "")}</div></div>${d.imgUrl ? `<img class="lj-modal-foto" src="${mtEsc(d.imgUrl)}" alt="">` : ""}</div>
    ${d.controla ? "" : `<div class="pedido-aviso">Este produto ainda não tem controle de estoque. Ao salvar, o controle é ligado.</div>`}
    <div class="lj-saldo"><div><b>${d.estoque}</b><span>saldo atual</span></div><div><b>${d.reservado}</b><span>reservado</span></div>
      <div><b class="${p.ok ? "" : "lj-red"}">${p.novo}</b><span>saldo depois</span></div></div>
    <div class="vt-tipos lj-tipos">${Object.entries(EST_TIPOS).map(([k, t]) => `<button type="button" class="${tipo === k ? "on" : ""}" onclick="estMov.tipo='${k}';estFormMov()"><b>${t.sinal} ${t.nome}</b><span>${t.desc}</span></button>`).join("")}</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${tipo === "ajuste" ? "Quantidade contada" : "Quantidade"}</label>
        <input class="form-input" type="number" min="0" value="${mtEsc(estMov.quantidade)}" oninput="estMov.quantidade=this.value;estAtualizarPrevia()" autofocus></div>
      <div class="form-group"><label class="form-label">Lote ${tipo === "entrada" ? "(opcional)" : "(opcional — senão, sai o que vence primeiro)"}</label>
        ${tipo === "entrada" || tipo === "devolucao" ? `<input class="form-input" value="${mtEsc(estMov.lote)}" oninput="estMov.lote=this.value">`
          : `<select class="form-input" onchange="estMov.lote=this.value"><option value="">Automático (vence primeiro)</option>${d.lotes.map(l => `<option value="${mtEsc(l.lote)}" ${l.lote === estMov.lote ? "selected" : ""}>${mtEsc(l.lote || "sem lote")} · ${l.quantidade} un${l.validade ? ` · vence ${estData(l.validade)}` : ""}</option>`).join("")}</select>`}</div>
    </div>
    ${tipo === "entrada" ? `<div class="form-row">
      <div class="form-group"><label class="form-label">Validade (opcional)</label><input class="form-input" type="date" value="${mtEsc(estMov.validade)}" onchange="estMov.validade=this.value"></div>
      <div class="form-group"><label class="form-label">Custo unitário (opcional)</label><input class="form-input" inputmode="decimal" placeholder="${d.custo != null ? `atual ${lojaBRL(d.custo)}` : "R$"}" value="${mtEsc(estMov.custo)}" oninput="estMov.custo=this.value"></div></div>` : ""}
    <div class="form-group"><label class="form-label">Motivo / observação</label>
      <input class="form-input" value="${mtEsc(estMov.motivo)}" placeholder="${{ entrada: "NF 12345 — Distribuidora X", saida: "Transferência para a loja 2", perda: "Embalagem avariada", devolucao: "Cliente devolveu fechado", ajuste: "Inventário mensal" }[tipo]}" oninput="estMov.motivo=this.value"></div>
    ${d.movimentos.length ? `<div class="vt-secao">Últimas movimentações</div><div class="lj-mini-hist">${d.movimentos.slice(0, 6).map(m =>
      `<div><span>${new Date(m.ts * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span><span>${mtEsc(EST_ROTULO_MOV[m.tipo] || m.tipo)}</span><b class="${m.quantidade > 0 ? "lj-green" : "lj-red"}">${m.quantidade > 0 ? "+" : ""}${m.quantidade}</b><span>→ ${m.saldo_apos}</span><em>${mtEsc(m.motivo || "")}</em></div>`).join("")}</div>` : ""}
    <div class="vt-erro" id="est-erro"></div>
    <div class="modal-actions">
      <button class="tb-btn tb-btn-ghost" onclick="estFecharMov()">Cancelar</button>
      <button class="tb-btn tb-btn-primary" id="est-salvar" onclick="estSalvarMov()">Registrar ${EST_TIPOS[tipo].nome.toLowerCase()}</button>
    </div>`;
}

function estAtualizarPrevia() {
  const p = estPrevia(), alvo = document.querySelectorAll("#est-form .lj-saldo b")[2];
  if (alvo) { alvo.textContent = p.novo; alvo.className = p.ok ? "" : "lj-red"; }
}

async function estSalvarMov() {
  const { d, tipo } = estMov;
  const erro = document.getElementById("est-erro");
  if (!estPrevia().ok) { erro.textContent = estPrevia().novo < 0 ? "A saída é maior que o saldo." : "Informe a quantidade."; return; }
  document.getElementById("est-salvar").disabled = true;
  const r = await lojaEnviar(`/api/estoque/${encodeURIComponent(d.id)}/movimentos`, "POST", {
    tipo, quantidade: Number(estMov.quantidade), lote: estMov.lote, validade: estMov.validade || null,
    custo_unit: estMov.custo || null, motivo: estMov.motivo, usuario: typeof currentUser !== "undefined" ? currentUser || "" : "",
  });
  if (!r.ok) { erro.textContent = r.erro; document.getElementById("est-salvar").disabled = false; return; }
  estFecharMov();
  toast(`${EST_TIPOS[tipo].nome} registrada · saldo ${r.dados.saldo}`);
  if (document.getElementById("p-estoque").classList.contains("on")) carregarEstoque();
  atualizarAvisosLoja();
}


// ─── Receber mercadoria (entrada em lote, ex.: uma nota fiscal inteira) ──────
let estReceb = [];

function estReceber() {
  estReceb = [];
  const corpo = lojaModal("est-receber", 1080);
  corpo.innerHTML = `<div class="modal-title">Receber mercadoria</div>
    <div class="modal-sub">Bipe cada produto que chegou — bipar de novo soma +1. Ajuste quantidade, lote, validade e custo e confirme tudo de uma vez.</div>
    <div class="form-row"><div class="form-group"><label class="form-label">Nota fiscal / fornecedor (opcional)</label>
      <input class="form-input" id="rec-motivo" placeholder="NF 12345 — Distribuidora X"></div>
      <div class="form-group"><label class="form-label">Mesma validade para todos (opcional)</label>
      <input class="form-input" type="date" id="rec-validade" onchange="estReceb.forEach(l=>{if(!l.validade)l.validade=this.value});estRecGrade()"></div></div>
    ${lojaLeitorHtml("rec-leitor", "Bipe o produto recebido…")}
    <div id="rec-grade"></div>
    <div class="vt-erro" id="rec-erro"></div>
    <div class="modal-actions"><button class="tb-btn tb-btn-ghost" onclick="lojaFecharModal('est-receber')">Cancelar</button>
      <button class="tb-btn tb-btn-primary" id="rec-salvar" onclick="estRecSalvar()">Confirmar entrada</button></div>`;
  estRecGrade();
  lojaLeitorLigar("rec-leitor", async (codigo, status) => {
    const existente = estReceb.find(l => l.codigo === codigo || l.ean === codigo.replace(/\D/g, "") || (l.sku || "").toUpperCase() === codigo.toUpperCase());
    if (existente && existente.id) {
      existente.quantidade = Number(existente.quantidade || 0) + 1;
      lojaBipe(true);
      status("ok", `+1 ${existente.nome} (total ${existente.quantidade})`);
      estRecGrade();
      return;
    }
    const p = await mtGet(`/api/estoque/codigo/${encodeURIComponent(codigo)}`);
    if (!p) {
      status("erro", `Código ${codigo} não cadastrado.`, { texto: "Cadastrar agora", acao: () => catAbrir(null, { ean: codigo.replace(/\D/g, ""), aba: "info" }) });
      return;
    }
    lojaBipe(true);
    estReceb.unshift({ id: p.id, nome: p.nome, imgUrl: p.imgUrl, sku: p.sku, ean: p.ean || p.ean_sugerido, codigo,
                       saldo: p.estoque, quantidade: 1, lote: "", validade: document.getElementById("rec-validade").value || "",
                       custo_unit: p.custo != null ? String(p.custo).replace(".", ",") : "" });
    status("ok", `${p.nome} adicionado.`);
    estRecGrade();
  });
}

function estRecGrade() {
  const el = document.getElementById("rec-grade");
  if (!el) return;
  const total = estReceb.reduce((t, l) => t + (Number(l.quantidade) || 0), 0);
  const custo = estReceb.reduce((t, l) => t + (Number(l.quantidade) || 0) * (lojaNum(l.custo_unit) || 0), 0);
  el.innerHTML = estReceb.length ? `<div class="tbl-wrap"><table><thead><tr><th></th><th>Produto</th><th>Saldo atual</th><th>Quantidade</th><th>Lote</th><th>Validade</th><th>Custo unit.</th><th></th></tr></thead>
    <tbody>${estReceb.map((l, i) => `<tr><td style="width:48px">${lojaFoto(l.imgUrl)}</td>
      <td><div class="td-bold lj-nome">${mtEsc(l.nome)}</div><div class="lj-sub">${mtEsc(l.sku || "")}${l.ean ? ` · ${mtEsc(l.ean)}` : ""}</div></td>
      <td>${l.saldo}</td>
      <td><div class="lj-qtd"><button onclick="estReceb[${i}].quantidade=Math.max(1,(+estReceb[${i}].quantidade||1)-1);estRecGrade()">−</button>
        <input class="form-input" type="number" min="1" value="${l.quantidade}" oninput="estReceb[${i}].quantidade=this.value" onchange="estRecGrade()">
        <button onclick="estReceb[${i}].quantidade=(+estReceb[${i}].quantidade||0)+1;estRecGrade()">+</button></div></td>
      <td><input class="form-input" style="width:100px" value="${mtEsc(l.lote)}" oninput="estReceb[${i}].lote=this.value"></td>
      <td><input class="form-input" style="width:140px" type="date" value="${mtEsc(l.validade)}" onchange="estReceb[${i}].validade=this.value"></td>
      <td><input class="form-input" style="width:90px" inputmode="decimal" value="${mtEsc(l.custo_unit)}" oninput="estReceb[${i}].custo_unit=this.value" onchange="estRecGrade()"></td>
      <td><button class="lj-foto-x" style="position:static" onclick="estReceb.splice(${i},1);estRecGrade()">×</button></td></tr>`).join("")}</tbody></table></div>
    <div class="lj-saldo" style="margin-top:10px"><div><b>${estReceb.length}</b><span>produtos</span></div><div><b>${total}</b><span>unidades</span></div>${custo ? `<div><b>${lojaBRL(custo)}</b><span>custo total</span></div>` : ""}</div>`
    : `<div class="mt-vazio">Nenhum produto ainda — bipe o primeiro.</div>`;
}

async function estRecSalvar() {
  const erro = document.getElementById("rec-erro");
  if (!estReceb.length) { erro.textContent = "Bipe pelo menos um produto."; return; }
  if (estReceb.some(l => !(Number(l.quantidade) > 0))) { erro.textContent = "Todas as quantidades precisam ser maiores que zero."; return; }
  const botao = document.getElementById("rec-salvar");
  botao.disabled = true;
  const r = await lojaEnviar("/api/estoque/entrada-lote", "POST", {
    motivo: document.getElementById("rec-motivo").value || "Recebimento de mercadoria",
    usuario: typeof currentUser !== "undefined" ? currentUser || "" : "",
    itens: estReceb.map(l => ({ id: l.id, quantidade: Number(l.quantidade), lote: l.lote, validade: l.validade || null, custo_unit: l.custo_unit || null })),
  });
  botao.disabled = false;
  if (!r.ok) { erro.textContent = r.erro; return; }
  lojaFecharModal("est-receber");
  toast(`Entrada registrada: ${r.dados.unidades} unidade(s) de ${r.dados.itens.length} produto(s)`);
  if (document.getElementById("p-estoque").classList.contains("on")) carregarEstoque();
  atualizarAvisosLoja();
}
