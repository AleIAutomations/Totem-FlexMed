// =====================================================
// FlexMed — câmera do totem → backend
// O navegador do totem captura a câmera (getUserMedia) e envia frames JPEG para
// POST /frame?mode=vision|libras; o backend (notebook) detecta rosto ou
// reconhece Libras e devolve o resultado.
//
// Modo "server": o backend lê a própria câmera (notebook) como antes.
// Padrão: "server" quando a página é aberta no próprio notebook (localhost),
// "browser" quando aberta por outro aparelho (o totem).
// Para forçar, defina window.FLEXMED_CAMERA_MODE = "browser" | "server".
// =====================================================

const FlexCam = (() => {
  const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  const usaNavegador = (window.FLEXMED_CAMERA_MODE || (local ? "server" : "browser")) === "browser";

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");

  const canvas = document.createElement("canvas");
  let stream = null;
  let loopId = 0;
  let ultimoResultado = null;
  // Medições do loop (enviadas ao log do backend a cada 5 s, para diagnóstico no totem)
  let stats = null;
  function novaStats() {
    return { inicio: performance.now(), enviados: 0, vazios: 0, falhas: 0, msCaptura: 0, msEnvio: 0, bytes: 0,
             msDesenho: 0, msCodificacao: 0 };
  }
  function reportarStats(modo) {
    const seg = (performance.now() - stats.inicio) / 1000;
    const n = Math.max(stats.enviados, 1);
    const q = new URLSearchParams({
      camstats: modo,
      fps: (stats.enviados / seg).toFixed(1),
      captura_ms: Math.round(stats.msCaptura / n),
      desenho_ms: Math.round(stats.msDesenho / n),
      jpeg_ms: Math.round(stats.msCodificacao / n),
      envio_ms: Math.round(stats.msEnvio / n),
      kb: Math.round(stats.bytes / n / 1024),
      vazios: stats.vazios,
      falhas: stats.falhas,
      latencia_ms: Math.round(latencia),
      video: `${video.videoWidth}x${video.videoHeight}`,
    });
    fetch(`${FLEXMED_SERVER}/health?${q}`).catch(() => {});
    stats = novaStats();
  }

  async function abrirCamera() {
    if (stream && stream.active) return stream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Fora de HTTPS o navegador nem expõe a API de câmera
      throw new Error("camera_requires_https");
    }
    stream = await pedirCamera();
    video.srcObject = stream;
    await video.play();
    return stream;
  }

  // Câmeras USB no Android às vezes recusam a abertura ("NotReadableError: Could
  // not start video source"): resolução não suportada, câmera ainda presa a uma
  // sessão anterior, ou mais de uma câmera listada. Tenta várias combinações.
  async function pedirCamera() {
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const tentativas = [
      { width: { ideal: 640 }, height: { ideal: 480 } },
      true,  // sem exigir resolução: a câmera escolhe o formato nativo
    ];
    let ultimoErro;
    for (let rodada = 0; rodada < 3; rodada++) {
      for (const video of tentativas) {
        try {
          return await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (err) {
          ultimoErro = err;
          if (err.name === "NotAllowedError") throw err;  // permissão negada: insistir não adianta
        }
      }
      // cada câmera listada, uma por uma (a padrão pode ser uma câmera inválida)
      try {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        for (const cam of cams) {
          try {
            return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId } }, audio: false });
          } catch (err) { ultimoErro = err; }
        }
      } catch (_) { /* enumerateDevices indisponível */ }
      await espera(800 * (rodada + 1));  // dá tempo da câmera ser liberada
    }
    throw ultimoErro;
  }

  // toDataURL (síncrono) em vez de toBlob: no WebView Android dos totens o
  // toBlob codifica em "tempo ocioso" e chegava a levar ~8 s por frame.
  function capturarJpeg() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return Promise.resolve(null);
    const escala = Math.min(1, 480 / Math.max(w, h));
    const cw = Math.round(w * escala), ch = Math.round(h * escala);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const t0 = performance.now();
    canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, cw, ch);
    const t1 = performance.now();
    const b64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
    const t2 = performance.now();
    if (stats) { stats.msDesenho += t1 - t0; stats.msCodificacao += t2 - t1; }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Promise.resolve(new Blob([bytes], { type: "image/jpeg" }));
  }

  // Cada "trabalhador" envia um frame e espera a resposta antes do próximo; com
  // emVoo trabalhadores, a latência da rede (~400-800 ms no totem) não limita a taxa.
  // O backend descarta frames que chegam fora de ordem (parâmetro t).
  //
  // Rede ruim (hotspot congestionado): mais frames em voo só enchem a fila e cada resposta
  // chega mais velha. A latência média (latencia) reduz quantos trabalhadores enviam, e um
  // frame que demora mais que DESISTE_MS é abandonado (a imagem já não vale nada).
  const DESISTE_MS = 4000;
  let latencia = 0;
  const ativos = emVoo => latencia > 2500 ? 1 : latencia > 1200 ? Math.max(2, Math.ceil(emVoo / 2)) : emVoo;

  async function loop(id, k, modo, fps, emVoo, onResultado, params) {
    const intervalo = 1000 / fps * emVoo;
    while (id === loopId) {
      if (k >= ativos(emVoo)) { await new Promise(r => setTimeout(r, 250)); continue; }
      const t0 = performance.now();
      try {
        const capturadoEm = Date.now();
        const jpeg = await capturarJpeg();
        const t1 = performance.now();
        stats.msCaptura += t1 - t0;
        if (!jpeg) stats.vazios++;
        if (jpeg && id === loopId) {
          // params(): extras do frame (ex.: anúncio em exibição e sessão em andamento)
          const extras = params ? new URLSearchParams(params()).toString() : "";
          const desiste = new AbortController();
          const prazo = setTimeout(() => desiste.abort(), DESISTE_MS);
          const res = await fetch(`${FLEXMED_SERVER}/frame?mode=${modo}&t=${capturadoEm}${extras ? "&" + extras : ""}`, {
            method: "POST",
            body: jpeg,
            headers: { "Content-Type": "image/jpeg" },
            signal: desiste.signal,
          }).finally(() => clearTimeout(prazo));
          const ms = performance.now() - t1;
          latencia = latencia ? latencia * 0.8 + ms * 0.2 : ms;
          stats.enviados++;
          stats.bytes += jpeg.size;
          stats.msEnvio += ms;
          if (res.ok && id === loopId) {
            const resultado = await res.json();
            if (!resultado.descartado) {   // frame que chegou fora de ordem: ignora
              ultimoResultado = resultado;
              if (onResultado) onResultado(ultimoResultado);
            }
          } else if (!res.ok) {
            stats.falhas++;
          }
        }
      } catch (_) {
        stats.falhas++;   // rede instável ou frame abandonado: conta como lento e tenta no próximo ciclo
        latencia = Math.max(latencia, DESISTE_MS);
      }
      if (performance.now() - stats.inicio > 5000) reportarStats(modo);
      const espera = intervalo - (performance.now() - t0);
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
    }
  }

  async function iniciar(modo, { fps = 10, emVoo = 4, onResultado = null, params = null } = {}) {
    await abrirCamera();
    ultimoResultado = null;
    stats = novaStats();
    const id = ++loopId;
    latencia = 0;
    for (let k = 0; k < emVoo; k++) {
      setTimeout(() => loop(id, k, modo, fps, emVoo, onResultado, params), k * 1000 / fps);
    }
  }

  function parar() {
    loopId++;
    ultimoResultado = null;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  return {
    usaNavegador,
    video,
    iniciar,
    parar,
    resultado: () => ultimoResultado,
  };
})();
