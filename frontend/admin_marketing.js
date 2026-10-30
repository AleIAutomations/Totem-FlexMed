// =====================================================
// FlexMed Admin — Painel de marketing (p-marketing)
// Visão para o time de marketing: alcance e atenção (câmera), funil até a venda,
// público por idade e conversão, campanhas e efeito da segmentação, vitrine,
// melhores horários, demanda (buscas, voz) e vendas — sempre comparando com o
// período anterior. Dados: GET /api/relatorios/marketing (backend/marketing.py).
// Usa admin_metricas.js (mtGet, mtEsc, mtSeg, mtBarras, MT_FAIXAS, MT_CORES) e admin_catalogo.js (lojaBRL).
// =====================================================

let mkDias = 30, mkDados = null;
const MK_ORIGENS = { toque: "Toque na tela", anuncio: "Veio de uma campanha", aproximacao: "Acordou por aproximação" };

function mkVar(kpi, inverso = false) {
  if (!kpi || kpi.variacao == null) return `<span class="mk-var mk-var-nd" title="Sem dados no período anterior">novo</span>`;
  const sobe = kpi.variacao >= 0, bom = inverso ? !sobe : sobe;
  return `<span class="mk-var ${kpi.variacao === 0 ? "" : bom ? "mk-var-bom" : "mk-var-ruim"}" title="Período anterior: ${kpi.anterior}">${sobe ? "▲" : "▼"} ${Math.abs(kpi.variacao)}%</span>`;
}

function mkCard(rotulo, valor, kpi, sub = "") {
  return `<div class="stat-card mk-card"><div class="stat-card-label">${mtEsc(rotulo)}</div>
    <div class="mk-card-valor"><span>${mtEsc(valor)}</span>${mkVar(kpi)}</div>${sub ? `<div class="stat-card-sub">${mtEsc(sub)}</div>` : ""}</div>`;
}

async function carregarMarketing() {
  const alvo = document.getElementById("mk-painel");
  if (!alvo) return;
  if (!mkDados) alvo.innerHTML = `<div class="mt-vazio">Carregando…</div>`;
  const r = await mtGet(`/api/relatorios/marketing?dias=${mkDias}`);
  if (!r) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível falar com o backend do totem.</div>`; return; }
  mkDados = r;
  const k = r.kpis, v = c => k[c].valor;
  const maxGrade = Math.max(1, ...r.horarios.grade.flat());
  const maxHora = Math.max(1, ...r.horarios.por_hora.map(h => h.alcance));
  const maxPed = Math.max(1, ...r.horarios.por_hora.map(h => h.pedidos));
  alvo.innerHTML = `
    <div class="mt-cabecalho">
      <div class="mt-legenda">Tudo o que o totem mede, reunido para planejar e avaliar campanhas. As setas comparam com os ${mkDias} dias anteriores.</div>
      <div class="mt-cabecalho-dir">
        <div class="mt-periodo">${[[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]].map(([d, t]) => `<button type="button" class="${mkDias === d ? "on" : ""}" onclick="mkDias=${d};carregarMarketing()">${t}</button>`).join("")}</div>
        <button class="tb-btn tb-btn-ghost" style="font-size:12px" onclick="mkExportar()">Exportar relatório</button>
      </div>
    </div>
    ${r.insights.length ? `<div class="card mk-insights"><div class="card-title">💡 O que os dados dizem</div><ul>${r.insights.map(i => `<li>${mtEsc(i)}</li>`).join("")}</ul></div>` : ""}
    <div class="stat-row">
      ${mkCard("Alcance", v("alcance").toLocaleString("pt-BR"), k.alcance, "pessoas que passaram em frente")}
      ${mkCard("Taxa de atenção", `${v("taxa_atencao")}%`, k.taxa_atencao, `${v("olharam")} olharam · ${mtSeg(v("atencao_media_s"))} em média`)}
      ${mkCard("Engajamento", `${v("taxa_engajamento")}%`, k.taxa_engajamento, `${v("sessoes")} sessões de quem olhou`)}
      ${mkCard("Conversão", `${v("conversao")}%`, k.conversao, `${v("pedidos")} pedidos / sessões`)}
    </div>
    <div class="stat-row">
      ${mkCard("Receita", lojaBRL(v("receita")), k.receita, `${v("entregues")} pedidos retirados`)}
      ${mkCard("Ticket médio", lojaBRL(v("ticket_medio")), k.ticket_medio, `${r.vendas.itens_por_pedido} itens por pedido`)}
      ${mkCard("Exibições de campanha", v("exibicoes").toLocaleString("pt-BR"), k.exibicoes, `${v("espectadores")} espectadores`)}
      ${mkCard("Receita em promoção", `${r.vendas.pct_receita_promocao}%`, null, `${lojaBRL(r.vendas.receita_promocao)} em produtos com desconto`)}
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Funil completo</div><div class="card-sub">Da pessoa que passou em frente até a retirada no balcão · % = em relação à etapa anterior</div></div></div>
      <div class="mk-funil">${r.funil.map((f, i) => `<div class="mk-funil-etapa">
        <div class="mk-funil-barra" style="width:${Math.max(f.pct_topo, 1.5)}%;opacity:${1 - i * .1}"></div>
        <div class="mk-funil-txt"><span>${mtEsc(f.etapa)}</span><b>${f.valor.toLocaleString("pt-BR")}</b><em>${i ? `${f.pct_etapa}% da etapa anterior` : ""}</em></div></div>`).join("")}</div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Público por idade</div><div class="card-sub">Quem olha, quem usa e quem compra (faixa estimada pela câmera)</div></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Faixa</th><th>% do público</th><th>Sessões</th><th>Pedidos</th><th>Conversão</th><th>Receita</th></tr></thead>
          <tbody>${r.publico.map(p => `<tr><td style="white-space:nowrap"><i class="mk-ponto" style="background:${MT_CORES[p.faixa]}"></i>${mtEsc(MT_FAIXAS[p.faixa] || p.nome)}</td>
            <td><div class="atv-olhar"><div style="width:${p.pct_publico}%;background:${MT_CORES[p.faixa]}"></div></div>${p.pct_publico}%</td>
            <td>${p.sessoes}</td><td>${p.pedidos}</td><td>${p.conversao}%</td><td>${lojaBRL(p.receita)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">De onde vêm as vendas</div><div class="card-sub">Como a sessão começou e quanto ela converteu</div></div></div>
        <div class="mk-origens">${r.origens.map(o => `<div><span>${mtEsc(MK_ORIGENS[o.origem])}</span><b>${o.sessoes}</b><em>sessões · ${o.pedidos} pedidos · ${o.conversao}% conversão</em></div>`).join("")}</div>
        <div class="vt-secao">Efeito da segmentação por idade nas campanhas</div>
        ${r.segmentacao.segmentadas || r.segmentacao.rotacao ? `<div class="mk-comparar">
          <div><b>${mtSeg(r.segmentacao.atencao_segmentada_s)}</b><span>atenção por exibição segmentada (${r.segmentacao.segmentadas})</span></div>
          <div><b>${mtSeg(r.segmentacao.atencao_rotacao_s)}</b><span>atenção na rotação comum (${r.segmentacao.rotacao})</span></div>
          <div><b class="${(r.segmentacao.ganho_pct || 0) >= 0 ? "lj-green" : "lj-red"}">${r.segmentacao.ganho_pct != null ? `${r.segmentacao.ganho_pct > 0 ? "+" : ""}${r.segmentacao.ganho_pct}%` : "—"}</b><span>ganho da segmentação</span></div></div>`
          : `<div class="mt-vazio">Sem exibições de campanha no período.</div>`}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Campanhas</div><div class="card-sub">Desempenho de cada campanha do modo de espera · atenção = tempo olhando a tela durante a exibição</div></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Campanha</th><th>Exibições</th><th>Espectadores</th><th>Por exibição</th><th>Atenção total</th><th>Atenção por espectador</th><th>Interação</th><th>Segmentadas</th><th>Quem mais viu</th></tr></thead>
        <tbody>${r.campanhas.map(c => `<tr><td class="td-bold">${mtEsc(c.nome)}</td><td>${c.exibicoes}</td><td>${c.espectadores}</td><td>${c.espectadores_por_exibicao}</td>
          <td>${mtSeg(c.atencao_total_s)}</td><td>${mtSeg(c.atencao_por_espectador_s)}</td><td>${c.taxa_interacao}%</td><td>${c.pct_segmentadas}%</td>
          <td>${c.faixa_principal ? `<i class="mk-ponto" style="background:${MT_CORES[c.faixa_principal]}"></i>${mtEsc(MT_FAIXAS[c.faixa_principal])}` : "—"}</td></tr>`).join("")
          || `<tr><td colspan="9" style="color:var(--text3)">Nenhuma campanha exibida no período.</td></tr>`}</tbody></table></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Melhores horários</div><div class="card-sub">Movimento em frente ao totem por dia da semana e hora — mais escuro = mais gente</div></div></div>
        <div class="mk-grade"><div></div>${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 ? "" : h}</span>`).join("")}
          ${r.horarios.grade.map((linha, d) => `<b>${r.horarios.dias[d]}</b>${linha.map((n, h) => `<i title="${r.horarios.dias[d]} ${h}h: ${n} pessoas" style="background:rgba(26,77,143,${n ? .12 + n / maxGrade * .88 : .04})"></i>`).join("")}`).join("")}</div>
        <div class="vt-secao">Alcance × pedidos por hora</div>
        <div class="mk-horas">${r.horarios.por_hora.map(h => `<div title="${h.hora}h: ${h.alcance} pessoas · ${h.pedidos} pedidos"><i style="height:${h.alcance / maxHora * 100}%"></i><em style="height:${h.pedidos / maxPed * 100}%"></em></div>`).join("")}</div>
        <div class="atv-escala" style="margin-top:6px"><span><i class="mk-ponto" style="background:#c7d6ee"></i>alcance</span><span><i class="mk-ponto" style="background:#1b9e5b"></i>pedidos</span></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Vitrine entre produtos</div><div class="card-sub">Blocos que mais aparecem e a taxa de toque</div></div></div>
        ${r.vitrine.length ? mtBarras(r.vitrine.map(b => ({ rotulo: `${b.nome} · ${b.taxa_toque}% de toque`, valor: b.exibicoes })), " exibições") : `<div class="mt-vazio">Sem exibições de blocos no período.</div>`}
        ${Object.keys(r.vitrine_segmentacao).length ? `<div class="mk-comparar" style="margin-top:14px">${["segmentado", "geral"].filter(m => r.vitrine_segmentacao[m]).map(m =>
          `<div><b>${r.vitrine_segmentacao[m].taxa_toque}%</b><span>taxa de toque · blocos ${m === "segmentado" ? "segmentados" : "para todos"} (${r.vitrine_segmentacao[m].exibicoes})</span></div>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">O que procuram</div><div class="card-sub">Buscas digitadas e faladas · em vermelho as que não acharam nada</div></div></div>
        ${mtBarras(r.demanda.buscas.map(b => ({ rotulo: b.termo + (b.sem_resultado ? `  (${b.sem_resultado}× sem resultado)` : ""), valor: b.vezes, cor: b.sem_resultado ? "#c81e33" : undefined })), "×", "Nenhuma busca no período.")}
        ${r.demanda.sintomas.length ? `<div class="vt-secao">Sintomas falados ao assistente</div>${mtBarras(r.demanda.sintomas.map(s => ({ rotulo: s.sintoma, valor: s.vezes, cor: "#7c3aed" })), "×")}` : ""}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Interesse × venda</div><div class="card-sub">Mais vendidos e produtos muito abertos que não venderam</div></div></div>
        ${mtBarras(r.vendas.mais_vendidos.map(p => ({ rotulo: `${p.nome} · ${lojaBRL(p.receita)}`, valor: p.qtd, cor: "#1b6b4e" })), " un", "Nenhuma venda retirada no período.")}
        ${r.interesse_sem_venda.length ? `<div class="vt-secao">Abriram, mas não compraram</div>${mtBarras(r.interesse_sem_venda.map(p => ({ rotulo: p.nome, valor: p.aberturas, cor: "#b45309" })), " aberturas")}` : ""}
        ${r.vendas.categorias.length ? `<div class="vt-secao">Receita por categoria</div>${mtBarras(r.vendas.categorias.map(c => ({ rotulo: c.categoria, valor: c.receita })), "")}` : ""}
      </div>
    </div>
    ${r.demanda.categorias.length ? `<div class="card"><div class="card-head"><div><div class="card-title">Categorias mais navegadas</div><div class="card-sub">Chips de nicho e categoria tocados no totem</div></div></div>
      ${mtBarras(r.demanda.categorias.map(c => ({ rotulo: c.categoria, valor: c.vezes, cor: "#1b8a8f" })), "×")}</div>` : ""}`;
}

function mkExportar() {
  const r = mkDados;
  if (!r) return;
  const cel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["secao", "item", "valor", "periodo_anterior", "variacao_pct"].join(";")];
  for (const [k, v] of Object.entries(r.kpis)) linhas.push(["indicador", k, v.valor, v.anterior, v.variacao].map(cel).join(";"));
  r.funil.forEach(f => linhas.push(["funil", f.etapa, f.valor, "", f.pct_etapa].map(cel).join(";")));
  r.publico.forEach(p => linhas.push(["publico", p.nome, p.pct_publico, `conversao ${p.conversao}%`, `receita ${p.receita}`].map(cel).join(";")));
  r.campanhas.forEach(c => linhas.push(["campanha", c.nome, c.exibicoes, `espectadores ${c.espectadores}`, `atencao/espectador ${c.atencao_por_espectador_s}s · interacao ${c.taxa_interacao}%`].map(cel).join(";")));
  r.demanda.buscas.forEach(b => linhas.push(["busca", b.termo, b.vezes, `sem resultado ${b.sem_resultado}`, ""].map(cel).join(";")));
  r.vendas.mais_vendidos.forEach(p => linhas.push(["mais_vendido", p.nome, p.qtd, `receita ${p.receita}`, ""].map(cel).join(";")));
  r.insights.forEach(i => linhas.push(["insight", i, "", "", ""].map(cel).join(";")));
  const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: `flexmed-marketing-${mkDias}d-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
