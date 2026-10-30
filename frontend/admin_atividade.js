// =====================================================
// FlexMed Admin — Atividade (p-logs), em Marketing
// Abas:
//   Comportamento  mapa de calor dos toques, regiões, toques sem resposta, tempo
//                  por tela, funil por produto (apareceu → abriu → pôs na lista),
//                  rolagem e o que cada faixa etária abre
//   Sessões        "replay" de cada cliente: linha do tempo com tempos e mapa dos toques
//   Registros      linha do tempo bruta e envio ao Supabase (admin_logs.js)
// Dados: GET /api/relatorios/comportamento e /api/sessoes/<id> (backend/comportamento.py).
// Usa admin_metricas.js (mtGet, mtEsc, mtCard, mtSeg, mtBarras, mtFonte, MT_FAIXAS, MT_EVENTOS).
// =====================================================

let atvAba = "comportamento", atvFiltro = { dias: 7, faixa: "", tela: "inicio", soMortos: false, ordem: "aberturas" }, atvDados = null;
const ATV_REGIOES = {
  produtos: "Grade de produtos", nichos: "Nichos", categorias: "Categorias", busca: "Busca", banner: "Banner do topo",
  vitrine: "Vitrine (blocos)", menu: "Menu inferior", cabecalho: "Cabeçalho", produto: "Página do produto",
  produto_comprar: "Botão de comprar", carrinho: "Carrinho", assistente: "Assistente", libras: "Libras",
  avaliacao: "Avaliação", qr: "QR code", outro: "Outras áreas",
};
const ATV_ORDENS = {
  aberturas: ["Mais abertos", (a, b) => b.aberturas - a.aberturas || b.impressoes - a.impressoes],
  tempo: ["Mais tempo olhando", (a, b) => (b.tempo_total_s || 0) - (a.tempo_total_s || 0)],
  taxa: ["Maior taxa de abertura", (a, b) => (b.taxa_abertura ?? -1) - (a.taxa_abertura ?? -1)],
  ignorados: ["Apareceram e ninguém abriu", (a, b) => b.impressoes - a.impressoes, p => p.impressoes > 0 && !p.aberturas],
  sem_compra: ["Abriram e não puseram na lista", (a, b) => b.aberturas - a.aberturas, p => p.aberturas > 0 && !p.adicionados],
};

function carregarAtividade() {
  const abas = { comportamento: "Comportamento", sessoes: "Sessões", registros: "Registros" };
  document.getElementById("atv-abas").innerHTML = Object.entries(abas).map(([k, t]) =>
    `<button type="button" class="${atvAba === k ? "on" : ""}" onclick="atvAba='${k}';carregarAtividade()">${t}</button>`).join("");
  document.getElementById("atv-comportamento").hidden = atvAba !== "comportamento";
  document.getElementById("atv-sessoes").hidden = atvAba !== "sessoes";
  document.getElementById("logs-painel").hidden = atvAba !== "registros";
  if (atvAba === "comportamento") atvComportamento();
  else if (atvAba === "sessoes") atvSessoes();
  else carregarLogs();
}

// ─── Comportamento ──────────────────────────────────────────────────────────
async function atvComportamento() {
  const alvo = document.getElementById("atv-comportamento");
  if (!atvDados) alvo.innerHTML = `<div class="mt-vazio">Carregando…</div>`;
  const r = await mtGet(`/api/relatorios/comportamento?dias=${atvFiltro.dias}&faixa=${encodeURIComponent(atvFiltro.faixa)}`);
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  atvDados = r;
  const s = r.resumo;
  const telasComToque = [...new Set(r.toques.pontos.map(p => p.tela))];
  if (!telasComToque.includes(atvFiltro.tela)) atvFiltro.tela = telasComToque[0] || "inicio";
  alvo.innerHTML = `
    <div class="mt-cabecalho">
      <div class="mt-legenda">Como as pessoas usam a tela: onde tocam, quanto tempo ficam e olham cada tela (pela câmera) e quais produtos veem, abrem e põem na lista. Tudo anônimo: só posições de toque e tempos.</div>
      <div class="mt-cabecalho-dir">${mtFonte(r.fonte)}
        <select class="form-input" style="width:170px" onchange="atvFiltro.faixa=this.value;atvComportamento()">
          <option value="">Todas as idades</option>${MT_SEGMENTADAS.map(f => `<option value="${f}" ${atvFiltro.faixa === f ? "selected" : ""}>${mtEsc(MT_FAIXAS[f])}</option>`).join("")}</select>
        <div class="mt-periodo">${[[1, "Hoje"], [7, "7 dias"], [30, "30 dias"]].map(([d, t]) => `<button type="button" class="${atvFiltro.dias === d ? "on" : ""}" onclick="atvFiltro.dias=${d};atvComportamento()">${t}</button>`).join("")}</div>
      </div>
    </div>
    <div class="stat-row">
      ${mtCard("Sessões", s.sessoes, `duração média ${mtSeg(s.tempo_medio_sessao_s)} · olhando ${mtSeg(s.olhando_medio_sessao_s)}`)}
      ${mtCard("Toques", s.toques, s.toques ? `${Math.round(s.toques_sem_resposta / s.toques * 100)}% sem resposta (tocou onde não havia botão)` : "—", s.toques && s.toques_sem_resposta / s.toques > 0.15 ? "crimson" : "blue")}
      ${mtCard("Produtos vistos na tela", s.produtos_na_tela, `${s.produtos_abertos} abertos · taxa de abertura ${s.taxa_abertura}%`)}
      ${mtCard("Rolagem média", `${s.rolagem_media_linhas} linhas`, "até onde a lista de produtos foi rolada")}
    </div>
    <div class="grid-2 atv-grid">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Mapa de toques</div><div class="card-sub">Onde o dedo tocou na tela do totem</div></div></div>
        <div class="lg-filtros" style="margin-bottom:10px">${(telasComToque.length ? telasComToque : ["inicio"]).map(t => `<button type="button" class="${atvFiltro.tela === t ? "on" : ""}" onclick="atvFiltro.tela='${mtEsc(t)}';atvMapa()">${mtEsc(({ inicio: "Início", produto: "Produto", carrinho: "Carrinho", libras: "Libras", avaliacao: "Avaliação", qr: "QR" })[t] || t)} <small>${r.toques.pontos.filter(p => p.tela === t).length}</small></button>`).join("")}</div>
        <label class="lj-check" style="margin-bottom:10px"><input type="checkbox" ${atvFiltro.soMortos ? "checked" : ""} onchange="atvFiltro.soMortos=this.checked;atvMapa()"> Só toques sem resposta (onde as pessoas tentam tocar e nada acontece)</label>
        <div class="atv-mapa-wrap"><canvas id="atv-mapa" width="360" height="640"></canvas></div>
        <div class="atv-escala"><span>poucos toques</span><i></i><span>muitos</span></div>
      </div>
      <div class="atv-coluna">
        <div class="card">
          <div class="card-head"><div><div class="card-title">Regiões mais tocadas</div><div class="card-sub">Em vermelho, a parte dos toques que não acertou nada</div></div></div>
          ${r.toques.por_regiao.length ? `<div class="mt-barras">${r.toques.por_regiao.map(g => `
            <div class="mt-barra"><div class="mt-barra-topo"><span>${mtEsc(ATV_REGIOES[g.regiao] || g.regiao)}</span><b>${g.toques} · ${g.pct}%${g.sem_resposta ? ` <em class="lj-red">(${g.sem_resposta} sem resposta)</em>` : ""}</b></div>
              <div class="mt-barra-trilho atv-trilho"><div style="width:${g.pct}%;background:var(--blue)"></div><div style="width:${g.sem_resposta / Math.max(s.toques, 1) * 100}%;background:#e5243b"></div></div></div>`).join("")}</div>`
            : `<div class="mt-vazio">Sem toques no período.</div>`}
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">O que mais tocam</div><div class="card-sub">Botões, chips e cards</div></div></div>
          ${mtBarras(r.toques.mais_tocados.map(a => ({ rotulo: `${a.alvo}  ·  ${ATV_REGIOES[a.regiao] || a.regiao}`, valor: a.toques })), " toques")}
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Tempo por tela</div><div class="card-sub">Quanto tempo ficam em cada tela e quanto disso estão olhando (câmera)</div></div></div>
        ${r.telas.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tela</th><th>Visitas</th><th>Tempo médio</th><th>Tempo total</th><th>Olhando</th></tr></thead>
          <tbody>${r.telas.map(t => `<tr><td class="td-bold">${mtEsc(t.nome)}</td><td>${t.visitas}</td><td>${mtSeg(t.tempo_medio_s)}</td><td>${mtSeg(t.tempo_total_s)}</td>
            <td><div class="atv-olhar"><div style="width:${t.olhando_pct}%"></div></div>${t.olhando_pct}%</td></tr>`).join("")}</tbody></table></div>`
          : `<div class="mt-vazio">Sem dados no período.</div>`}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Até onde rolam a lista</div><div class="card-sub">Linha de produtos mais funda alcançada em cada sessão</div></div></div>
        ${r.rolagem.some(b => b.sessoes) ? mtBarras(r.rolagem.map(b => ({ rotulo: b.faixa, valor: b.sessoes, cor: "#1b8a8f" })), " sessões")
          : `<div class="mt-vazio">Sem dados no período.</div>`}
        <div class="mt-legenda" style="margin-top:10px">Use para posicionar a Vitrine: blocos depois de linhas que pouca gente alcança quase não são vistos.</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Produtos: viram, abriram, puseram na lista</div>
        <div class="card-sub">“Na tela” = apareceu por ~1 s na grade · taxa de abertura = aberturas ÷ vezes na tela · tempo = página do produto aberta</div></div>
        <select class="form-input" style="width:240px" onchange="atvFiltro.ordem=this.value;atvProdutos()">${Object.entries(ATV_ORDENS).map(([k, [t]]) => `<option value="${k}" ${atvFiltro.ordem === k ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div id="atv-produtos"></div>
    </div>
    ${Object.keys(r.por_faixa).length ? `<div class="card"><div class="card-head"><div><div class="card-title">O que cada idade abre</div><div class="card-sub">Produtos mais abertos por faixa etária estimada de quem usou</div></div></div>
      <div class="atv-faixas">${MT_SEGMENTADAS.filter(f => r.por_faixa[f]).map(f => `<div class="atv-faixa"><div class="atv-faixa-topo" style="background:${MT_CORES[f]}">${mtEsc(MT_FAIXAS[f])}</div>
        <ol>${r.por_faixa[f].map(p => `<li><span>${mtEsc(p.nome)}</span><b>${p.aberturas}×</b></li>`).join("")}</ol></div>`).join("")}</div></div>` : ""}`;
  atvMapa();
  atvProdutos();
}

function atvProdutos() {
  const el = document.getElementById("atv-produtos");
  if (!el || !atvDados) return;
  const [, ordem, filtro] = ATV_ORDENS[atvFiltro.ordem];
  const lista = atvDados.produtos.filter(filtro || (() => true)).sort(ordem).slice(0, 30);
  const max = Math.max(...lista.map(p => p.impressoes), 1);
  el.innerHTML = lista.length ? `<div class="tbl-wrap"><table>
    <thead><tr><th>Produto</th><th>Na tela</th><th>Abriram</th><th>Taxa de abertura</th><th>Tempo médio na página</th><th>Olhando</th><th>Rolou a página</th><th>Na lista</th><th>Conversão</th></tr></thead>
    <tbody>${lista.map(p => `<tr>
      <td><div class="td-bold lj-nome">${mtEsc(p.nome)}</div></td>
      <td><div class="atv-funil"><i style="width:${p.impressoes / max * 100}%"></i></div>${p.impressoes}</td>
      <td><b>${p.aberturas}</b></td><td>${p.taxa_abertura != null ? `${p.taxa_abertura}%` : "—"}</td>
      <td>${p.tempo_medio_s != null ? mtSeg(p.tempo_medio_s) : "—"}</td><td>${p.olhando_medio_s != null ? mtSeg(p.olhando_medio_s) : "—"}</td>
      <td>${p.rolou_medio != null ? `${p.rolou_medio}%` : "—"}</td><td>${p.adicionados || "—"}</td>
      <td>${p.conversao != null ? `<b class="${p.conversao >= 30 ? "lj-green" : p.conversao ? "" : "lj-red"}">${p.conversao}%</b>` : "—"}</td>
    </tr>`).join("")}</tbody></table></div>` : `<div class="mt-vazio">Nenhum produto nesse critério.</div>`;
}

function atvMapa() {
  if (!atvDados) return;
  document.querySelectorAll("#atv-comportamento .lg-filtros button").forEach(b =>
    b.classList.toggle("on", b.getAttribute("onclick").includes(`'${atvFiltro.tela}'`)));
  const pontos = atvDados.toques.pontos.filter(p => p.tela === atvFiltro.tela && (!atvFiltro.soMortos || p.morto));
  const ls = atvDados.layouts || {};
  atvDesenhar(document.getElementById("atv-mapa"), pontos, ls[atvFiltro.tela] || ls.inicio, { tela: atvFiltro.tela });
}

// Mapa de calor: fundo com as regiões reais da tela do totem (evento "layout") + densidade dos toques
function atvDesenhar(canvas, pontos, layout, { numerar = false, tela = "inicio" } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#f7f9fc";
  ctx.fillRect(0, 0, W, H);
  const regioesTela = tela === "produto" ? ["cabecalho", "produto", "produto_comprar", "menu"] : ["cabecalho", "busca", "nichos", "categorias", "banner", "produtos", "menu"];
  for (const [nome, [x, y, w, h]] of Object.entries((layout && layout.regioes) || {})) {
    if (!regioesTela.includes(nome)) continue;
    ctx.fillStyle = nome === "produtos" ? "#eef3fa" : "#e6ecf5";
    ctx.strokeStyle = "#c9d6ea";
    ctx.fillRect(x * W, y * H, w * W, h * H);
    ctx.strokeRect(x * W + .5, y * H + .5, w * W - 1, h * H - 1);
    ctx.fillStyle = "#8496b0";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText(ATV_REGIOES[nome] || nome, x * W + 6, y * H + 14);
  }
  if (!layout) {
    ctx.fillStyle = "#8496b0";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("O desenho da tela aparece após a próxima sessão no totem", 12, 20);
  }
  if (!pontos.length) return;
  if (numerar) {   // sessão individual: toques numerados na ordem
    pontos.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 11, 0, Math.PI * 2);
      ctx.fillStyle = p.morto ? "rgba(229,36,59,.85)" : "rgba(26,77,143,.85)";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), p.x * W, p.y * H + 4);
      ctx.textAlign = "left";
    });
    return;
  }
  // densidade em escala de cinza (alfa) e depois colorida: azul → verde → amarelo → vermelho
  const off = document.createElement("canvas");
  off.width = W; off.height = H;
  const o = off.getContext("2d"), raio = 26, peso = Math.max(0.05, Math.min(0.35, 6 / Math.sqrt(pontos.length)));
  for (const p of pontos) {
    const g = o.createRadialGradient(p.x * W, p.y * H, 0, p.x * W, p.y * H, raio);
    g.addColorStop(0, `rgba(0,0,0,${peso})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    o.fillStyle = g;
    o.fillRect(p.x * W - raio, p.y * H - raio, raio * 2, raio * 2);
  }
  const img = o.getImageData(0, 0, W, H), d = img.data;
  const cor = t => t < .33 ? [37, 99, 235].map((c, i) => c + ([34, 197, 94][i] - c) * t / .33)
    : t < .66 ? [34, 197, 94].map((c, i) => c + ([250, 204, 21][i] - c) * (t - .33) / .33)
    : [250, 204, 21].map((c, i) => c + ([229, 36, 59][i] - c) * (t - .66) / .34);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    const [r, g, b] = cor(Math.min(a * 1.4, 1));
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.min(255, a * 1.4 * 255 + 40);
  }
  o.putImageData(img, 0, 0);
  ctx.drawImage(off, 0, 0);
}

// ─── Sessões (replay) ───────────────────────────────────────────────────────
async function atvSessoes() {
  const alvo = document.getElementById("atv-sessoes");
  const r = await mtGet(`/api/relatorios/sessoes?dias=${atvFiltro.dias}`);
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  alvo.innerHTML = `
    <div class="grid-2 atv-grid-sessoes">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Sessões recentes</div><div class="card-sub">Toque em uma para ver o caminho do cliente</div></div>
          <div class="mt-periodo">${[[1, "Hoje"], [7, "7 dias"], [30, "30 dias"]].map(([d, t]) => `<button type="button" class="${atvFiltro.dias === d ? "on" : ""}" onclick="atvFiltro.dias=${d};atvSessoes()">${t}</button>`).join("")}</div></div>
        <div class="atv-lista">${r.recentes.map(s => `
          <button type="button" class="atv-sessao" onclick="atvReplay('${mtEsc(s.id)}', this)">
            <div><b>${new Date(s.inicio * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</b>
              <span>${mtSeg(s.duracao_s)} · ${s.cliques} toques · ${s.produtos_vistos} produtos${s.faixa ? ` · ${mtEsc(MT_FAIXAS[s.faixa] || s.faixa)}` : ""}</span></div>
            ${s.finalizou ? '<span class="badge badge-green">Pediu</span>' : `<span class="badge badge-amber">Saiu em ${mtEsc(s.ultima_tela || "início")}</span>`}
          </button>`).join("") || `<div class="mt-vazio">Nenhuma sessão no período.</div>`}</div>
      </div>
      <div class="card" id="atv-replay"><div class="mt-vazio">Escolha uma sessão ao lado.</div></div>
    </div>`;
}

async function atvReplay(id, botao) {
  document.querySelectorAll(".atv-sessao").forEach(b => b.classList.toggle("on", b === botao));
  const s = await mtGet(`/api/sessoes/${encodeURIComponent(id)}`);
  const el = document.getElementById("atv-replay");
  if (!s || !el) return;
  const ev = s.eventos;
  const toques = ev.filter(e => (e.tipo === "clique" || e.tipo === "toque") && e.detalhe.x != null)
    .map(e => ({ x: e.detalhe.x, y: e.detalhe.y, tela: e.tela || "inicio", morto: e.tipo === "toque" }));
  const layouts = Object.fromEntries(ev.filter(e => e.tipo === "layout").map(e => [e.tela || "inicio", e.detalhe]));
  const layoutDe = t => layouts[t] || layouts.inicio || (atvDados && atvDados.layouts && (atvDados.layouts[t] || atvDados.layouts.inicio));
  const telasTempo = ev.filter(e => e.tipo === "tela_tempo");
  const prodTempo = ev.filter(e => e.tipo === "produto_tempo");
  const vistos = new Set(ev.filter(e => e.tipo === "impressoes").flatMap(e => e.detalhe.ids || []));
  const rolagem = (ev.find(e => e.tipo === "rolagem") || {}).detalhe;
  const telas = [...new Set(toques.map(t => t.tela))];
  window.atvReplayDados = { toques, layoutDe };
  const descreve = e => {
    const d = e.detalhe || {};
    if (e.tipo === "tela_tempo") return ["⏱", `Ficou ${mtSeg(d.duracao_s)} em ${e.alvo}`, d.olhando_s ? `olhando ${mtSeg(d.olhando_s)}` : "sem olhar para a tela"];
    if (e.tipo === "produto_tempo") return ["👁", `Viu “${e.alvo}” por ${mtSeg(d.duracao_s)}`, `olhando ${mtSeg(d.olhando_s || 0)} · rolou ${d.rolou_pct || 0}% da página`];
    if (e.tipo === "toque") return ["✋", `Tocou numa área sem botão (${ATV_REGIOES[e.alvo] || e.alvo})`, ""];
    if (e.tipo === "clique") return ["👆", `Tocou: ${e.alvo}`, ATV_REGIOES[d.regiao] || ""];
    return ["•", `${MT_EVENTOS[e.tipo] || e.tipo}${e.alvo ? `: ${e.alvo}` : ""}`, ""];
  };
  const linha = ev.filter(e => !["impressoes", "layout", "rolagem", "tela"].includes(e.tipo));
  el.innerHTML = `
    <div class="card-head"><div><div class="card-title">Caminho do cliente</div>
      <div class="card-sub">${new Date(s.inicio * 1000).toLocaleString("pt-BR")} · ${mtSeg(s.duracao_s)} · olhando ${mtSeg(s.atencao_s)} · ${s.faixa ? mtEsc(MT_FAIXAS[s.faixa] || s.faixa) : "faixa não identificada"} · ${s.finalizou ? "fez o pedido" : "não pediu"}</div></div></div>
    <div class="lj-saldo">
      <div><b>${toques.length}</b><span>toques (${toques.filter(t => t.morto).length} sem resposta)</span></div>
      <div><b>${vistos.size}</b><span>produtos na tela</span></div>
      <div><b>${prodTempo.length}</b><span>produtos abertos</span></div>
      <div><b>${rolagem ? rolagem.max_linha : "—"}</b><span>linhas rolou</span></div>
    </div>
    <div class="atv-replay">
      <div>
        ${telas.length > 1 ? `<div class="lg-filtros" style="margin-bottom:8px">${telas.map((t, i) => `<button type="button" class="${i ? "" : "on"}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on');atvDesenhar(document.getElementById('atv-replay-mapa'), atvReplayDados.toques.filter(p=>p.tela==='${mtEsc(t)}'), atvReplayDados.layoutDe('${mtEsc(t)}'), {numerar:true, tela:'${mtEsc(t)}'})">${mtEsc(t)}</button>`).join("")}</div>` : ""}
        <div class="atv-mapa-wrap atv-mapa-mini"><canvas id="atv-replay-mapa" width="270" height="480"></canvas></div>
        <div class="mt-legenda" style="margin-top:6px">Números = ordem dos toques · vermelho = toque sem resposta</div>
      </div>
      <ol class="atv-tempo">${linha.map(e => { const [ico, t, sub] = descreve(e); return `<li class="atv-ev-${mtEsc(e.tipo)}">
        <span class="atv-t">+${mtSeg(e.ts - s.inicio)}</span><span class="atv-ico">${ico}</span>
        <span><b>${mtEsc(t)}</b>${sub ? `<em>${mtEsc(sub)}</em>` : ""}</span></li>`; }).join("") || "<li>Sem eventos.</li>"}</ol>
    </div>`;
  atvDesenhar(document.getElementById("atv-replay-mapa"), toques.filter(t => t.tela === (telas[0] || "inicio")), layoutDe(telas[0] || "inicio"), { numerar: true, tela: telas[0] || "inicio" });
}
