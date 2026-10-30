// =====================================================
// FlexMed — captura de voz do assistente
// Grava o microfone (MediaRecorder), para sozinho quando a pessoa termina de
// falar (detecção de silêncio) e envia o áudio para POST /api/assistente/voz,
// que transcreve (Whisper, no notebook) e busca os produtos.
// O reconhecimento de voz nativo do navegador não existe no WebView do Android
// (Fully Kiosk), por isso a transcrição é feita no backend.
// =====================================================

const FlexVoz = (() => {
  const LIMIAR_VOZ = 0.025;     // volume (RMS) acima disso conta como fala
  const SILENCIO_FIM_MS = 1300; // silêncio depois da fala que encerra a gravação
  const MAX_MS = 8000;          // duração máxima da gravação
  const SEM_FALA_MS = 5000;     // desiste se ninguém falar nesse tempo
  const PARCIAL_MS = 1000;      // intervalo do texto "ao vivo" enquanto a pessoa fala

  let gravando = false;
  let cancelar = null;

  function tipoAudio() {
    const opcoes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    return opcoes.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  /**
   * Grava uma fala e devolve o resultado do backend.
   * onEstado(estado): "ouvindo" | "processando"; onVolume(0..1) para animar o botão;
   * onParcial(texto): rascunho da transcrição enquanto a pessoa ainda fala.
   */
  async function ouvir({ onEstado = () => {}, onVolume = () => {}, onParcial = () => {} } = {}) {
    if (gravando) return null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      throw new Error("microfone_indisponivel");
    }
    gravando = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).catch(err => { gravando = false; throw err; });

    const mime = tipoAudio();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const partes = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };

    // Medidor de volume para detectar fala e silêncio
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analisador);
    const amostras = new Float32Array(analisador.fftSize);

    const fim = new Promise(resolve => { rec.onstop = resolve; });
    rec.start(250);
    onEstado("ouvindo");

    const inicio = performance.now();
    let falou = false, ultimoSom = inicio, timer = null, motivo = "fim";
    // Texto ao vivo: envia o áudio gravado até agora (um pedido por vez)
    let parcialEmVoo = false, ultimaParcial = 0;
    const pedirParcial = () => {
      if (parcialEmVoo || !partes.length || rec.state === "inactive") return;
      parcialEmVoo = true;
      ultimaParcial = performance.now();
      const audio = new Blob(partes, { type: rec.mimeType || mime || "audio/webm" });
      fetch(`${FLEXMED_SERVER}/api/assistente/parcial`, {
        method: "POST", body: audio, headers: { "Content-Type": audio.type.split(";")[0] },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && d.texto && rec.state !== "inactive") onParcial(d.texto); })
        .catch(() => {})
        .finally(() => { parcialEmVoo = false; });
    };
    const encerrar = (m) => { if (rec.state !== "inactive") { motivo = m; rec.stop(); } };
    cancelar = () => encerrar("cancelado");
    timer = setInterval(() => {
      analisador.getFloatTimeDomainData(amostras);
      let soma = 0;
      for (const v of amostras) soma += v * v;
      const rms = Math.sqrt(soma / amostras.length);
      onVolume(Math.min(1, rms / 0.15));
      const agora = performance.now();
      if (rms > LIMIAR_VOZ) { falou = true; ultimoSom = agora; }
      if (falou && agora - ultimaParcial > PARCIAL_MS) pedirParcial();
      if (falou && agora - ultimoSom > SILENCIO_FIM_MS) encerrar("fim");
      else if (!falou && agora - inicio > SEM_FALA_MS) encerrar("sem_fala");
      else if (agora - inicio > MAX_MS) encerrar("fim");
    }, 80);

    await fim;
    clearInterval(timer);
    stream.getTracks().forEach(t => t.stop());   // libera o microfone
    ctx.close().catch(() => {});
    cancelar = null;
    gravando = false;
    onVolume(0);

    if (motivo === "cancelado") return null;
    if (motivo === "sem_fala" || !partes.length) return { semFala: true };

    onEstado("processando");
    const audio = new Blob(partes, { type: rec.mimeType || mime || "audio/webm" });
    const res = await fetch(`${FLEXMED_SERVER}/api/assistente/voz`, {
      method: "POST",
      body: audio,
      headers: { "Content-Type": audio.type.split(";")[0] },
    });
    if (!res.ok) throw new Error(`servidor_${res.status}`);
    return await res.json();
  }

  /** Lê a resposta em voz alta (se o aparelho tiver voz em português). */
  function falar(texto) {
    if (!("speechSynthesis" in window) || !texto) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "pt-BR";
    const voz = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith("pt"));
    if (voz) u.voice = voz;
    speechSynthesis.speak(u);
  }

  return {
    ouvir,
    falar,
    parar: () => cancelar && cancelar(),
    get gravando() { return gravando; },
  };
})();
