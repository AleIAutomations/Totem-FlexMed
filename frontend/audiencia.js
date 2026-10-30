// =====================================================
// FlexMed — audiência anônima (câmera sempre ligada)
// Envia ~6 frames/s ao backend (POST /frame?mode=vision), marcando o anúncio em
// exibição e a sessão de uso em andamento; o backend detecta quem está olhando
// e a faixa etária estimada, sem guardar imagem. Pausa enquanto o Libras usa a
// câmera e volta quando ele fecha.
// =====================================================

const FlexAudiencia = (() => {
  let ultimo = null, ultimoEm = 0;
  let anuncioId = null, sessaoId = null;
  let ligada = false, pausada = false, desligada = false, tentarDeNovo = null;

  async function ligar() {
    if (ligada || pausada || desligada) return;
    clearTimeout(tentarDeNovo);
    try {
      await FlexCam.iniciar("vision", {
        fps: 6,
        // com o painel admin aberto por cima, ninguém está vendo o anúncio
        params: () => ({ anuncio: (!window.FlexPainelAdmin?.aberto && anuncioId) || "", sessao: sessaoId || "" }),
        onResultado: r => { ultimo = r; ultimoEm = Date.now(); },
      });
      ligada = true;
      if (desligada || pausada) { FlexCam.parar(); ligada = false; }   // desligada enquanto abria
    } catch (err) {
      // sem câmera/permissão: tenta de novo mais tarde (o totem segue funcionando)
      tentarDeNovo = setTimeout(ligar, 15000);
    }
  }

  return {
    iniciar: ligar,
    /** O Libras precisa da câmera: para a captura de audiência. */
    pausar() {
      pausada = true;
      if (ligada) { FlexCam.parar(); ligada = false; }
    },
    /** Libras fechou: volta a medir a audiência. */
    retomar() {
      if (document.getElementById("o-lb")?.classList.contains("on")) return;  // Libras reaberto
      pausada = false;
      ligar();
    },
    /** Admin desligou a câmera do totem (audiência e presença): fica parada até religar. */
    desligar() {
      desligada = true;
      clearTimeout(tentarDeNovo);
      if (ligada && !pausada) { FlexCam.parar(); }
      ligada = false;
    },
    religar() {
      if (!desligada) return;
      desligada = false;
      ligar();
    },
    get desligada() { return desligada; },
    /** Chegou frame da câmera nos últimos 3 s (a presença só decide com câmera viva). */
    ativa() { return !!ultimo && Date.now() - ultimoEm <= 3000; },
    /** Público agora (vazio se não chegou frame recente). */
    retrato() {
      if (!ultimo || Date.now() - ultimoEm > 3000) {
        return { pessoas: 0, olhando: 0, faixas: {}, proporcao: {}, dominante: null, proximidade: 0, proximidade_olhando: 0 };
      }
      return ultimo;
    },
    setAnuncio(id) { anuncioId = id; },
    setSessao(id) { sessaoId = id; },
  };
})();
// const no topo do script não vira window.*: expõe para os outros módulos
window.FlexAudiencia = FlexAudiencia;

// Liga assim que a página carrega
window.addEventListener("load", () => setTimeout(() => FlexAudiencia.iniciar(), 1500));
