// =====================================================
// FlexMed — ícones próprios de categorias e subcategorias
// Desenhados para o totem: grade de 24, traço de 1,8 em currentColor (azul da
// marca) e um detalhe em vermelho que dá a assinatura: "ac" = forma preenchida,
// "al" = traço (cores em totem.css, .fx-ico).
// FlexIcones.de(slug, nome) acha o ícone pelo slug e, para subcategorias novas
// criadas no admin, por palavras do nome (ex.: "Higiene Oral" -> dente).
// =====================================================

const FlexIcones = (() => {
  const svg = corpo => `<svg class="fx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

  const D = {
    // ─── categorias do topo (nichos) ───
    todos: svg(`<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" class="ac"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>`),
    medicamentos: svg(`<rect x="2.6" y="8.2" width="12.5" height="6.2" rx="3.1" transform="rotate(-35 8.85 11.3)"/><path d="M6.2 6.9 L9.8 12" /><path class="ac" d="M3.1 12.2a3.1 3.1 0 0 1 1.3-4.3l1.8-1 3.6 5.1-1.8 1.3a3.1 3.1 0 0 1-4.9-1.1z"/><circle cx="17.5" cy="16" r="4.2"/><path d="M14.6 18.9l5.8-5.8"/>`),
    beleza: svg(`<path d="M9 8h6v12a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 20z"/><path d="M10 8V5.5h4V8"/><path d="M11 2.5h2"/><path class="ac" d="M17.8 3.2c1.2 1.6 1.8 2.6 1.8 3.4a1.8 1.8 0 0 1-3.6 0c0-.8.6-1.8 1.8-3.4z"/><path d="M11.2 12.5h1.6"/>`),
    higiene: svg(`<rect x="3.5" y="10" width="13" height="9" rx="3"/><path d="M6.5 13.5h3"/><circle class="ac" cx="17.8" cy="6.2" r="2.6"/><circle cx="12.6" cy="5.4" r="1.6"/><circle cx="20.2" cy="11.4" r="1.2"/>`),
    infantil: svg(`<path d="M9.5 9h5l.8 3.2v7.3a2 2 0 0 1-2 2h-2.6a2 2 0 0 1-2-2v-7.3z"/><path d="M10 9V7.2a2 2 0 0 1 4 0V9"/><path class="ac" d="M11 5.2a1 1 0 0 1 2 0V5h-2z"/><path d="M8.7 14h2M8.7 17h2"/>`),
    bem_estar: svg(`<path d="M12 20.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.4c0 5.5-7.5 10.1-7.5 10.1z"/><path class="ac" d="M12 8c0-2.8 1.8-4.9 4.6-5.3.1 2.9-1.8 5-4.6 5.3z"/><path d="M7.5 12.5h2.2l1.3-2 1.8 4 1.2-2h2.4"/>`),

    // ─── subcategorias ───
    analgesico: svg(`<circle cx="12" cy="12" r="8.3"/><path d="M12 3.7v16.6"/><path class="ac" d="M12 3.7a8.3 8.3 0 0 1 0 16.6z"/>`),
    antibiotico: svg(`<rect x="2.8" y="8.6" width="12.6" height="6.2" rx="3.1" transform="rotate(-35 9.1 11.7)"/><path class="ac" d="M3.3 12.6a3.1 3.1 0 0 1 1.3-4.3l1.8-1.1 3.6 5.1-1.8 1.3a3.1 3.1 0 0 1-4.9-1z"/><circle cx="18" cy="16.5" r="3"/><path d="M18 12.2v1.3M18 19.5v1.3M13.7 16.5H15M21 16.5h1.3M15 13.5l.9.9M20.1 18.6l.9.9"/>`),
    alergias: svg(`<circle cx="12" cy="10" r="2.4" class="ac"/><path d="M12 7.6c0-2.4 1-3.9 2.4-3.9s2 1.7.5 3.4M14.3 9.6c2.3-.7 4.1-.2 4.4 1.2s-1.3 2.3-3.4 1.6M13.4 12.2c1.4 2 1.5 3.8.3 4.5s-2.5-.4-2.6-2.6M10.6 12.2c-1.4 2-3 2.4-3.8 1.4s.1-2.5 2.3-2.9M9.7 9.6C7.5 8.8 6.6 7.3 7.4 6.2s2.4-.6 3.1 1.4"/><path d="M12 16v5"/><path d="M12 19c1.2-1.4 2.6-1.8 3.8-1.6"/>`),
    vitaminas: svg(`<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="5.6" class="ac"/><path d="M12 6.4v11.2M6.4 12h11.2M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="1.3"/>`),
    diabetes: svg(`<rect x="5" y="3" width="10" height="16" rx="2.6"/><rect x="7.4" y="5.6" width="5.2" height="4" rx="1"/><path d="M8.5 13h3M8.5 15.6h3"/><path class="ac" d="M18.5 13.2c1.4 1.9 2.1 3.1 2.1 4.1a2.1 2.1 0 0 1-4.2 0c0-1 .7-2.2 2.1-4.1z"/><path d="M10 19v2.5"/>`),
    coracao: svg(`<path class="ac" d="M12 20.3S4 15.4 4 9.6A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8 2.2c0 5.8-8 10.7-8 10.7z"/><path d="M12 20.3S4 15.4 4 9.6A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8 2.2c0 5.8-8 10.7-8 10.7z"/><path d="M2.5 12.6h4.6l1.5-2.6 2.2 5 1.7-3.6 1 1.2h8" stroke="#fff" stroke-width="1.6"/>`),
    sistema_nervoso: svg(`<path d="M12 4.2c-1.2-1.2-4-1-4.9.9-2 .2-3.2 2.2-2.4 4-1.4 1.1-1.3 3.4.3 4.3-.3 2 1.4 3.6 3.4 3.2.9 1.5 2.7 1.9 3.6.9z"/><path d="M12 4.2c1.2-1.2 4-1 4.9.9 2 .2 3.2 2.2 2.4 4 1.4 1.1 1.3 3.4-.3 4.3.3 2-1.4 3.6-3.4 3.2-.9 1.5-2.7 1.9-3.6.9z"/><path d="M12 4.2v13.3"/><path class="al" d="M12 17.5v4"/><circle class="ac" cx="12" cy="21" r="1.2"/><path d="M8.3 8.6c1 .3 1.6 1 1.7 2M15.7 8.6c-1 .3-1.6 1-1.7 2"/>`),
    gastro: svg(`<path d="M9.5 3v3.4c0 1.4-.6 2.4-1.8 3.2C5.4 11.1 4.6 13.4 5.3 16c.9 3.3 4.3 5.1 7.8 4.6 3.8-.6 6.3-4 5.8-7.6-.4-2.6-2.5-3.6-4.3-3.2-1.8.4-2.4 2.1-3.8 2.3"/><path class="al" d="M13.3 15.4c1.3-.2 2.4-1.2 2.6-2.5"/><path d="M14 3v2.4"/>`),
    saude_mulher: svg(`<circle cx="12" cy="9" r="5.3"/><path d="M12 14.3v7M9 18.2h6"/><path class="ac" d="M12 11.7s-2.3-1.4-2.3-3a1.3 1.3 0 0 1 2.3-.8 1.3 1.3 0 0 1 2.3.8c0 1.6-2.3 3-2.3 3z"/>`),
    dermato: svg(`<path d="M7 3h10l-1 4H8z"/><path d="M8 7h8l1.6 11.8a2 2 0 0 1-2 2.2H8.4a2 2 0 0 1-2-2.2z"/><path class="ac" d="M9.3 12.3h5.4l.6 4.4H8.7z"/>`),
    cuidados: svg(`<path d="M8 10h8v9.5a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M10 10V7.5h4V10"/><path d="M12 7.5V4.5h5"/><path d="M17 4.5v2"/><rect class="ac" x="10" y="13.5" width="4" height="4.5" rx="1"/>`),
    primeiros_socorros: svg(`<rect x="2.6" y="8.2" width="18.8" height="7.6" rx="3.8" transform="rotate(-40 12 12)"/><rect class="ac" x="8.6" y="8.9" width="6.8" height="6.2" rx="1.2" transform="rotate(-40 12 12)"/><path d="M11 11.2l.01 0M13 12.8l.01 0M11.8 13.4l.01 0M12.4 10.6l.01 0" stroke-width="2.2"/>`),
    outros: svg(`<path d="M4.5 9h15l-1.6 10.2a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8z"/><path d="M8.5 9 11 3.5M15.5 9 13 3.5"/><path class="ac" d="M10.5 13h3v4.5h-3z"/>`),

    // ─── extras para subcategorias criadas no admin ───
    dente: svg(`<path d="M7.6 3.6c1.6 0 2.6.8 4.4.8s2.8-.8 4.4-.8c2.7 0 4 2.6 3.2 6-.6 2.6-1.1 4.4-1.6 7.6-.3 2.4-1.2 3.8-2.4 3.8-1.6 0-1.4-5-3.6-5s-2 5-3.6 5c-1.2 0-2.1-1.4-2.4-3.8-.5-3.2-1-5-1.6-7.6-.8-3.4.5-6 3.2-6z"/><path class="al" d="M9 7.5c.6-.7 1.6-.9 2.4-.5"/>`),
    olho: svg(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle class="ac" cx="12" cy="12" r="3.2"/>`),
    lua: svg(`<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/><path class="ac" d="M16.5 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>`),
    sol: svg(`<circle class="ac" cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>`),
    osso: svg(`<path d="M8.2 6.8 17.2 15.8"/><path d="M6.1 4.2a2.2 2.2 0 0 0-3.4 2.6 2.2 2.2 0 0 0 2.6 3.4l2.9-2.9a2.2 2.2 0 0 0-2.1-3.1z"/><path class="ac" d="M17.9 19.8a2.2 2.2 0 0 0 3.4-2.6 2.2 2.2 0 0 0-2.6-3.4l-2.9 2.9a2.2 2.2 0 0 0 2.1 3.1z"/>`),
    pulmao: svg(`<path d="M12 3.5v8"/><path d="M12 9.5c-1.5 0-2.6-1.6-4-1.6C5.4 7.9 3.5 12 3.5 16.4c0 2.2 1.2 3.6 3 3.6 2.6 0 5.5-1.6 5.5-5z"/><path class="ac" d="M12 9.5c1.5 0 2.6-1.6 4-1.6 2.6 0 4.5 4.1 4.5 8.5 0 2.2-1.2 3.6-3 3.6-2.6 0-5.5-1.6-5.5-5z"/>`),
    folha: svg(`<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path class="al" d="M5 19c3-4 6-7 10-9"/>`),
    gotas: svg(`<path d="M9 3h6"/><path d="M10 3v3.5L6.5 12a5.5 5.5 0 1 0 11 0L14 6.5V3"/><path class="ac" d="M7.2 14h9.6a4.8 4.8 0 0 1-9.6 0z"/>`),
    termometro: svg(`<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><circle class="ac" cx="12" cy="17.8" r="2"/><path d="M12 15.8V9"/><path d="M16.5 6h2M16.5 9h2"/>`),
    maca: svg(`<path d="M12 7.5c-1.5-1-5.5-1.5-6.8 2.4-1.4 4.2 1.4 10.6 4.6 10.6 1 0 1.4-.6 2.2-.6s1.2.6 2.2.6c3.2 0 6-6.4 4.6-10.6-1.3-3.9-5.3-3.4-6.8-2.4z"/><path class="ac" d="M12 7.5c0-2.4 1.3-4 3.5-4.2 0 2.3-1.4 3.9-3.5 4.2z"/>`),
    halter: svg(`<path d="M6.5 12h11"/><rect x="3" y="8" width="3.5" height="8" rx="1"/><rect class="ac" x="17.5" y="8" width="3.5" height="8" rx="1"/><path d="M1.5 10.5v3M22.5 10.5v3"/>`),
    peixe: svg(`<path d="M3 12c2.6-4 6-5.5 9.5-5.5 3.4 0 5.9 2.4 7.5 5.5-1.6 3.1-4.1 5.5-7.5 5.5C9 17.5 5.6 16 3 12z"/><path class="ac" d="M3 12 .8 8.5v7z"/><circle cx="15.8" cy="11" r=".9" fill="currentColor"/>`),
    cabelo: svg(`<path d="M5 9a7 7 0 0 1 14 0v3"/><path d="M5 9v9M8.5 7v12M12 6v13M15.5 7v12"/><rect class="ac" x="4" y="17.5" width="16" height="3" rx="1.5"/>`),
    pe: svg(`<path d="M8 21c-2.4 0-3.5-2-3.1-4.6.4-2.6 1.6-3.8 1.6-6.4 0-2.2-.5-3.6.6-4.8 1.3-1.4 4 0 4.4 3 .4 2.6-.3 4 .6 6 .8 1.7 2.6 2 2.6 3.8 0 2-2.6 3-6.7 3z"/><circle class="ac" cx="13.6" cy="4.6" r="1.4"/><circle cx="16.4" cy="6.4" r="1.1"/><circle cx="18.2" cy="8.8" r=".9"/>`),
    sem_fumar: svg(`<rect x="3" y="12" width="15" height="3.4" rx="1"/><path d="M14 12v3.4"/><path d="M19.5 9.5c0-1.6-1.4-2-1.4-3.6M21.5 9.5c0-1.6-1.4-2-1.4-3.6"/><circle class="al" cx="12" cy="12" r="9.5"/><path class="al" d="M5.3 5.3 18.7 18.7"/>`),
    figado: svg(`<path d="M3.5 9.5C5 6 9.5 5 13.5 5.5S21 8 20.5 11c-.5 2.6-3.5 3.8-6 4.6-2.6.8-4 2.4-5.5 3.9C7 14.5 2 13 3.5 9.5z"/><path class="al" d="M13.5 5.5c-.8 2.8-.5 5.6 1 8.4"/>`),
    kit: svg(`<rect x="3.5" y="8" width="17" height="12" rx="2.5"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8"/><path class="ac" d="M10.5 11h3v2.5H16v3h-2.5V19h-3v-2.5H8v-3h2.5z"/>`),
    mao: svg(`<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.6 7-6 7-2.6 0-4.2-1.2-5.6-3.4L3.6 14.8a1.5 1.5 0 0 1 2.5-1.6L8 15.4"/><path class="ac" d="M18.5 4.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>`),
    circulacao: svg(`<path d="M7 4c-2.5 3-2.5 13 0 16M17 4c2.5 3 2.5 13 0 16"/><path class="ac" d="M12 7.5c1.6 2.2 2.4 3.6 2.4 4.8a2.4 2.4 0 0 1-4.8 0c0-1.2.8-2.6 2.4-4.8z"/>`),
  };

  // palavras do nome -> ícone (subcategorias novas)
  const PALAVRAS = [
    [/oral|dente|bucal|boca/, "dente"], [/olho|lente|visão|visao|ocular/, "olho"], [/sono|insônia|insonia|dormir/, "lua"],
    [/sol|solar|bronze/, "sol"], [/osso|articula/, "osso"], [/respira|asma|pulm/, "pulmao"], [/gripe|resfriad|alergi|infec/, "alergias"],
    [/fito|homeopat|natural|chá|cha\b/, "folha"], [/diagnós|diagnos|teste|termôm|termom/, "termometro"],
    [/aliment|diet|nutri/, "maca"], [/sport|whey|proteín|protein|muscul/, "halter"], [/ômega|omega|peixe/, "peixe"],
    [/cabel|capilar|shampoo/, "cabelo"], [/pé|pes\b|pés|mãos|maos/, "pe"], [/fumar|cigarro|nicotin/, "sem_fumar"],
    [/fígado|figado|hepát|hepat/, "figado"], [/kit|promo/, "kit"], [/circula|varize|colesterol|triglic/, "circulacao"],
    [/pressão|pressao|coração|coracao|cardí/, "coracao"], [/vitamin|suplement|mineral/, "vitaminas"],
    [/mulher|íntim|intim|femin/, "saude_mulher"], [/dor|analg|contus/, "analgesico"], [/micose|pele|derma|rosto|corpo/, "dermato"],
    [/higien|cuidado|acessór|acessor/, "cuidados"], [/bebê|bebe|infant|criança|crianca/, "infantil"], [/socorr|curativ/, "primeiros_socorros"],
    [/diabet|glic/, "diabetes"], [/estômag|estomag|intestin|gastr|digest/, "gastro"], [/nervos|ansied|depress|cérebro|cerebro/, "sistema_nervoso"],
  ];

  function de(slug, nome = "") {
    if (D[slug]) return D[slug];
    const texto = `${slug} ${nome}`.toLowerCase();
    const achou = PALAVRAS.find(([re]) => re.test(texto));
    return achou ? D[achou[1]] : null;
  }

  // ℞ desenhado (selo de venda com receita)
  const receita = svg(`<path d="M6 20V4h5.2a4 4 0 0 1 0 8H6"/><path class="al" d="M10 12l8 8M18 12l-8 8"/>`);

  return { de, receita, todos: D };
})();
window.FlexIcones = FlexIcones;
