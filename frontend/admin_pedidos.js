// =====================================================
// FlexMed Admin — Pedidos (p-pedidos) e avisos da loja na barra lateral
// O cliente finaliza a lista no totem e recebe um código; o balcão acompanha
// aqui: Novo → Separando → Pronto → Entregue (a entrega baixa o estoque).
// iniciarAvisosLoja(): a cada 15 s atualiza os contadores da barra lateral e
// avisa (som + toast) quando chega pedido novo.
// Usa admin_metricas.js (mtGet, mtEsc, mtCard, mtSeg) e admin_catalogo.js (lojaBRL, lojaEnviar).
// =====================================================

const PED_COLUNAS = [
  { status: "novo", nome: "Novos", acao: ["separando", "Começar a separar"] },
  { status: "separando", nome: "Separando", acao: ["pronto", "Pronto para retirar"] },
  { status: "pronto", nome: "Prontos para retirar", acao: ["entregue", "Entregue ao cliente"] },
];
let pedTimer = null, pedUltimo = null, pedHistorico = false;

async function carregarPedidos() {
  const alvo = document.getElementById("ped-painel");
  if (!alvo) return;
  const r = await mtGet("/api/pedidos?dias=1");
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const deHoje = r.itens.filter(p => p.criado * 1000 >= hoje.getTime());
  const entregues = deHoje.filter(p => p.status === "entregue");
  const faturamento = entregues.reduce((t, p) => t + (p.total || 0), 0);
  const tempos = entregues.filter(p => p.entregue_em).map(p => p.entregue_em - p.criado);
  const abertos = r.itens.filter(p => ["novo", "separando", "pronto"].includes(p.status));
  const fechados = r.itens.filter(p => !["novo", "separando", "pronto"].includes(p.status));
  alvo.innerHTML = `
    <div class="stat-row">
      ${mtCard("Pedidos hoje", deHoje.length, `${abertos.length} em aberto agora`)}
      ${mtCard("Entregues hoje", entregues.length, `${deHoje.filter(p => p.status === "cancelado").length} cancelados`, "emerald")}
      ${mtCard("Faturamento hoje", lojaBRL(faturamento), entregues.length ? `ticket médio ${lojaBRL(faturamento / entregues.length)}` : "pedidos entregues")}
      ${mtCard("Tempo até a entrega", tempos.length ? mtSeg(tempos.reduce((a, b) => a + b, 0) / tempos.length) : "—", "média de hoje")}
    </div>
    <div class="ped-quadro">${PED_COLUNAS.map(c => {
      const lista = abertos.filter(p => p.status === c.status).sort((a, b) => a.criado - b.criado);
      return `<div class="ped-coluna ped-col-${c.status}">
        <div class="ped-coluna-topo"><b>${c.nome}</b><span>${lista.length}</span></div>
        ${lista.map(p => pedCartao(p, c)).join("") || `<div class="ped-vazio">Nenhum pedido</div>`}
      </div>`;
    }).join("")}</div>
    <div class="card" style="margin-top:20px">
      <div class="card-head"><div><div class="card-title">Concluídos (últimas 24 h)</div><div class="card-sub">${fechados.length} pedido(s)</div></div>
        <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="pedHistorico=!pedHistorico;carregarPedidos()">${pedHistorico ? "Esconder" : "Mostrar"}</button></div>
      ${pedHistorico ? `<div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Feito em</th><th>Itens</th><th>Total</th><th>Situação</th></tr></thead>
        <tbody>${fechados.map(p => `<tr><td class="td-bold">${mtEsc(p.codigo)}</td>
          <td>${new Date(p.criado * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
          <td>${p.lista.map(i => `${i.qtd}× ${mtEsc(i.nome)}`).join("<br>")}</td><td>${lojaBRL(p.total)}</td>
          <td>${p.status === "entregue" ? `<span class="badge badge-green">Entregue${p.entregue_em ? ` às ${new Date(p.entregue_em * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>` : `<span class="badge badge-gray">Cancelado</span>`}</td></tr>`).join("")
          || `<tr><td colspan="5" style="color:var(--text3)">Nenhum.</td></tr>`}</tbody></table></div>` : ""}
    </div>`;
  clearInterval(pedTimer);
  pedTimer = setInterval(() => {
    if (!document.getElementById("p-pedidos").classList.contains("on")) { clearInterval(pedTimer); return; }
    if (!document.querySelector("#ped-painel textarea:focus")) carregarPedidos();
  }, 6000);
}

function pedCartao(p, coluna) {
  const espera = Date.now() / 1000 - p.criado;
  const faltas = p.lista.filter(i => i.faltou).length;
  return `<div class="ped-cartao ${espera > 600 && p.status === "novo" ? "ped-atrasado" : ""}">
    <div class="ped-cartao-topo"><span class="ped-codigo">${mtEsc(p.codigo)}</span>
      <span class="ped-tempo" title="${new Date(p.criado * 1000).toLocaleString("pt-BR")}">há ${mtSeg(espera)}</span></div>
    <div class="ped-itens">${p.lista.map(i => `<div class="ped-item ${i.faltou ? "ped-falta" : ""}">
      ${i.imgUrl ? `<img src="${mtEsc(i.imgUrl)}" alt="">` : `<i></i>`}
      <div><b>${i.qtd}× ${mtEsc(i.nome)}</b><span>${[i.sku, i.local].filter(Boolean).map(mtEsc).join(" · ")}${i.faltou ? " · <em>sem saldo suficiente</em>" : ""}</span></div>
    </div>`).join("")}</div>
    ${faltas ? `<div class="pedido-aviso">${faltas} item(ns) sem saldo no momento do pedido — confirme na prateleira.</div>` : ""}
    <textarea class="form-input ped-obs" rows="1" placeholder="Observação (opcional)" onchange="pedObs('${mtEsc(p.id)}',this.value)">${mtEsc(p.observacao || "")}</textarea>
    <div class="ped-cartao-rodape"><b>${lojaBRL(p.total)}</b>
      <div><button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="pedStatus('${mtEsc(p.id)}','cancelado','${mtEsc(p.codigo)}')">Cancelar</button>
        <button class="tb-btn tb-btn-primary" style="font-size:12px" onclick="pedStatus('${mtEsc(p.id)}','${coluna.acao[0]}')">${coluna.acao[1]}</button></div></div>
  </div>`;
}

async function pedStatus(id, status, codigo) {
  if (status === "cancelado" && !confirm(`Cancelar o pedido ${codigo}? A reserva do estoque é liberada.`)) return;
  const r = await lojaEnviar(`/api/pedidos/${encodeURIComponent(id)}`, "PATCH", {
    status, usuario: typeof currentUser !== "undefined" ? currentUser || "" : "",
  });
  if (!r.ok) { toast(r.erro); return; }
  toast(status === "entregue" ? `Pedido ${r.dados.codigo} entregue — estoque baixado` : status === "cancelado" ? "Pedido cancelado" : `Pedido ${r.dados.codigo} atualizado`);
  carregarPedidos();
  atualizarAvisosLoja();
}

async function pedObs(id, texto) {
  await lojaEnviar(`/api/pedidos/${encodeURIComponent(id)}`, "PATCH", { observacao: texto });
}

// ─── avisos na barra lateral (todas as páginas) ─────────────────────────────
function pedBipe() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.17);
    });
  } catch (_) { /* navegador sem áudio liberado */ }
}

async function atualizarAvisosLoja() {
  const c = await mtGet("/api/pedidos/contagem");
  if (!c) return;
  const badge = (id, n) => { const el = document.getElementById(id); if (el) { el.textContent = n; el.hidden = !n; } };
  badge("sb-pedidos", c.novos || 0);
  badge("sb-estoque", c.alertas_estoque || 0);
  if (pedUltimo !== null && c.ultimo && c.ultimo > pedUltimo && c.novos) {
    pedBipe();
    toast("🛍️ Novo pedido no totem!");
    if (document.getElementById("p-pedidos").classList.contains("on")) carregarPedidos();
  }
  pedUltimo = c.ultimo || 0;
}

let pedAvisosTimer = null;
function iniciarAvisosLoja() {
  clearInterval(pedAvisosTimer);
  atualizarAvisosLoja();
  pedAvisosTimer = setInterval(atualizarAvisosLoja, 15000);
}
