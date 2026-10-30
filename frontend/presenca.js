// =====================================================
// FlexMed — acionamento por aproximação (câmera do totem)
// Usa o público medido por audiencia.js (altura do maior rosto no frame) para:
//   - acordar do modo anúncio quando alguém chega perto (e olha) por alguns segundos;
//   - voltar ao modo anúncio quando ninguém está na frente e ninguém toca a tela.
// As regras vêm do painel admin (Câmera & Presença) e são relidas a cada 10 s,
// então ligar/desligar no admin vale sem recarregar o totem.
// =====================================================

const FlexPresenca = (() => {
  // altura do rosto (fração do frame) ≈ CM_POR_ALTURA / distância em cm
  // (rosto ~18 cm e câmera com ~45° de campo vertical)
  const CM_POR_ALTURA = 22;
  const ESPERA_APOS_STANDBY_MS = 8000;   // quem fez o totem dormir não o acorda na hora

  let cfg = { camera: true, ativo: true, distancia_cm: 120, exigir_olhar: true, delay_s: 1.5, ausencia_s: 60 };
  let pertoDesde = null, ausenteDesde = null, ultimoToque = Date.now();

  const distanciaCm = alturaRosto => alturaRosto > 0 ? Math.round(CM_POR_ALTURA / alturaRosto) : null;
  const librasAberto = () => document.getElementById("o-lb")?.classList.contains("on");

  function registrar(tipo, distancia_cm, detalhe = {}) {
    fetch(`${FLEXMED_API_BASE}/presenca/eventos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, distancia_cm, detalhe }),
    }).catch(() => {});
  }

  function aplicarCamera() {
    if (!window.FlexAudiencia) return;
    if (cfg.camera) FlexAudiencia.religar(); else FlexAudiencia.desligar();
  }

  async function carregar() {
    try {
      const r = await fetch(`${FLEXMED_API_BASE}/presenca/config`);
      if (r.ok) cfg = { ...cfg, ...(await r.json()) };
    } catch (_) { /* backend fora: mantém as últimas regras */ }
    aplicarCamera();
  }

  function motivoParado() {
    if (!cfg.camera) return "camera_desligada";
    if (librasAberto()) return "libras_usando_camera";
    if (!FlexAudiencia.ativa()) return "camera_sem_sinal";
    return "";
  }

  function tick() {
    const sb = window.__standby;
    if (!sb || !window.FlexAudiencia) return;
    const agora = Date.now();
    if (motivoParado()) { pertoDesde = ausenteDesde = null; return; }
    const r = FlexAudiencia.retrato();

    if (sb.isActive()) {
      ausenteDesde = null;
      const altura = cfg.exigir_olhar ? r.proximidade_olhando : r.proximidade;
      const perto = cfg.ativo && altura > 0 && distanciaCm(altura) <= cfg.distancia_cm
        && agora - sb.entrouEm >= ESPERA_APOS_STANDBY_MS;
      if (!perto) { pertoDesde = null; return; }
      pertoDesde ??= agora;
      if (agora - pertoDesde >= cfg.delay_s * 1000) {
        pertoDesde = null;
        registrar("acordou", distanciaCm(altura), { olhando: r.olhando, pessoas: r.pessoas, faixa: r.dominante });
        sb.exitNow("aproximacao");
      }
      return;
    }

    pertoDesde = null;
    const limite = cfg.ausencia_s * 1000;
    if (!limite || r.pessoas > 0) { ausenteDesde = null; return; }
    ausenteDesde ??= agora;
    if (agora - ausenteDesde >= limite && agora - ultimoToque >= limite) {
      ausenteDesde = null;
      registrar("ausencia", null, { segundos: cfg.ausencia_s });
      sb.enterNow("ausencia");
    }
  }

  // batida para o painel admin: câmera, modo e pessoa mais próxima agora
  function enviarEstado() {
    const r = window.FlexAudiencia ? FlexAudiencia.retrato() : {};
    fetch(`${FLEXMED_API_BASE}/presenca/estado`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        camera: !!window.FlexAudiencia && FlexAudiencia.ativa(),
        standby: !!window.__standby?.isActive(),
        pessoas: r.pessoas || 0,
        distancia_cm: distanciaCm(r.proximidade || 0),
        motivo: motivoParado(),
      }),
    }).catch(() => {});
  }

  ["pointerdown", "touchstart", "keydown"].forEach(ev =>
    document.addEventListener(ev, () => { ultimoToque = Date.now(); ausenteDesde = null; }, { passive: true, capture: true }));

  function iniciar() {
    carregar();
    setInterval(carregar, 10000);
    setInterval(tick, 250);
    setInterval(enviarEstado, 5000);
  }

  return { iniciar, recarregar: carregar, get config() { return { ...cfg }; } };
})();
window.FlexPresenca = FlexPresenca;

window.addEventListener("load", () => FlexPresenca.iniciar());
