// =====================================================
// FlexMed Admin — Logs (p-logs)
// Linha do tempo de tudo o que o totem registrou (sessões, toques, presença,
// anúncios e pessoas que passaram), lida do Supabase pelo backend
// (GET /api/logs) e o estado do envio (GET /api/nuvem/status).
// Usa os utilitários de admin_metricas.js (mtGet, mtEsc, mtSeg, MT_FAIXAS...).
// =====================================================

const LG_TIPOS = {
  todos: "Tudo", sessoes: "Sessões", eventos: "Toques e telas", presenca: "Presença",
  anuncios: "Anúncios", audiencia: "Pessoas na câmera",
};
const LG_CORES = { sessoes: "blue", eventos: "gray", presenca: "green", anuncios: "amber", audiencia: "purple" };
const lgFiltro = { dias: 1, tipo: "todos", busca: "" };
let lgDados = null, lgTimer = null;

async function carregarLogs() {
  const alvo = document.getElementById("logs-painel");
  if (!alvo) return;
  if (!alvo.querySelector("#lg-tabela")) {
    alvo.innerHTML = `
      <div class="card" id="lg-nuvem"><div class="mt-vazio">Verificando o Supabase…</div></div>
      <div class="mt-cabecalho" style="margin-top:20px">
        <div class="lg-filtros" id="lg-tipos"></div>
        <div class="mt-cabecalho-dir">
          <input class="form-input lg-busca" id="lg-busca" placeholder="Buscar nos logs…" oninput="lgFiltro.busca=this.value;lgRenderTabela()" />
          <span id="lg-periodo"></span>
          <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="lgExportar()">Exportar CSV</button>
        </div>
      </div>
      <div class="card"><div id="lg-tabela"><div class="mt-vazio">Carregando…</div></div></div>`;
  }
  clearInterval(lgTimer);
  lgTimer = setInterval(() => {
    if (!document.getElementById("p-logs").classList.contains("on")) { clearInterval(lgTimer); return; }
    if (document.getElementById("logs-painel").hidden) return;   // outra aba da Atividade aberta
    lgAtualizar();
  }, 10000);
  await lgAtualizar();
}

async function lgAtualizar() {
  const [nuvem, logs] = await Promise.all([
    mtGet("/api/nuvem/status"),
    mtGet(`/api/logs?dias=${lgFiltro.dias}&tipo=${lgFiltro.tipo === "todos" ? "todos" : lgFiltro.tipo}&limite=1000`),
  ]);
  lgRenderNuvem(nuvem);
  lgDados = logs;
  document.getElementById("lg-periodo").innerHTML = [[1, "Hoje"], [7, "7 dias"], [30, "30 dias"]].map(([d, t]) =>
    `<button type="button" class="${lgFiltro.dias === d ? "on" : ""}" onclick="lgFiltro.dias=${d};lgAtualizar()">${t}</button>`).join("");
  document.getElementById("lg-periodo").className = "mt-periodo";
  const cont = logs?.contagem || {};
  document.getElementById("lg-tipos").innerHTML = Object.entries(LG_TIPOS).map(([t, nome]) =>
    `<button type="button" class="${lgFiltro.tipo === t ? "on" : ""}" onclick="lgFiltro.tipo='${t}';lgAtualizar()">
      ${mtEsc(nome)}${t !== "todos" && cont[t] != null ? ` <small>${cont[t]}</small>` : ""}</button>`).join("");
  lgRenderTabela();
}

function lgRenderNuvem(n) {
  const el = document.getElementById("lg-nuvem");
  if (!el) return;
  if (!n) { el.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  const pend = Object.values(n.pendentes || {}).reduce((a, b) => a + b, 0);
  const enviados = Object.values(n.enviados_desde_inicio || {}).reduce((a, b) => a + b, 0);
  const ha = t => t ? `há ${mtSeg(Date.now() / 1000 - t)}` : "nunca";
  let estado, selo;
  if (!n.configurado) {
    selo = `<span class="badge badge-amber">Não configurado</span>`;
    estado = "Defina SUPABASE_URL e SUPABASE_SERVICE_KEY no backend/.env. Enquanto isso, tudo fica guardado no totem.";
  } else if (n.tabelas_ok === false) {
    selo = `<span class="badge badge-amber">Falta criar as tabelas</span>`;
    estado = `Rode o arquivo <b>backend/supabase/metricas.sql</b> no SQL Editor do Supabase (uma vez). Os dados estão guardados no totem e serão enviados assim que as tabelas existirem.`;
  } else if (n.erro) {
    selo = `<span class="badge badge-red">Sem conexão</span>`;
    estado = `Último erro: ${mtEsc(n.erro)}. Os dados ficam no totem e são reenviados automaticamente.`;
  } else {
    selo = `<span class="badge badge-green">Sincronizado</span>`;
    estado = `Envio automático a cada ${n.intervalo_s} s para as tabelas <code>totem_*</code> do Supabase.`;
  }
  el.innerHTML = `
    <div class="card-head"><div><div class="card-title">Envio para o Supabase</div>
      <div class="card-sub">Totem <b>${mtEsc(n.totem_id)}</b> · ${estado}</div></div>
      <div class="mt-cabecalho-dir">${selo}
        <button class="tb-btn tb-btn-ghost" style="font-size:12px" id="lg-enviar" onclick="lgSincronizar()" ${n.configurado ? "" : "disabled"}>Enviar agora</button></div></div>
    <div class="mt-modelo">
      <div><b>${ha(n.ultimo_envio)}</b><span>último envio com sucesso</span></div>
      <div><b>${pend}</b><span>registros aguardando envio</span></div>
      <div><b>${enviados}</b><span>enviados desde que o backend ligou</span></div>
    </div>`;
}

async function lgSincronizar() {
  const b = document.getElementById("lg-enviar");
  if (b) { b.disabled = true; b.textContent = "Enviando…"; }
  try {
    const r = await fetch(`${FLEXMED_SERVER}/api/nuvem/sincronizar`, { method: "POST" });
    const j = await r.json();
    if (typeof toast === "function") {
      toast(j.ok ? `Enviado: ${Object.values(j.enviados || {}).reduce((a, b) => a + b, 0)} registro(s)` : "Falha ao enviar para o Supabase");
    }
  } catch (_) { /* backend fora: o card mostra */ }
  await lgAtualizar();
}

// Texto de cada registro: [o que aconteceu, detalhes]
function lgDescrever(i) {
  const faixa = f => f ? (MT_FAIXAS[f] || f) : "faixa não identificada";
  switch (i.categoria) {
    case "sessoes": {
      const origem = ({ anuncio: "veio de um anúncio", aproximacao: "acordou por aproximação" })[i.origem] || "começou com um toque";
      return [`Sessão de ${mtSeg(i.duracao_s)} (${origem})`,
        `${i.cliques} toques · ${i.produtos_vistos} produtos · ${i.adicionados} na lista · ${faixa(i.faixa)} · ` +
        (i.finalizou ? "finalizou o pedido" : `saiu em ${i.ultima_tela || "início"} (${i.saida || "inatividade"})`)];
    }
    case "eventos":
      return [`${MT_EVENTOS[i.tipo] || i.tipo}${i.alvo ? `: ${i.alvo}` : ""}`,
        `tela ${i.tela || "—"} · sessão ${String(i.sessao_id).slice(0, 8)}`];
    case "presenca":
      return i.tipo === "acordou"
        ? [`Totem acordou — pessoa a ~${i.distancia_cm ?? "?"} cm`,
           `${i.detalhe?.olhando ?? 0} olhando · ${i.detalhe?.pessoas ?? 0} na câmera${i.detalhe?.faixa ? ` · ${faixa(i.detalhe.faixa)}` : ""}`]
        : ["Voltou aos anúncios", "ninguém na frente da câmera nem tocando a tela"];
    case "anuncios":
      return [`Anúncio “${i.campanha_nome || `#${i.campaign_id}`}” exibido`,
        `${i.motivo === "segmentado" ? `escolhido para ${faixa(i.faixa_alvo)}` : "rotação normal"} · ${mtSeg(i.duracao_s)} · ` +
        `${i.espectadores} espectador(es) · atenção ${mtSeg(i.atencao_s)}${i.interagiu ? " · tocaram a tela" : ""}`];
    case "audiencia":
      return [`Pessoa ${i.olhou ? "olhou a tela" : "passou sem olhar"} — ${faixa(i.faixa)}`,
        `${i.confianca != null ? `${Math.round(i.confianca * 100)}% de confiança · ` : ""}${i.idade != null ? `~${i.idade} anos · ` : ""}` +
        `olhou ${mtSeg(i.atencao_s)} de ${mtSeg(i.fim - i.inicio)} · ${i.contexto === "uso" ? "durante o uso" : "nos anúncios"}`];
  }
  return [i.categoria, ""];
}

function lgItensFiltrados() {
  const busca = lgFiltro.busca.trim().toLowerCase();
  return (lgDados?.itens || []).map(i => ({ ...i, _txt: lgDescrever(i) }))
    .filter(i => !busca || i._txt.join(" ").toLowerCase().includes(busca));
}

function lgRenderTabela() {
  const el = document.getElementById("lg-tabela");
  if (!el) return;
  if (!lgDados) { el.innerHTML = `<div class="mt-vazio">Não foi possível carregar os logs.</div>`; return; }
  const itens = lgItensFiltrados();
  el.innerHTML = `
    <div class="card-head"><div><div class="card-title">Registros</div>
      <div class="card-sub">${itens.length} registro(s) · mais recentes primeiro</div></div>${mtFonte(lgDados.fonte)}</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Quando</th><th>Tipo</th><th>O que aconteceu</th><th>Detalhes</th></tr></thead>
      <tbody>${itens.length ? itens.slice(0, 500).map(i => `<tr>
        <td style="white-space:nowrap">${new Date(i.ts * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}</td>
        <td><span class="badge badge-${LG_CORES[i.categoria] || "gray"}" style="white-space:nowrap">${mtEsc(LG_TIPOS[i.categoria] || i.categoria)}</span></td>
        <td class="td-bold">${mtEsc(i._txt[0])}</td>
        <td style="color:var(--text3);font-size:12.5px">${mtEsc(i._txt[1])}</td>
      </tr>`).join("") : `<tr><td colspan="4" style="color:var(--text3)">Nenhum registro no período.</td></tr>`}</tbody>
    </table></div>`;
}

function lgExportar() {
  const itens = lgItensFiltrados();
  const cel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["quando", "tipo", "o_que_aconteceu", "detalhes"].join(";"),
    ...itens.map(i => [new Date(i.ts * 1000).toLocaleString("pt-BR"), LG_TIPOS[i.categoria], i._txt[0], i._txt[1]].map(cel).join(";"))];
  const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `flexmed-logs-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
