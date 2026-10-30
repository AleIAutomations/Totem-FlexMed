// =====================================================
// FlexMed — painel administrativo por cima do totem
// O admin abre num iframe em tela cheia em vez de trocar de página: o index
// continua carregado por baixo e a câmera (audiência e presença) segue
// capturando. "Ver Totem" / "Sair" no admin fecham o painel (admin.html).
// =====================================================

const FlexPainelAdmin = (() => {
  let quadro = null, carregando = null;

  function abrir() {
    if (quadro) return;
    // Aviso por cima até o admin avisar que está pronto (pronto()): pela rede lenta do totem
    // o admin pode levar alguns segundos, e antes a tela ficava em branco
    carregando = document.createElement("div");
    carregando.id = "painel-admin-carregando";
    carregando.innerHTML = `<p>Carregando o painel…</p><button type="button">Voltar ao totem</button>`;
    carregando.querySelector("button").addEventListener("click", fechar);
    quadro = document.createElement("iframe");
    quadro.id = "painel-admin";
    quadro.src = "admin.html";
    quadro.title = "Painel administrativo";
    quadro.addEventListener("load", pronto, { once: true });   // garantia, se o aviso do admin não vier
    // fora do #totem: não herda o zoom do layout do totem
    document.body.appendChild(quadro);
    document.body.appendChild(carregando);
    document.documentElement.classList.add("admin-aberto");
  }

  function pronto() {
    if (carregando) { carregando.remove(); carregando = null; }
  }

  function fechar() {
    pronto();
    if (!quadro) return;
    quadro.remove();
    quadro = null;
    document.documentElement.classList.remove("admin-aberto");
  }

  return { abrir, fechar, pronto, get aberto() { return !!quadro; } };
})();
window.FlexPainelAdmin = FlexPainelAdmin;

document.addEventListener("click", e => {
  const link = e.target.closest(".hdr-admin");
  if (!link) return;
  e.preventDefault();
  FlexPainelAdmin.abrir();
});
