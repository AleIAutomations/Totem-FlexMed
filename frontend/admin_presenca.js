// =====================================================
// FlexMed Admin — Câmera & Presença (backend/presenca.py)
// A câmera do totem acorda a tela quando alguém se aproxima e devolve ao modo
// anúncio quando não há ninguém. As regras salvas aqui valem no totem em até 10 s.
// =====================================================

const PR_ESCALA_CM = 300;          // fim da régua de distância
let prTimer = null, prConfig = null, prUltimaDistancia = null;

const prMotivos = {
  camera_desligada: "Câmera desligada no painel",
  libras_usando_camera: "Em uso pelo atendimento em Libras",
  camera_sem_sinal: "Sem imagem da câmera (permissão ou cabo)",
};

async function prSalvar(mudanca, aviso) {
  try {
    const r = await fetch(`${FLEXMED_SERVER}/api/presenca/config`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mudanca),
    });
    if (!r.ok) throw new Error(r.status);
    prConfig = await r.json();
    prRenderRegras();
    if (aviso) toast(`${aviso} — o totem aplica em até 10 s.`);
  } catch (_) {
    toast("Não foi possível salvar: backend do totem offline.");
    prRenderRegras();   // volta os controles para o valor salvo
  }
}

function prChave(id, ligado, aviso) {
  return `<label class="toggle-sw"><input type="checkbox" ${ligado ? "checked" : ""}
    onchange="prSalvar({${id}: this.checked}, this.checked ? '${aviso} ligado' : '${aviso} desligado')"/><span class="toggle-track"></span></label>`;
}

function prRenderRegras() {
  const el = document.getElementById("pr-regras");
  if (!el || !prConfig) return;
  const c = prConfig, semCamera = !c.camera, semAcordar = semCamera || !c.ativo;
  el.innerHTML = `
    <div class="pr-regra">
      <div><div class="pr-regra-t">Câmera do totem</div>
        <div class="pr-regra-s">Liga a visão do totem (presença e audiência dos anúncios). Desligada, só o Libras usa a câmera.</div></div>
      ${prChave("camera", c.camera, "Câmera do totem")}
    </div>
    <div class="pr-regra ${semCamera ? "off" : ""}">
      <div><div class="pr-regra-t">Acordar ao se aproximar</div>
        <div class="pr-regra-s">Sai dos anúncios e mostra a tela inicial quando alguém chega perto.</div></div>
      ${prChave("ativo", c.ativo, "Acordar por aproximação")}
    </div>
    <div class="pr-regra pr-regra-bloco ${semAcordar ? "off" : ""}">
      <div class="pr-regra-topo"><div><div class="pr-regra-t">Distância para acordar</div>
        <div class="pr-regra-s">Estimada pelo tamanho do rosto na câmera.</div></div><b id="pr-dist-v">até ${c.distancia_cm} cm</b></div>
      <input type="range" min="40" max="300" step="10" value="${c.distancia_cm}"
        oninput="document.getElementById('pr-dist-v').textContent='até '+this.value+' cm'"
        onchange="prSalvar({distancia_cm: +this.value}, 'Distância salva')"/>
      <div class="pr-escala"><span>40 cm (bem perto)</span><span>3 m (longe)</span></div>
      <button type="button" class="pr-calibrar" id="pr-calibrar" onclick="prCalibrar()" disabled>Usar a distância de quem está na frente agora</button>
    </div>
    <div class="pr-regra ${semAcordar ? "off" : ""}">
      <div><div class="pr-regra-t">Só acordar se a pessoa olhar para a tela</div>
        <div class="pr-regra-s">Evita acordar com quem só passa de lado.</div></div>
      ${prChave("exigir_olhar", c.exigir_olhar, "Exigir olhar")}
    </div>
    <div class="pr-regra pr-regra-bloco ${semAcordar ? "off" : ""}">
      <div class="pr-regra-topo"><div><div class="pr-regra-t">Tempo de presença antes de acordar</div>
        <div class="pr-regra-s">A pessoa precisa ficar perto por esse tempo.</div></div><b id="pr-delay-v">${prSegundos(c.delay_s)}</b></div>
      <input type="range" min="0.5" max="10" step="0.5" value="${c.delay_s}"
        oninput="document.getElementById('pr-delay-v').textContent=prSegundos(+this.value)"
        onchange="prSalvar({delay_s: +this.value}, 'Tempo de presença salvo')"/>
      <div class="pr-escala"><span>0,5 s (imediato)</span><span>10 s (conservador)</span></div>
    </div>
    <div class="pr-regra ${semCamera ? "off" : ""}">
      <div><div class="pr-regra-t">Voltar aos anúncios sem ninguém na frente</div>
        <div class="pr-regra-s">Sem pessoa na câmera e sem toque na tela por esse tempo.</div></div>
      <select class="form-input form-select" style="width:auto;font-size:12px"
        onchange="prSalvar({ausencia_s: +this.value}, 'Retorno automático salvo')">
        ${[[30, "30 s"], [60, "1 min"], [120, "2 min"], [300, "5 min"], [0, "Nunca"]].map(([v, t]) =>
          `<option value="${v}" ${c.ausencia_s === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>`;
  prAtualizarCalibrar();
}

function prSegundos(s) {
  return `${String(s).replace(".", ",")} ${s === 1 ? "segundo" : "segundos"}`;
}

function prAtualizarCalibrar() {
  const b = document.getElementById("pr-calibrar");
  if (!b) return;
  b.disabled = !prUltimaDistancia;
  b.textContent = prUltimaDistancia
    ? `Usar a distância de quem está na frente agora (~${prUltimaDistancia} cm)`
    : "Usar a distância de quem está na frente agora (ninguém na câmera)";
}

function prCalibrar() {
  if (!prUltimaDistancia) return;
  // um pouco de folga para a pessoa não precisar ficar exatamente no mesmo ponto
  const cm = Math.min(300, Math.max(40, Math.round(prUltimaDistancia * 1.1 / 10) * 10));
  prSalvar({ distancia_cm: cm }, `Distância ajustada para ${cm} cm`);
}

function prBadge(cor, texto) {
  return `<span class="badge badge-${cor}" style="white-space:nowrap"><span class="badge-dot"></span>${mtEsc(texto)}</span>`;
}

function prRenderAoVivo(st) {
  const el = document.getElementById("pr-ao-vivo");
  if (!el) return;
  const t = st.totem || {}, c = st.config;
  prUltimaDistancia = t.online && t.camera ? t.distancia_cm : null;
  prAtualizarCalibrar();
  if (!t.online) {
    el.innerHTML = `<div class="mt-ao-vivo-titulo">Totem offline</div>
      <div class="mt-legenda" style="margin-top:6px">${t.visto_ha_s != null ? `Última conexão há ${mtSeg(t.visto_ha_s)}.` : "O totem ainda não se conectou."}
      Abra o totem (Fully Kiosk) para as regras valerem.</div>`;
    return;
  }
  const camera = !c.camera ? prBadge("red", "Desligada")
    : t.camera ? prBadge("green", "Com imagem") : prBadge("amber", prMotivos[t.motivo] || "Sem imagem");
  const dist = t.distancia_cm;
  const pos = dist ? Math.min(100, dist / PR_ESCALA_CM * 100) : null;
  el.innerHTML = `
    <div class="mt-ao-vivo-titulo"><span class="mt-pulso"></span>Totem agora</div>
    <div class="mt-ao-vivo-nums">
      <div><b>${t.standby ? "Anúncios" : "Em uso"}</b><span>tela</span></div>
      <div><b>${t.pessoas}</b><span>pessoas na câmera</span></div>
      <div><b>${dist ? `~${dist} cm` : "—"}</b><span>pessoa mais próxima</span></div>
      <div><span style="margin-bottom:6px">câmera</span>${camera}</div>
    </div>
    <div class="pr-medidor">
      <div class="pr-medidor-zona" style="width:${c.distancia_cm / PR_ESCALA_CM * 100}%"></div>
      ${pos != null ? `<div class="pr-medidor-pessoa" style="left:${pos}%"></div>` : ""}
    </div>
    <div class="pr-medidor-legenda"><span>totem</span><span>zona que acorda: até ${c.distancia_cm} cm${c.ativo && c.camera ? "" : " (desligada)"}</span><span>3 m</span></div>`;
}

const PR_EVENTOS = {
  acordou: ["green", "Acordou por aproximação"],
  ausencia: ["blue", "Voltou aos anúncios"],
};

function prRenderResumo(st) {
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set("pr-stats", `
    ${mtCard("Acordou por aproximação hoje", st.hoje.acordou, "a câmera iniciou o atendimento", "emerald")}
    ${mtCard("Voltou aos anúncios hoje", st.hoje.ausencia, "ninguém na frente nem tocando")}
    ${mtCard("Pessoas que passaram hoje", st.hoje.passaram, "vistas pela câmera do totem")}`);
  set("pr-grafico", mtColunasHora(st.acordou_por_hora, "n", "acionamentos"));
  set("pr-eventos", st.eventos.length ? st.eventos.map(e => {
    const [cor, nome] = PR_EVENTOS[e.tipo] || ["blue", e.tipo];
    const d = e.detalhe || {};
    const det = e.tipo === "acordou"
      ? `${d.olhando ?? 0} olhando${d.faixa ? ` · ${MT_FAIXAS[d.faixa] || d.faixa}` : ""}`
      : `${d.segundos || "?"} s sem ninguém`;
    return `<tr><td class="td-mono">${new Date(e.ts * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
      <td>${prBadge(cor, nome)}</td><td class="td-mono">${e.distancia_cm ? `~${e.distancia_cm} cm` : "—"}</td>
      <td style="font-size:12px">${mtEsc(det)}</td></tr>`;
  }).join("") : `<tr><td colspan="4"><div class="mt-vazio">Nenhum acionamento ainda.</div></td></tr>`);
}

async function carregarPresenca() {
  const alvo = document.getElementById("pres-painel");
  if (!alvo) return;
  const st = await mtGet("/api/presenca/status");
  if (!st) { alvo.innerHTML = `<div class="mt-vazio">Não foi possível carregar os dados do totem.</div>`; return; }
  prConfig = st.config;
  alvo.innerHTML = `
    <div class="mt-cabecalho"><div class="mt-legenda">A câmera do totem percebe quando alguém se aproxima e sai dos anúncios
      para a tela inicial. A distância é estimada pelo tamanho do rosto; nenhuma imagem é gravada.</div></div>
    <div class="card mt-ao-vivo" id="pr-ao-vivo"></div>
    <div class="stat-row" style="grid-template-columns:repeat(3,1fr)" id="pr-stats"></div>
    <div class="grid-2" style="margin-bottom:20px;align-items:start">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Regras de acionamento</div>
          <div class="card-sub">Salvas na hora; o totem aplica em até 10 s</div></div></div>
        <div class="pr-regras" id="pr-regras"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px">
        <div class="card">
          <div class="card-head"><div><div class="card-title">Acionamentos por hora — hoje</div>
            <div class="card-sub">Vezes que a câmera acordou o totem</div></div></div>
          <div id="pr-grafico"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">Eventos de presença</div>
            <div class="card-sub">Últimos 40 acionamentos</div></div></div>
          <div class="tbl-wrap" style="max-height:320px;overflow:auto"><table>
            <thead><tr><th>Hora</th><th>Evento</th><th>Distância</th><th>Detalhe</th></tr></thead>
            <tbody id="pr-eventos"></tbody>
          </table></div>
        </div>
      </div>
    </div>`;
  prRenderRegras();
  prRenderAoVivo(st);
  prRenderResumo(st);
  clearInterval(prTimer);
  prTimer = setInterval(prAtualizar, 3000);
}

async function prAtualizar() {
  if (!document.getElementById("p-iot")?.classList.contains("on")) { clearInterval(prTimer); return; }
  const st = await mtGet("/api/presenca/status");
  if (!st) return;
  prRenderAoVivo(st);
  prRenderResumo(st);
}
