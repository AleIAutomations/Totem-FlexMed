/**
 * libras_integration.js — LibrasFlow ↔ FlexMed Integration
 *
 * Gerencia a conexão entre o painel de Libras do FlexMed
 * e o backend Python (backend/app.py) que processa a câmera.
 *
 * Configuração: mude LB_SERVER abaixo se o servidor
 * rodar em outra porta ou máquina.
 */

const LB_SERVER = window.FLEXMED_CAMERA_SERVER || FLEXMED_SERVER;

// De onde vem a câmera do Libras (backend: FLEXMED_LIBRAS_CAMERA, em /libras/config):
//   "notebook" (padrão) a pessoa sinaliza em frente ao notebook, que reconhece e manda o vídeo;
//   "totem"    câmera do próprio totem, imagens enviadas pela rede.
// No navegador do próprio notebook o FlexCam já usa a câmera dele, então vale sempre "notebook".
let LB_CAMERA = "notebook";
fetch(`${FLEXMED_SERVER}/libras/config`).then(r => r.json()).then(c => { LB_CAMERA = c.camera || "notebook"; }).catch(() => {});
const _lbCameraDoTotem = () => LB_CAMERA === "totem" && FlexCam.usaNavegador;

// ── Estado local da integração ─────────────────────────────────────────────
const lb = {
  connected: false,
  consulta: 0,           // sessão da consulta de status aberta (ver lbStartPolling)
  video: 0,              // sessão do vídeo quadro a quadro (ver _lbIniciarVideo)
  urlVideo: null,        // blob do quadro em exibição (liberado ao trocar/fechar)
  lastLetra: "",
  lastFrase: "",
};

// ── Elementos do DOM (lazy - resolvidos na primeira chamada) ───────────────
function lbEl(id) { return document.getElementById(id); }

// ── Conexão ao servidor ────────────────────────────────────────────────────

/**
 * Tenta conectar ao servidor Python.
 * Chamado pelo botão "Conectar" e automaticamente ao abrir o painel.
 */
async function lbConnect() {
  const btn = document.querySelector(".lb-connect-btn");
  if (btn) { btn.textContent = "Conectando..."; btn.disabled = true; }
  if (_lbCameraDoTotem()) return _lbConnectCameraTotem(btn);

  try {
    if (window.__standby && typeof window.__standby.exitNow === "function") window.__standby.exitNow();
    await fetch(`${LB_SERVER}/vision_stop`, { method: "POST" }).catch(() => {});
    await fetch(`${LB_SERVER}/libras_start`, { method: "POST" }).catch(() => {});
    const res = await fetch(`${LB_SERVER}/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error("server_error");

    // Sucesso — exibe o stream
    _lbShowStream();
    lbStartPolling();
    if (FlexCam.usaNavegador) _lbSetStatus("Faça a letra em frente à câmera do notebook.");

  } catch {
    if (btn) { btn.textContent = "Tentar novamente"; btn.disabled = false; }
    _lbSetStatus("Servidor indisponível. Verifique se o FlexMed está rodando no notebook.");
  }
}

/**
 * Câmera do totem: mostra o vídeo local e envia frames ao backend, que devolve
 * a letra/palavra reconhecida e a frase a cada frame.
 */
// Registra no log do backend o resultado da câmera (diagnóstico no totem, sem console)
async function _lbDiagnosticoCamera(resultado) {
  let cameras = "?";
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    cameras = devs.filter(d => d.kind === "videoinput").length;
  } catch (_) { /* API indisponível */ }
  const q = new URLSearchParams({ camera: resultado, cameras, seguro: String(window.isSecureContext) });
  fetch(`${FLEXMED_SERVER}/health?${q}`).catch(() => {});
}

async function _lbConnectCameraTotem(btn) {
  try {
    if (window.__standby && typeof window.__standby.exitNow === "function") window.__standby.exitNow();
    // 8 envios em paralelo: o servidor rastreia a mão em ~10 ms, então quem limita é a
    // latência da rede do totem (~600 ms); com 4 a taxa ficava em ~6 quadros/s
    await FlexCam.iniciar("libras", { fps: 15, emVoo: 8, onResultado: _lbAplicarStatus });
    _lbDiagnosticoCamera("ok");
  } catch (err) {
    _lbDiagnosticoCamera(`${err && err.name}: ${err && err.message}`);
    if (btn) { btn.textContent = "Tentar novamente"; btn.disabled = false; }
    const msg = `${err && err.name} ${err && err.message}`;
    const [titulo, dica] =
      msg.includes("https") ? ["Câmera bloqueada", "Abra o FlexMed pelo endereço https://."] :
      msg.includes("NotAllowed") ? ["Acesso à câmera negado", "No Fully Kiosk: Settings > Web Content Settings > Enable Webcam Access."] :
      msg.includes("NotFound") ? ["Nenhuma câmera encontrada", "Verifique se a câmera USB está conectada ao totem."] :
      msg.includes("NotReadable") ? ["Câmera em uso", "Outro app está usando a câmera. Feche-o e tente de novo."] :
      ["Não foi possível abrir a câmera", msg];
    const txt = lbEl("lb-offline-txt"), hint = lbEl("lb-offline-hint");
    if (txt) txt.textContent = titulo;
    if (hint) hint.textContent = dica;
    _lbSetStatus(`${titulo}. ${dica}`);
    return;
  }

  const stream  = lbEl("lb-stream");
  const offline = lbEl("lb-offline");
  const badge   = lbEl("lb-conn-badge");
  const video   = FlexCam.video;
  if (stream && !video.parentNode) {
    video.className = "lb-stream lb-video";
    stream.parentNode.insertBefore(video, stream);
    const overlay = document.createElement("canvas");
    overlay.id = "lb-tracking";
    overlay.className = "lb-tracking";
    stream.parentNode.insertBefore(overlay, stream);
  }
  video.style.display = "block";
  if (stream)  stream.style.display = "none";
  if (offline) offline.style.display = "none";
  if (badge)   badge.style.display   = "flex";
  lb.connected = true;
  _lbSetStatus("Faça o sinal em frente à câmera.");
}

/** Exibe o vídeo da câmera do notebook e esconde o estado offline. */
function _lbShowStream() {
  const stream  = lbEl("lb-stream");
  const offline = lbEl("lb-offline");
  const badge   = lbEl("lb-conn-badge");

  if (!stream) return;

  stream.style.display = "block";
  if (offline) offline.style.display = "none";
  if (badge)   badge.style.display   = "flex";

  lb.connected = true;
  _lbIniciarVideo(stream);
}

/**
 * Vídeo da câmera do notebook quadro a quadro (/libras/quadro?depois=N): cada pedido traz o
 * quadro mais recente, então a imagem nunca fica velha, e funciona em qualquer navegador.
 * Antes era um MJPEG num <img> (uma conexão longa): no navegador do totem a imagem congelava.
 * Dois pedidos em voo, defasados, para a taxa não depender só da latência da rede.
 */
function _lbIniciarVideo(img) {
  const sessao = ++lb.video;
  let ultimo = -1, exibido = -1, semQuadro = 0, quadros = 0, desde = performance.now();
  const pausa = ms => new Promise(r => setTimeout(r, ms));

  const trabalhador = async atraso => {
    await pausa(atraso);
    while (lb.video === sessao && lb.connected) {
      try {
        const res = await fetch(`${LB_SERVER}/libras/quadro?depois=${ultimo}`,
                                { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (res.status === 204) {
          // câmera abrindo, ou desligada por falta de pedidos (rede caiu): religa a cada ~3 s
          if (++semQuadro % 10 === 0) fetch(`${LB_SERVER}/libras_start`, { method: "POST" }).catch(() => {});
          await pausa(300);
          continue;
        }
        const seq = Number(res.headers.get("X-Quadro"));
        const blob = await res.blob();
        if (lb.video !== sessao || seq <= ultimo) continue;   // o outro pedido já trouxe um mais novo
        ultimo = seq;
        semQuadro = 0;
        // decodifica antes de trocar: a troca no <img> fica instantânea (sem piscar nem engasgar)
        const url = URL.createObjectURL(blob);
        const pronta = new Image();
        pronta.src = url;
        try { await pronta.decode(); } catch { URL.revokeObjectURL(url); continue; }
        if (lb.video !== sessao || seq <= exibido) { URL.revokeObjectURL(url); continue; }
        exibido = seq;
        img.src = url;
        if (lb.urlVideo) URL.revokeObjectURL(lb.urlVideo);
        lb.urlVideo = url;
        // diagnóstico no log do servidor: quadros por segundo exibidos no totem
        quadros++;
        if (performance.now() - desde > 10000) {
          fetch(`${LB_SERVER}/health?camstats=libras_notebook&fps=${(quadros * 1000 / (performance.now() - desde)).toFixed(1)}`).catch(() => {});
          quadros = 0;
          desde = performance.now();
        }
      } catch {
        await pausa(400);   // rede instável ou pedido abandonado: pede de novo
      }
    }
  };
  trabalhador(0);
  trabalhador(60);
}

// ── Resultado: /status com espera ──────────────────────────────────────────
// Uma consulta fica aberta no servidor e volta assim que a letra ou a frase mudam (ou após
// 8 s sem novidade); em seguida abre a próxima. Antes eram consultas a cada 400 ms com limite
// de 800 ms: pela rede do totem a maioria estourava o limite e a letra aparecia travada.

function lbStartPolling() {
  const minha = ++lb.consulta;
  (async () => {
    let versao = -1;
    while (lb.consulta === minha && lb.connected) {
      try {
        const res  = await fetch(`${LB_SERVER}/status?versao=${versao}&espera=8`, { signal: AbortSignal.timeout(12000) });
        const data = await res.json();
        if (lb.consulta !== minha) break;
        _lbAplicarStatus(data);
        if (data.versao === undefined) await new Promise(r => setTimeout(r, 400));   // backend sem espera
        else versao = data.versao;
      } catch {
        await new Promise(r => setTimeout(r, 600));   // rede instável: tenta de novo em seguida
      }
    }
  })();
}

function lbStopPolling() {
  lb.consulta++;   // a consulta aberta termina e não abre outra
}

// Ligações entre os pontos (rosto, postura, mãos) — vêm do backend, iguais às
// usadas no desenho da câmera do notebook (MediaPipe Holistic)
let LB_CONEXOES = null;
fetch(`${FLEXMED_SERVER}/libras/conexoes`).then(r => r.json()).then(c => { LB_CONEXOES = c; }).catch(() => {});

/** Desenha rosto, postura e mãos detectados pelo backend sobre o vídeo do totem. */
function _lbDesenharPontos(pontos) {
  const cv = lbEl("lb-tracking");
  const video = FlexCam.video;
  if (!cv) return;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (!pontos || !LB_CONEXOES || !video.videoWidth) return;

  // O vídeo usa object-fit: cover; o frame processado já vem espelhado, igual à tela
  const esc = Math.max(w / video.videoWidth, h / video.videoHeight);
  const ox = (w - video.videoWidth * esc) / 2, oy = (h - video.videoHeight * esc) / 2;
  const P = p => [ox + p[0] * video.videoWidth * esc, oy + p[1] * video.videoHeight * esc];

  const linhas = (pts, conexoes, cor, largura, visivel = () => true) => {
    ctx.strokeStyle = cor; ctx.lineWidth = largura;
    ctx.beginPath();
    for (const [a, b] of conexoes) {
      if (!pts[a] || !pts[b] || !visivel(pts[a]) || !visivel(pts[b])) continue;
      const [x1, y1] = P(pts[a]), [x2, y2] = P(pts[b]);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };
  const bolinhas = (pts, idxs, cor, raio, visivel = () => true) => {
    ctx.fillStyle = cor;
    for (const i of idxs) {
      if (!pts[i] || !visivel(pts[i])) continue;
      const [x, y] = P(pts[i]);
      ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.fill();
    }
  };

  // Rosto: contornos (olhos, sobrancelhas, lábios, oval)
  if (pontos.rosto && pontos.rosto.length) {
    linhas(pontos.rosto, LB_CONEXOES.rosto, "rgba(235, 240, 255, 0.75)", 1.2);
  }
  // Postura: tronco, braços e cabeça; lado esquerdo laranja, direito azul
  const pose = pontos.pose || [];
  if (pose.length) {
    const vis = p => (p[2] ?? 1) > 0.5;
    linhas(pose, LB_CONEXOES.pose, "rgba(255, 255, 255, 0.85)", 2.5, vis);
    const impares = [], pares = [];
    for (let i = 0; i <= 24; i++) (i % 2 ? impares : pares).push(i);
    bolinhas(pose, impares, "#ff8a00", 4, vis);   // lado esquerdo do corpo
    bolinhas(pose, pares, "#00b4ff", 4, vis);     // lado direito do corpo
  }
  // Mãos: ligações coloridas e articulações brancas
  const todos = [...Array(21).keys()];
  for (const [mao, cor] of [[pontos.mao_esq, "#f0506e"], [pontos.mao_dir, "#2ee59d"]]) {
    if (!mao || !mao.length) continue;
    linhas(mao, LB_CONEXOES.mao, cor, 3);
    bolinhas(mao, todos, "#ffffff", 3.5);
  }
}

function _lbAplicarStatus(data) {
  if (!data) return;
  if (_lbCameraDoTotem()) _lbDesenharPontos(data.pontos);

  // Atualiza a frase
  if (data.frase !== lb.lastFrase) {
    lb.lastFrase = data.frase;
    _lbUpdateFrase(data.frase);
  }

  // Atualiza a letra detectada
  if (data.ultima_letra !== lb.lastLetra) {
    lb.lastLetra = data.ultima_letra;
    _lbUpdateLetraBadge(data.ultima_letra);
    if (data.ultima_letra) {
      _lbSetStatus(`Detectando: ${data.ultima_letra}`);
    }
  }
}

// ── Atualização de UI ──────────────────────────────────────────────────────

function _lbUpdateFrase(frase) {
  const el = lbEl("lb-frase-txt");
  if (!el) return;
  el.textContent = frase || "---";

  // Atualiza também o campo de tradução (mantém compatibilidade com lbSel)
  if (frase) {
    const result = lbEl("lb-result");
    const text   = lbEl("lb-text");
    if (result) result.classList.add("on");
    if (text)   text.textContent = `Frase reconhecida: "${frase}"`;
  }
}

function _lbUpdateLetraBadge(letra) {
  const badge = lbEl("lb-letter-badge");
  const char  = lbEl("lb-letter-char");
  if (!badge) return;

  if (letra) {
    badge.style.display = "flex";
    badge.classList.toggle("lb-word", letra.length > 1);
    if (char) char.textContent = letra;
    // Re-aciona animação
    badge.style.animation = "none";
    badge.offsetHeight;    // reflow
    badge.style.animation = "";
  } else {
    badge.style.display = "none";
  }
}

function _lbSetStatus(msg) {
  const el = lbEl("lb-st");
  if (el) el.textContent = msg;
}

// ── Ações dos botões ───────────────────────────────────────────────────────

/** Apaga o último caractere da frase (via servidor). */
async function lbBackspace() {
  if (!lb.connected) return;
  try {
    const res  = await fetch(`${LB_SERVER}/backspace`, { method: "POST" });
    const data = await res.json();
    if (data.frase !== undefined) {
      lb.lastFrase = data.frase;
      _lbUpdateFrase(data.frase);
    }
  } catch { /* silencioso */ }
}

/** Limpa a frase inteira (via servidor). */
async function lbClearFrase() {
  if (!lb.connected) {
    // Limpa apenas o display local
    lb.lastFrase = "";
    _lbUpdateFrase("");
    return;
  }
  try {
    await fetch(`${LB_SERVER}/clear`, { method: "POST" });
    lb.lastFrase = "";
    lb.lastLetra = "";
    _lbUpdateFrase("");
    _lbUpdateLetraBadge("");
    _lbSetStatus("Frase limpa.");
  } catch { /* silencioso */ }
}

/** Busca o produto digitado na frase no campo de busca do FlexMed. */
function lbBuscarFrase() {
  const frase = lb.lastFrase.trim();
  if (!frase) return;

  // Fecha o painel de Libras
  if (typeof closeOv === "function") closeOv("o-lb");

  // Preenche a busca e aciona
  const input = document.getElementById("s-in");
  if (input) {
    input.value = frase;
    if (typeof onSrch === "function") onSrch(frase);
  }

  // Sobe a métrica de libras
  if (typeof incMetric === "function") incMetric("libras");
}

// ── Lifecycle: abre/fecha painel ───────────────────────────────────────────

/**
 * Chama ao abrir o overlay de Libras.
 * Tenta conexão automática (se ainda não conectado).
 */
function lbPanelOpen() {
  // o Libras precisa da câmera: pausa a medição de audiência enquanto o painel está aberto
  if (window.FlexAudiencia) FlexAudiencia.pausar();
  if (!lb.connected) {
    // Tenta conectar automaticamente com timeout curto
    lbConnect().catch(() => {});
  } else {
    lbStartPolling();
  }
}

/**
 * Chama ao fechar o overlay de Libras.
 * Para o polling para não desperdiçar requisições.
 */
function lbPanelClose() {
  lbStopPolling();
  if (_lbCameraDoTotem()) {
    // Libera a câmera do totem
    FlexCam.parar();
    FlexCam.video.style.display = "none";
    _lbDesenharPontos(null);
  } else {
    // Câmera do notebook: para o vídeo quadro a quadro, desliga a câmera e solta o <img>;
    // sem isso a última imagem ficava congelada ao reabrir o painel
    lb.video++;
    fetch(`${LB_SERVER}/libras_stop`, { method: "POST" }).catch(() => {});
    const stream = lbEl("lb-stream");
    if (stream) { stream.onerror = null; stream.removeAttribute("src"); stream.style.display = "none"; }
    if (lb.urlVideo) { URL.revokeObjectURL(lb.urlVideo); lb.urlVideo = null; }
  }
  // Volta ao estado inicial: ao reabrir, conecta de novo com um vídeo novo
  const offline = lbEl("lb-offline");
  const badge   = lbEl("lb-conn-badge");
  const btn     = document.querySelector(".lb-connect-btn");
  if (offline) offline.style.display = "flex";
  if (badge)   badge.style.display   = "none";
  if (btn) { btn.textContent = "Conectar"; btn.disabled = false; }
  lb.connected = false;
  // a câmera de audiência volta depois que o Libras soltou a câmera
  if (window.FlexAudiencia) setTimeout(() => FlexAudiencia.retomar(), 600);
}

// ── Hook no openOv / closeOv existentes ───────────────────────────────────
// Aguarda o DOM carregar e então "envolve" as funções existentes.
document.addEventListener("DOMContentLoaded", () => {
  // Garante que as funções do script.js já existam antes de fazer o wrap
  const _origOpen  = window.openOv;
  const _origClose = window.closeOv;

  if (typeof _origOpen === "function") {
    window.openOv = function(id) {
      _origOpen(id);
      if (id === "o-lb") lbPanelOpen();
    };
  }

  if (typeof _origClose === "function") {
    window.closeOv = function(id) {
      _origClose(id);
      if (id === "o-lb") lbPanelClose();
    };
  }
});