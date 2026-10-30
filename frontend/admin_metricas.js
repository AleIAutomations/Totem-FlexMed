// =====================================================
// FlexMed Admin — painéis com dados reais (backend/metricas.py)
//   Dashboard ............ resumo do dia
//   Sessões & Comportamento (p-analytics) ... funil, cliques, desistência
//   Audiência & Anúncios (p-visao) .......... público, faixas, anúncios
// Tudo anônimo: faixa etária estimada e atenção, sem imagem.
// =====================================================

// Faixas de 10 anos (mesmos slugs do backend/visao.py); menores de 18 não são segmentados
const MT_FAIXAS = {
  "18-28": "18–28 anos", "28-38": "28–38 anos", "38-48": "38–48 anos", "48-58": "48–58 anos",
  "58-68": "58–68 anos", "68-78": "68–78 anos", "78-88": "78–88 anos",
  menor: "Menor de 18", "não identificado": "Não identificado",
  // registros antigos, de antes das faixas de 10 anos
  jovem: "Jovem (antigo)", adulto: "Adulto (antigo)", maduro: "Maduro (antigo)", idoso: "Idoso (antigo)", crianca: "Criança (antigo)",
};
const MT_CORES = {
  "18-28": "#2C66B0", "28-38": "#1b8a8f", "38-48": "#1b6b4e", "48-58": "#7a9a1e",
  "58-68": "#b45309", "68-78": "#c2410c", "78-88": "#7c3aed", menor: "#64748b",
};
const MT_SEGMENTADAS = Object.keys(MT_CORES).filter(f => f !== "menor");

// Selo "Supabase" / "Local" com a origem dos dados do relatório
function mtFonte(fonte) {
  return fonte === "supabase"
    ? `<span class="badge badge-green mt-fonte" title="Dados lidos do Supabase">Supabase</span>`
    : `<span class="badge badge-amber mt-fonte" title="Supabase indisponível: dados do próprio totem (serão enviados quando ele voltar)">Local</span>`;
}
const mtPeriodo = { sess: 7, aud: 7 };
let mtAudienciaTimer = null;

function mtEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function mtSeg(s) {
  s = Math.round(Number(s) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return m < 60 ? `${m}m ${String(r).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function mtGet(caminho) {
  try {
    const r = await fetch(`${FLEXMED_SERVER}${caminho}`);
    return r.ok ? await r.json() : null;
  } catch (_) { return null; }
}

function mtCard(rotulo, valor, sub = "", cor = "blue") {
  return `<div class="stat-card">
    <div class="stat-card-label">${mtEsc(rotulo)}</div>
    <div class="stat-card-value" style="color:var(--${cor === "blue" ? "navy" : cor},inherit)">${mtEsc(valor)}</div>
    ${sub ? `<div class="stat-card-sub">${mtEsc(sub)}</div>` : ""}
  </div>`;
}

// Lista de barras horizontais: [{rotulo, valor, pct?, cor?}]
function mtBarras(itens, unidade = "", vazio = "Sem dados no período.") {
  if (!itens.length) return `<div class="mt-vazio">${vazio}</div>`;
  const max = Math.max(...itens.map(i => i.valor), 1);
  return `<div class="mt-barras">${itens.map(i => `
    <div class="mt-barra">
      <div class="mt-barra-topo"><span>${mtEsc(i.rotulo)}</span><b>${mtEsc(i.valor)}${unidade}${i.pct != null ? ` · ${i.pct}%` : ""}</b></div>
      <div class="mt-barra-trilho"><div style="width:${Math.max(2, i.valor / max * 100)}%;background:${i.cor || "var(--blue)"}"></div></div>
    </div>`).join("")}</div>`;
}

// Gráfico de colunas por hora (reaproveita o estilo .chart-bar-row do admin)
function mtColunasHora(porHora, campo, rotulo) {
  const max = Math.max(...porHora.map(h => h[campo]), 1);
  return `<div class="chart-bar-row">${porHora.map(h => `
      <div class="chart-bar" style="height:${Math.max(4, Math.round(h[campo] / max * 100))}%">
        <div class="tip">${h.hora}h: ${h[campo]} ${rotulo}</div>
      </div>`).join("")}</div>
    <div class="chart-labels">${porHora.filter(h => h.hora % 3 === 0).map(h => `<span>${h.hora}h</span>`).join("")}</div>`;
}

function mtSeletorPeriodo(chave, recarregar) {
  return `<div class="mt-periodo">${[[1, "Hoje"], [7, "7 dias"], [30, "30 dias"]].map(([d, t]) =>
    `<button type="button" class="${mtPeriodo[chave] === d ? "on" : ""}" onclick="mtPeriodo.${chave}=${d};${recarregar}()">${t}</button>`).join("")}</div>`;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
async function carregarDashboard() {
  const [aud, ses, met] = await Promise.all([
    mtGet("/api/relatorios/audiencia?dias=1"), mtGet("/api/relatorios/sessoes?dias=1"), mtGet("/api/metrics"),
  ]);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (aud) {
    set("d-visitors", aud.pessoas);
    set("d-visitors-sub", `${aud.olharam} olharam a tela (${aud.taxa_olhar}%)`);
    const chart = document.getElementById("hour-chart"), lbl = document.getElementById("hour-labels");
    if (chart) {
      const max = Math.max(...aud.por_hora.map(h => h.pessoas), 1);
      chart.innerHTML = aud.por_hora.map(h => `<div class="chart-bar" style="height:${Math.max(4, Math.round(h.pessoas / max * 100))}%"><div class="tip">${h.hora}h: ${h.pessoas} pessoas</div></div>`).join("");
      lbl.innerHTML = aud.por_hora.filter(h => h.hora % 2 === 0).map(h => `<span>${String(h.hora).padStart(2, "0")}h</span>`).join("");
    }
  }
  if (ses) {
    set("d-consults", ses.produtos_vistos_total);
    set("d-consults-sub", `${ses.buscas.reduce((n, b) => n + b.vezes, 0)} buscas · ${ses.buscas_voz} por voz`);
    set("d-ai", ses.sessoes);
    set("d-ai-sub", `${ses.taxa_conversao}% finalizaram · ${ses.taxa_desistencia}% desistiram`);
    const tbody = document.getElementById("top-tbl");
    if (tbody) {
      tbody.innerHTML = ses.buscas.length
        ? ses.buscas.slice(0, 6).map(b => `<tr><td class="td-bold">${mtEsc(b.termo)}</td><td>${b.vezes}x</td><td>—</td></tr>`).join("")
        : `<tr><td colspan="3" style="color:var(--text3)">Nenhuma busca hoje.</td></tr>`;
    }
  }
  if (met) set("d-nps", Number(met.score || 0).toFixed(1));
}

// ─── Sessões & Comportamento ─────────────────────────────────────────────────
async function carregarSessoes() {
  const alvo = document.getElementById("sess-painel");
  if (!alvo) return;
  const r = await mtGet(`/api/relatorios/sessoes?dias=${mtPeriodo.sess}`);
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível carregar os dados do totem.</div>`; return; }
  const totalFunil = r.funil[0]?.sessoes || 1;
  alvo.innerHTML = `
    <div class="mt-cabecalho">
      <div class="mt-legenda">Cada sessão começa quando alguém toca o totem (ou se aproxima dele) e termina quando ele volta ao modo de espera. Desistência = saiu sem finalizar o pedido no balcão.</div>
      <div class="mt-cabecalho-dir">${mtFonte(r.fonte)}${mtSeletorPeriodo("sess", "carregarSessoes")}</div>
    </div>
    <div class="stat-row">
      ${mtCard("Sessões", r.sessoes, `${r.por_origem.anuncio || 0} vieram de um anúncio · ${r.por_origem.aproximacao || 0} por aproximação`)}
      ${mtCard("Conversão", `${r.taxa_conversao}%`, "finalizaram o pedido", "emerald")}
      ${mtCard("Desistência", `${r.taxa_desistencia}%`, "saíram sem finalizar", "crimson")}
      ${mtCard("Tempo médio", mtSeg(r.duracao_media_s), `atenção na tela: ${mtSeg(r.atencao_media_s)} · ${r.cliques_por_sessao} toques`)}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Funil de compra</div><div class="card-sub">Quantas sessões chegaram a cada etapa</div></div></div>
        <div class="mt-funil">${r.funil.map((f, i) => `
          <div class="mt-funil-etapa">
            <div class="mt-funil-barra" style="width:${Math.max(4, f.sessoes / totalFunil * 100)}%;opacity:${1 - i * 0.12}"></div>
            <div class="mt-funil-txt"><span>${mtEsc(f.etapa)}</span><b>${f.sessoes} · ${f.pct}%</b></div>
          </div>`).join("")}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Onde desistiram</div><div class="card-sub">Última tela das sessões sem finalização</div></div></div>
        ${mtBarras(r.telas_de_desistencia.map(t => ({ rotulo: t.tela, valor: t.sessoes, cor: "#c81e33" })), "", "Nenhuma desistência no período.")}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Mais tocados</div><div class="card-sub">Botões e cards com mais toques</div></div></div>
        ${mtBarras(r.mais_clicados.map(c => ({ rotulo: c.alvo, valor: c.cliques })), " toques")}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Produtos mais vistos</div><div class="card-sub">Páginas de produto abertas</div></div></div>
        ${mtBarras(r.produtos_mais_vistos.map(p => ({ rotulo: p.produto, valor: p.vezes, cor: "var(--emerald,#1b6b4e)" })), "x")}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Buscas</div><div class="card-sub">Digitadas ou faladas ao assistente (${r.buscas_voz} por voz)</div></div></div>
        ${mtBarras(r.buscas.map(b => ({ rotulo: b.termo, valor: b.vezes })), "x")}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Quem usou</div><div class="card-sub">Faixa etária estimada predominante em cada sessão</div></div></div>
        ${mtBarras(Object.entries(r.por_faixa).map(([f, n]) => ({ rotulo: MT_FAIXAS[f] || f, valor: n, cor: MT_CORES[f] })), " sessões")}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Sessões recentes</div><div class="card-sub">Toque em "Ver" para a linha do tempo da sessão</div></div></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Início</th><th>Origem</th><th>Duração</th><th>Atenção</th><th>Faixa</th><th>Toques</th><th>Produtos</th><th>Lista</th><th>Resultado</th><th></th></tr></thead>
        <tbody>${r.recentes.length ? r.recentes.map(s => `<tr>
          <td>${new Date(s.inicio * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
          <td>${({ anuncio: "Anúncio", aproximacao: "Aproximação" })[s.origem] || "Toque"}</td>
          <td>${mtSeg(s.duracao_s)}</td><td>${mtSeg(s.atencao_s)}</td>
          <td>${mtEsc(MT_FAIXAS[s.faixa] || "—")}</td>
          <td>${s.cliques}</td><td>${s.produtos_vistos}</td><td>${s.adicionados}</td>
          <td>${s.finalizou ? '<span class="badge badge-green">Finalizou</span>' : `<span class="badge badge-amber">Desistiu em ${mtEsc(s.ultima_tela || "início")}</span>`}</td>
          <td><button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="verSessao('${mtEsc(s.id)}')">Ver</button></td>
        </tr>`).join("") : `<tr><td colspan="10" style="color:var(--text3)">Nenhuma sessão no período.</td></tr>`}</tbody>
      </table></div>
    </div>
    <div id="sess-detalhe"></div>`;
}

const MT_EVENTOS = {
  clique: "Tocou", tela: "Abriu a tela", busca: "Buscou", categoria: "Filtrou", produto: "Viu o produto",
  carrinho_add: "Adicionou à lista", carrinho_remover: "Removeu da lista", finalizou: "Finalizou o pedido",
  voz: "Falou com o assistente", libras: "Abriu o Libras", idioma: "Trocou o idioma", avaliacao: "Avaliou",
  vitrine_ver: "Viu o bloco da vitrine", vitrine_clique: "Tocou no bloco da vitrine",
};

async function verSessao(id) {
  const s = await mtGet(`/api/sessoes/${encodeURIComponent(id)}`);
  const alvo = document.getElementById("sess-detalhe");
  if (!s || !alvo) return;
  alvo.innerHTML = `<div class="card" style="margin-top:20px">
    <div class="card-head"><div><div class="card-title">Linha do tempo da sessão</div>
      <div class="card-sub">${new Date(s.inicio * 1000).toLocaleString("pt-BR")} · ${mtSeg(s.duracao_s)} · atenção ${mtSeg(s.atencao_s)} · ${s.finalizou ? "finalizou" : "desistiu"}</div></div></div>
    <ol class="mt-linha">${s.eventos.map(e => `<li class="mt-ev-${mtEsc(e.tipo)}">
      <span class="mt-linha-t">+${mtSeg(e.ts - s.inicio)}</span>
      <span><b>${mtEsc(MT_EVENTOS[e.tipo] || e.tipo)}</b> ${mtEsc(e.alvo || "")}</span>
    </li>`).join("") || "<li>Sem eventos.</li>"}</ol>
  </div>`;
  alvo.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Audiência & Anúncios ────────────────────────────────────────────────────
async function carregarAudiencia() {
  const alvo = document.getElementById("aud-painel");
  if (!alvo) return;
  const [aud, an, modelo] = await Promise.all([
    mtGet(`/api/relatorios/audiencia?dias=${mtPeriodo.aud}`), mtGet(`/api/relatorios/anuncios?dias=${mtPeriodo.aud}`),
    mtGet("/api/audiencia/modelo"),
  ]);
  if (!aud || !an) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível carregar os dados do totem.</div>`; return; }
  const faixas = aud.faixas.filter(f => f.faixa !== "menor");
  const menores = aud.faixas.find(f => f.faixa === "menor")?.pessoas || 0;
  alvo.innerHTML = `
    <div class="mt-cabecalho">
      <div class="mt-legenda">A câmera do totem estima a faixa etária e se a pessoa está olhando para a tela. Nenhuma imagem é gravada: só ficam faixa etária, se olhou e por quanto tempo.</div>
      <div class="mt-cabecalho-dir">${mtFonte(aud.fonte)}${mtSeletorPeriodo("aud", "carregarAudiencia")}</div>
    </div>
    <div class="card mt-ao-vivo" id="aud-ao-vivo"><div class="mt-vazio">Conectando à câmera do totem…</div></div>
    <div class="stat-row">
      ${mtCard("Pessoas que passaram", aud.pessoas, `${aud.por_contexto.standby || 0} no modo anúncio · ${aud.por_contexto.uso || 0} usando`)}
      ${mtCard("Olharam a tela", aud.olharam, `${aud.taxa_olhar}% de quem passou`, "emerald")}
      ${mtCard("Atenção média", mtSeg(aud.atencao_media_s), "tempo olhando, por pessoa")}
      ${mtCard("Exibições de anúncio", an.totais.exibicoes, `${an.totais.espectadores} espectadores · ${an.totais.interacoes} toques`)}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Perfil do público</div><div class="card-sub">Faixa etária estimada de quem olhou a tela${aud.confianca_media != null ? ` · confiança média ${aud.confianca_media}%` : ""}</div></div></div>
        ${faixas.some(f => f.pessoas) ? mtBarras(faixas.map(f => ({ rotulo: f.nome, valor: f.pessoas, pct: f.pct, cor: MT_CORES[f.faixa] })), " pessoas") : `<div class="mt-vazio">Sem dados no período.</div>`}
        <div class="mt-legenda" style="margin-top:12px">${menores} menor(es) de 18 e ${aud.sem_faixa} pessoa(s) sem faixa (rosto longe, de lado ou registro anterior às faixas de 10 anos) não entram na porcentagem.</div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Audiência por hora</div><div class="card-sub">Pessoas na frente do totem</div></div></div>
        ${mtColunasHora(aud.por_hora, "pessoas", "pessoas")}
      </div>
    </div>
    ${mtCardModelo(modelo)}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Desempenho dos anúncios</div>
        <div class="card-sub">Segmentadas = exibições escolhidas pela faixa etária do público presente</div></div></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Anúncio</th><th>Público-alvo</th><th>Exibições</th><th>Segmentadas</th><th>Espectadores</th><th>Por exibição</th><th>Atenção média</th><th>Interação</th><th>Quem assistiu</th></tr></thead>
        <tbody>${an.campanhas.length ? an.campanhas.map(c => {
          const tot = Object.values(c.faixas).reduce((a, b) => a + b, 0);
          return `<tr>
            <td class="td-bold">${mtEsc(c.nome)}</td>
            <td>${(c.publico_alvo || []).length ? c.publico_alvo.map(f => mtEsc((MT_FAIXAS[f] || f).split(" ")[0])).join(", ") : "Todos"}</td>
            <td>${c.exibicoes}</td>
            <td>${c.exibicoes ? Math.round(c.segmentadas / c.exibicoes * 100) : 0}%</td>
            <td>${c.espectadores}</td>
            <td>${c.espectadores_por_exibicao}</td>
            <td>${mtSeg(c.atencao_media_s)}</td>
            <td>${c.taxa_interacao}%</td>
            <td><div class="mt-mini">${tot ? Object.entries(c.faixas).filter(([, n]) => n).map(([f, n]) =>
              `<span title="${mtEsc(MT_FAIXAS[f])}: ${n}" style="width:${n / tot * 100}%;background:${MT_CORES[f]}"></span>`).join("") : ""}</div></td>
          </tr>`;
        }).join("") : `<tr><td colspan="9" style="color:var(--text3)">Nenhum anúncio exibido no período.</td></tr>`}</tbody>
      </table></div>
      <div class="mt-legenda-cores">${Object.entries(MT_CORES).filter(([f]) => f !== "menor").map(([f, c]) =>
        `<span><i style="background:${c}"></i>${mtEsc(MT_FAIXAS[f])}</span>`).join("")}</div>
    </div>`;
  atualizarAudienciaAoVivo();
  clearInterval(mtAudienciaTimer);
  mtAudienciaTimer = setInterval(atualizarAudienciaAoVivo, 1000);
}

// Modelo de idade em uso: dataset, precisão no teste e comparação com o modelo original
function mtCardModelo(m) {
  if (!m) return "";
  if (!m.treinado) {
    return `<div class="card"><div class="card-head"><div><div class="card-title">Modelo de faixa etária</div>
      <div class="card-sub">Classificador treinado não encontrado (backend/modelos/faixas_idade.npz): usando a idade crua do modelo original.</div></div></div></div>`;
  }
  const met = m.metricas || {}, nov = met[m.modelo] || {}, base = met.base || {};
  const pct = v => `${Math.round((v || 0) * 100)}%`;
  return `<div class="card">
    <div class="card-head"><div><div class="card-title">Modelo de faixa etária</div>
      <div class="card-sub">Treinado em ${mtEsc(m.dataset)} · ${Number(m.amostras_treino).toLocaleString("pt-BR")} amostras de treino, ${Number(m.amostras_teste).toLocaleString("pt-BR")} de teste</div></div>
      <span class="badge badge-green">Treinado</span></div>
    <div class="mt-modelo">
      <div><b>${pct(nov.exata)}</b><span>acerta a faixa exata<br>(original: ${pct(base.exata)})</span></div>
      <div><b>${pct(nov.vizinha)}</b><span>acerta ou erra por 1 faixa<br>(original: ${pct(base.vizinha)})</span></div>
      <div><b>${pct(nov.balanceada)}</b><span>média entre as faixas<br>(original: ${pct(base.balanceada)})</span></div>
    </div>
    <div class="mt-legenda" style="margin-top:12px">Precisão de uma única foto. No totem, a faixa de cada pessoa sai da votação de várias leituras enquanto ela olha a tela, o que deixa a estimativa mais estável.</div>
  </div>`;
}

// Público na frente do totem agora (atualiza a cada 3 s enquanto a página está aberta)
async function atualizarAudienciaAoVivo() {
  const el = document.getElementById("aud-ao-vivo");
  if (!el || !document.getElementById("p-visao").classList.contains("on")) { clearInterval(mtAudienciaTimer); return; }
  const r = await mtGet("/api/audiencia/agora");
  if (!r) { el.innerHTML = `<div class="mt-vazio">Câmera do totem sem sinal.</div>`; return; }
  const total = Object.values(r.faixas || {}).reduce((a, b) => a + b, 0);
  el.innerHTML = `
    <div class="mt-ao-vivo-titulo"><span class="mt-pulso"></span>Agora na frente do totem</div>
    <div class="mt-ao-vivo-nums">
      <div><b>${r.pessoas}</b><span>pessoas</span></div>
      <div><b>${r.olhando}</b><span>olhando a tela</span></div>
      <div><b>${mtEsc(r.dominante ? (MT_FAIXAS[r.dominante] || r.dominante) : "—")}</b><span>público predominante</span></div>
    </div>
    ${total ? `<div class="mt-mini mt-mini-grande">${Object.entries(r.faixas).filter(([, n]) => n).map(([f, n]) =>
      `<span style="width:${n / total * 100}%;background:${MT_CORES[f]}">${mtEsc((MT_FAIXAS[f] || f).split(" ")[0])} ${Math.round(n / total * 100)}%</span>`).join("")}</div>` : ""}
    ${(r.rostos || []).length ? `<div class="mt-rostos">${r.rostos.map((p, i) => `
      <div class="mt-rosto ${p.olhando ? "olhando" : ""}">
        <i style="background:${MT_CORES[p.faixa] || "#cbd5e1"}"></i>
        <span>Pessoa ${i + 1}</span>
        <b>${mtEsc(p.faixa ? MT_FAIXAS[p.faixa] || p.faixa : "estimando…")}</b>
        <em>${p.confianca != null ? `${Math.round(p.confianca * 100)}% de confiança` : ""}${p.olhando ? " · olhando" : " · de lado"}</em>
      </div>`).join("")}</div>` : ""}`;
}
