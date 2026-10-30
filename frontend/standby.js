// standby.js — Gerenciador do modo standby (anúncios)
// A audiência (câmera) fica sempre ligada em audiencia.js; aqui só se controla
// o player de anúncios e o início/fim das sessões de uso.

class StandbyManager {
  constructor({ timeoutSeconds = 300, onEnter, onExit } = {}) {
    this._timeoutMs  = timeoutSeconds * 1000;
    this._onEnter    = onEnter || (() => {});
    this._onExit     = onExit  || (() => {});
    this._timer      = null;
    this._active     = false;
    this._player     = null;
    this._clockTick  = null;

    this._overlay      = null;
    this._playerContainer = null;
    this._standbyClockEl  = null;

    // Bound refs guardados para poder remover os listeners depois
    this._boundHandleTouch = this._handleTouch.bind(this);
    this._boundHandleExit  = this._handleExit.bind(this);

    this._bindUserEvents();
  }

  // ── Configuração ────────────────────────────────────────────────────────────

  configure(timeoutSeconds) {
    this._timeoutMs = timeoutSeconds * 1000;
    this._resetTimer();
  }

  start() { this._resetTimer(); }

  stop() {
    clearTimeout(this._timer);
    if (this._active) this._exit();
  }

  isActive() { return this._active; }

  // origem: como a sessão de uso começa (ex.: "aproximacao" quando a câmera acordou o totem)
  exitNow(origem) { this._exit(false, origem); }

  // motivo: por que a sessão anterior terminou (ex.: "ausencia" quando a câmera não vê ninguém)
  enterNow(motivo) { clearTimeout(this._timer); this._enter(motivo); }

  get entrouEm() { return this._entrouEm || 0; }

  // ── Detecção de inatividade ─────────────────────────────────────────────────

  _bindUserEvents() {
    const reset = () => { if (!this._active) this._resetTimer(); };
    ['touchstart', 'touchmove', 'mousedown', 'keydown']
      .forEach(ev => document.addEventListener(ev, reset, { passive: true }));
  }

  _resetTimer() {
    clearTimeout(this._timer);
    if (this._timeoutMs <= 0) return;
    this._timer = setTimeout(() => this._enter(), this._timeoutMs);
  }

  // ── Entrada no standby ──────────────────────────────────────────────────────

  async _enter(motivo = 'inatividade') {
    if (this._active) return;
    this._active = true;
    this._entrouEm = Date.now();

    // quem estava usando foi embora: encerra a sessão (desistência ou finalização)
    if (window.FlexSessao) FlexSessao.finalizar(motivo);

    this._overlay         = document.getElementById('standby-overlay');
    this._playerContainer = document.getElementById('standby-player-container');
    this._standbyClockEl  = document.getElementById('standby-clock');

    if (!this._overlay) { this._active = false; return; }

    // Atualiza nome da marca no overlay
    const brandEl = document.getElementById('standby-brand');
    if (brandEl && window.config?.brand) brandEl.textContent = window.config.brand;

    // Mostra overlay
    this._overlay.classList.add('standby-visible');

    // Inicia player
    if (this._playerContainer) {
      this._player = new CampaignPlayer(this._playerContainer);
      await this._player.loadCampaigns();
      this._player.start();
    }

    // Relógio interno do standby
    this._startClock();

    // Rastreia toques para heatmap (antes de sair do standby)
    this._overlay.addEventListener('touchstart', this._boundHandleTouch, { passive: true });
    this._overlay.addEventListener('mousedown',  this._boundHandleTouch);

    // Listener de saída: qualquer toque sai do standby
    this._overlay.addEventListener('touchstart', this._boundHandleExit, { once: true, passive: true });
    this._overlay.addEventListener('mousedown',  this._boundHandleExit, { once: true });

    this._onEnter();
    console.log('📺 Standby ativado');
  }

  // ── Saída do standby ────────────────────────────────────────────────────────

  _handleTouch(e) {
    try {
      const rect = this._overlay.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const xPct = +((clientX - rect.left) / rect.width * 100).toFixed(2);
      const yPct = +((clientY - rect.top)  / rect.height * 100).toFixed(2);
      const campaign = this._player?.currentCampaign();
      apiSaveTouchPoint(xPct, yPct, campaign?.id || null).catch(() => {});
    } catch (_) {}
  }

  _handleExit(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    this._exit(true);
  }

  // interagiu = saiu por um toque na tela (durante um anúncio)
  _exit(interagiu = false, origem = null) {
    if (!this._active) return;
    this._active = false;
    const anuncio = this._player?.currentCampaign();

    if (this._overlay) {
      this._overlay.classList.remove('standby-visible');
      this._overlay.removeEventListener('touchstart', this._boundHandleTouch);
      this._overlay.removeEventListener('mousedown',  this._boundHandleTouch);
      this._overlay.removeEventListener('touchstart', this._boundHandleExit);
      this._overlay.removeEventListener('mousedown',  this._boundHandleExit);
    }

    if (this._player) { this._player.stop({ interagiu }); this._player = null; }

    this._stopClock();
    this._resetTimer();
    // começa uma sessão de uso: o toque veio de um anúncio na tela ou não
    if (window.FlexSessao) FlexSessao.iniciar(origem || (interagiu && anuncio ? 'anuncio' : 'toque'));
    this._onExit();
    console.log('👆 Standby desativado');
  }

  // ── Relógio interno ─────────────────────────────────────────────────────────

  _startClock() {
    const tick = () => {
      if (!this._standbyClockEl) return;
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      this._standbyClockEl.textContent = `${h}:${m}`;
    };
    tick();
    this._clockTick = setInterval(tick, 30_000);
  }

  _stopClock() {
    clearInterval(this._clockTick);
    this._clockTick = null;
  }
}

// ── Inicialização global ────────────────────────────────────────────────────────

window.__standby = null;

/**
 * Inicializa (ou reonfigura) o gerenciador de standby.
 * Chamada pelo script.js após carregar as configurações do tenant.
 */
function initStandby(timeoutSeconds = 300) {
  if (window.__standby) {
    window.__standby.configure(timeoutSeconds);
    return;
  }
  window.__standby = new StandbyManager({ timeoutSeconds });
  window.__standby.start();
}
