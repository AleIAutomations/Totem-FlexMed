// FlexMed — cenas do vídeo. renderFrame(n) é função pura do número do quadro:
// t = n / 60 e mais nada (sem relógio, sem aleatoriedade, sem animação de CSS).
import { FPS, TOTAL, W, H, clamp, lerp, ease, mola, interp, prog, janela, hash, ciclo } from "./motor.js";

const $ = id => document.getElementById(id);
const px = v => `${v.toFixed(2)}px`;
const C = await (await fetch("/video/content.json")).json();
const CEN = C.cenas;

// ═══ Preparação (textos estáticos; roda uma vez, não depende do tempo) ═════════
function linhas(el, texto) {
  el.innerHTML = texto.split("\n").map(l => `<span class="linha">${l}</span>`).join("");
}
$("gancho").innerHTML = CEN.gancho.map(l => `<span class="linha">${l}</span>`).join("");
linhas($("t-acorda"), CEN.acorda.titulo.replace(" você", "\nvocê"));
linhas($("t-voz"), CEN.voz.titulo);
linhas($("t-libras"), CEN.libras.titulo);
linhas($("t-fluxo"), CEN.fluxo.titulo.replace(" ao ", "\nao "));
linhas($("t-dentro"), CEN.porDentro.titulo);
linhas($("t-publico"), "O anúncio muda\nconforme\nquem olha.");
$("hud-dist").querySelector(".rot").textContent = CEN.acorda.rotuloDistancia;
$("hud-olhar").querySelector(".rot").textContent = CEN.acorda.rotuloOlhando;
$("prova-voz").innerHTML = `<span style="color:#fff;font-size:64px">${CEN.voz.prova}</span>`;
$("prova-libras").innerHTML = `<b style="font-size:96px">${CEN.libras.prova}</b><span>${CEN.libras.provaSub}</span>`;
$("prova-balcao").innerHTML = `<span style="color:#fff;font-size:64px">${CEN.fluxo.legendaBalcao}</span>`;
document.querySelectorAll("#balcao .coluna").forEach((col, i) => { col.querySelector("h3").textContent = CEN.fluxo.colunas[i]; });
$("lgpd").textContent = CEN.fechamento.lgpd;
linhas($("tagline"), C.tagline.replace(" entende", "\nentende"));
$("marca").querySelector(".nome").textContent = C.produto;
$("contato").querySelector(".l1").textContent = C.contato.linha1;
$("contato").querySelector(".l2").textContent = C.contato.linha2;

// Fundo: grade de pontos (a grade de 24 dos ícones do totem, ampliada) e partículas
$("grade").innerHTML = `<defs><pattern id="pg" width="54" height="54" patternUnits="userSpaceOnUse">
  <circle cx="27" cy="27" r="2.2" fill="#cfe0ff" opacity=".13"/></pattern></defs>
  <rect id="grade-r" x="-54" y="-54" width="1300" height="2140" fill="url(#pg)"/>`;
const NP = 38;
$("particulas").innerHTML = Array.from({ length: NP }, (_, i) =>
  `<circle id="pt${i}" r="${(1.6 + hash(i, 7) * 3.2).toFixed(2)}" fill="#cfe0ff"/>`).join("");

// Diagrama "por dentro"
const Y_NOS = [400, 708, 1098, 1406];
$("diagrama").innerHTML = CEN.porDentro.camadas.map((c, i) => `
  <div class="no ${i === 1 ? "forte" : ""}" id="no${i}" style="top:${Y_NOS[i]}px">
    <h4>${c.nome}</h4><div class="chips">${c.itens.map(x => `<span class="chip">${x}</span>`).join("")}</div>
  </div>`).join("") +
  [0, 1, 2].map(i => `<div class="fio" id="fio${i}" style="left:540px"></div>`).join("") +
  [0, 1, 2, 3, 4, 5].map(i => `<div class="pacote" id="pac${i}"></div>`).join("");

// Público anônimo: 26 pessoas que se agrupam por faixa etária (7 faixas do totem)
const NPES = 26;
const FAIXAS = ["18–28", "28–38", "38–48", "48–58", "58–68", "68–78", "78–88"];
const FAIXA_DE = i => [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 2, 2, 3, 3, 3, 4, 4, 1, 0, 2, 5, 6][i];
$("publico").innerHTML = Array.from({ length: NPES }, (_, i) => `<div class="pessoa" id="pes${i}"></div>`).join("") +
  `<div class="faixa-rot" id="faixa-dom" style="font-size:60px;color:#fff;font-weight:800;width:260px"></div>
   <div id="anuncio-pub"></div>`;

// Números de prova
$("numeros").innerHTML = CEN.porDentro.provas.map((p, i) =>
  `<div class="numero" id="num${i}" style="top:${470 + i * 400}px"><b>${p.numero}</b><span>${p.texto}</span></div>`).join("");

// Onda (barras) e esqueleto de Libras
const NB = 52;
$("onda").innerHTML = Array.from({ length: NB }, (_, i) => `<rect id="b${i}" x="${(i * 936 / NB + 3).toFixed(1)}" width="${(936 / NB - 6).toFixed(1)}" rx="5" fill="#fff"/>`).join("");

// ═══ O totem: iframe com a UI real ══════════════════════════════════════════════
const frame = $("totem-frame");
await new Promise(ok => (frame.contentDocument?.readyState === "complete" && frame.contentWindow.TotemControle) ? ok() : frame.addEventListener("load", ok, { once: true }));
const TOTEM = frame.contentWindow.TotemControle;
await TOTEM.pronto;
const PRODUTOS = TOTEM.conteudo.totem.produtos;
const produto = id => PRODUTOS.find(p => p.id === id);
$("voo").src = produto(C.totem.produtoFluxo).imgUrl;
$("anuncio-pub").innerHTML = [
  { cor: "linear-gradient(150deg,#0057d9,#003b97)", p: "m5", t: "Vitamina C<br>em dobro", s: "anúncio da casa" },
  { cor: "linear-gradient(150deg,#00a3c4,#005b8f)", p: "m6", t: "Protetor<br>FPS 50", s: "escolhido para 28–38" },
].map((a, i) => `<div class="anuncio-faixa" id="ap${i}" style="background:${a.cor}"><img src="${produto(a.p).imgUrl}" alt="">
  <div>${a.t}<small>${a.s}</small></div></div>`).join("");

// Geometria do totem no palco: retângulo da tela (janela) no layout das cenas 2–5
const S0 = 1.2;                                 // escala do totem (480 px lógicos → 576 px)
const JANELA = { x: (W - 480 * S0) / 2, y: 468, w: 480 * S0, h: 853 * S0, r: 26 };
const BORDA = 16;

// Câmera virtual: z = zoom, (u, v) = ponto da UI (px lógicos do totem) levado ao centro
// da janela. A posição é limitada para a janela nunca mostrar nada fora da UI.
function vista(jan, z, u, v) {
  const s = (jan.w / 480) * z;
  const x = clamp(jan.x + jan.w / 2 - s * u, jan.x + jan.w - s * 480, jan.x);
  const y = clamp(jan.y + jan.h / 2 - s * v, jan.y + jan.h - s * 853, jan.y);
  return { s, x, y };
}
const mapear = (vis, u, v) => ({ x: vis.x + vis.s * u, y: vis.y + vis.s * v });

// Interpola o zoom entre âncoras: lista de [tempo, z, u, v]
function camera(t, chaves) {
  if (t <= chaves[0][0]) return chaves[0].slice(1);
  for (let i = 0; i < chaves.length - 1; i++) {
    const [ta, za, ua, va] = chaves[i], [tb, zb, ub, vb] = chaves[i + 1];
    if (t <= tb) {
      const k = ease.movimento(clamp((t - ta) / (tb - ta)));
      return [lerp(za, zb, k), lerp(ua, ub, k), lerp(va, vb, k)];
    }
  }
  return chaves[chaves.length - 1].slice(1);
}

// ═══ Utilitários de cena ═══════════════════════════════════════════════════════
// Só translate: escala animada por transform faz o Chrome escolher a resolução de raster
// pelo histórico de quadros, e o mesmo quadro sairia diferente conforme a ordem.
function estilo(el, op, y = 0, x = 0) {
  el.style.opacity = op.toFixed(4);
  el.style.visibility = op <= 0.001 ? "hidden" : "visible";
  el.style.transform = `translate(${px(x)}, ${px(y)})`;
}
function caixa(el, cx, cy, w, h) {
  el.style.left = px(cx - w / 2); el.style.top = px(cy - h / 2); el.style.width = px(w); el.style.height = px(h);
}

// Título: linhas entram em sequência (mola, sem quique), saem juntas para cima
function titulo(el, t, a, b) {
  const linhasEl = el.children;
  let algum = false;
  for (let i = 0; i < linhasEl.length; i++) {
    const ti = t - a - i * 0.09;
    const ent = mola(ti, { rigidez: 140, amortecimento: 24 });
    const sai = prog(t, b - 0.45, b, ease.saida);
    const op = clamp(prog(t, a + i * 0.09, a + i * 0.09 + 0.35, ease.suave) - sai);
    estilo(linhasEl[i], op, (1 - ent) * 70 - sai * 50);
    algum = algum || op > 0;
  }
  el.style.visibility = algum ? "visible" : "hidden";
}

function esconder(...ids) { ids.forEach(id => { const el = $(id); el.style.opacity = "0"; el.style.visibility = "hidden"; }); }

// ═══ Fundo vivo: periódico em 60 s (quadro 3600 ≡ quadro 0) ════════════════════
function fundo(t) {
  const b1 = $("brilho1"), b2 = $("brilho2");
  b1.style.transform = `translate(${px(540 - 450 + 260 * ciclo(t, 1))}, ${px(560 - 450 + 200 * ciclo(t, 2, 0.25))})`;
  b2.style.transform = `translate(${px(300 - 380 + 220 * ciclo(t, 1, 0.5))}, ${px(1480 - 380 + 180 * ciclo(t, 1, 0.1))})`;
  b1.style.opacity = (0.85 + 0.15 * ciclo(t, 3)).toFixed(4);
  const dx = (t / 60 * 2 * 54) % 54, dy = (t / 60 * 54) % 54;   // 2 e 1 células por volta: emenda no loop
  $("grade-r").setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
  for (let i = 0; i < NP; i++) {
    const bx = hash(i, 1) * (W + 120), by = hash(i, 2) * (H + 120);
    const voltas = 1 + Math.floor(hash(i, 3) * 2);            // 1 ou 2 voltas inteiras: periódico
    const y = ((by - (t / 60) * (H + 120) * voltas) % (H + 120) + (H + 120)) % (H + 120);
    const x = bx + 30 * ciclo(t, 2 + Math.floor(hash(i, 4) * 3), hash(i, 5));
    const el = $(`pt${i}`);
    el.setAttribute("cx", x.toFixed(2));
    el.setAttribute("cy", y.toFixed(2));
    el.setAttribute("opacity", (0.12 + 0.3 * hash(i, 6) * (0.6 + 0.4 * ciclo(t, 3, hash(i, 8)))).toFixed(3));
  }
}

// ═══ Cena 1 — gancho (0–4 s) ═══════════════════════════════════════════════════
function cenaGancho(t) {
  const anel = $("anel"), mira = $("mira");
  const cx = 540, cy = 640;
  // o anel procura e trava no olhar; depois vira o contorno do totem
  const r = interp(t, [0.25, 1.35], [620, 150]);
  const morf = prog(t, 3.0, 4.0, ease.movimento);
  const alvo = { x: JANELA.x - BORDA, y: JANELA.y - BORDA, w: JANELA.w + 2 * BORDA, h: JANELA.h + 2 * BORDA };
  const pulso = 1 + 0.07 * Math.sin(clamp((t - 1.35) / 0.5) * Math.PI);
  const w = lerp(2 * r * pulso, alvo.w, morf), h = lerp(2 * r * pulso, alvo.h, morf);
  const x = lerp(cx - r * pulso, alvo.x, morf), y = lerp(cy - r * pulso, alvo.y, morf);
  anel.style.left = px(x); anel.style.top = px(y); anel.style.width = px(w); anel.style.height = px(h);
  anel.style.borderRadius = morf > 0 ? px(lerp(r, 40, morf)) : "50%";
  const opA = clamp(prog(t, 0.2, 0.8, ease.suave) - prog(t, 4.0, 4.5, ease.suave));
  anel.style.opacity = opA.toFixed(4); anel.style.visibility = opA > 0 ? "visible" : "hidden";

  // a mira vaga (determinística) e trava no centro
  const trava = prog(t, 0.7, 1.35, ease.entrada);
  const mx = cx + (1 - trava) * (230 * Math.sin(t * 3.1) + 90 * Math.sin(t * 7.3));
  const my = cy + (1 - trava) * (170 * Math.cos(t * 2.6) + 60 * Math.sin(t * 5.9));
  const tam = 34 * (1 + 0.6 * Math.sin(clamp((t - 1.35) / 0.4) * Math.PI));
  caixa(mira, mx, my, tam, tam); mira.style.margin = "0";
  const opM = clamp(prog(t, 0.3, 0.7, ease.suave) - prog(t, 2.9, 3.3, ease.suave));
  mira.style.opacity = opM.toFixed(4); mira.style.visibility = opM > 0 ? "visible" : "hidden";

  // as três linhas do gancho, uma de cada vez
  const g = $("gancho");
  [...g.children].forEach((l, i) => {
    const a = 1.0 + i * 0.36;
    const ent = mola(t - a, { rigidez: 160, amortecimento: 22 });
    const sai = prog(t, 3.25 + i * 0.05, 3.75 + i * 0.05, ease.saida);
    estilo(l, clamp(prog(t, a, a + 0.3, ease.suave) - sai), (1 - ent) * 90 - sai * 60);
  });
  g.style.visibility = t < 4 ? "visible" : "hidden";
}

// ═══ Estado do totem e câmera por quadro ═══════════════════════════════════════
function totemNoQuadro(t) {
  // Cada cena devolve: estado da UI real, janela (posição) e câmera
  const jan = { ...JANELA };
  let op = 0, est = { tela: "home" }, cam = [1, 240, 426.5], incl = 0;

  if (t >= 3.9 && t < 12.2) {                               // Cena 2: acorda
    op = prog(t, 3.9, 4.5, ease.suave);
    incl = 1 - prog(t, 3.9, 5.2, ease.entrada);
    if (t < 9.6) est = { tela: "anuncio", anuncioOpacidade: 1 - prog(t, 9.1, 9.6, ease.suave) };
    else est = { tela: "home", rolagem: interp(t, [10.1, 11.9], [0, 160], ease.movimento) };
    cam = camera(t, [[9.4, 1, 240, 426.5], [10.4, 1.08, 240, 380], [12.2, 1.08, 240, 380]]);
  } else if (t >= 12.2 && t < 22.1) {                       // Cena 3: voz
    op = 1;
    const fala = CEN.voz.falaCliente;
    if (t < 15.9) {
      const k = clamp((t - 12.8) / 1.4);                   // digitação ao ritmo da fala (linear)
      est = { tela: "agente", agente: "ouvindo", parcial: fala.slice(0, Math.max(1, Math.round(k * fala.length))) || "…",
              volume: volumeFala(t), rolagem: 160 };
    } else {
      est = { tela: "agente", agente: "resultado", falaFinal: fala.replace(CEN.voz.trechoErrado, CEN.voz.trechoCerto), rolagem: 160 };
    }
    cam = camera(t, [[12.5, 1, 310, 640], [13.4, 1.45, 310, 640], [15.9, 1.45, 310, 640], [16.6, 1.45, 310, 560],
                     [19.6, 1.45, 310, 560], [20.6, 1, 310, 560]]);
  } else if (t >= 22.1 && t < 30.1) {                       // Cena 4: Libras
    op = 1;
    est = { tela: "libras", librasFrase: t >= 25.4 ? CEN.libras.frase : "", esqueleto: esqueleto(t) };
    // u = 0: o enquadramento encosta na borda esquerda (o texto do painel é alinhado à esquerda)
    cam = camera(t, [[22.4, 1, 0, 394], [23.2, 1.3, 0, 394], [25.9, 1.3, 0, 394], [26.8, 1.25, 0, 500],
                     [29.0, 1.25, 0, 500], [29.9, 1, 0, 500]]);
  } else if (t >= 30.1 && t < 37.0) {                       // Cena 5: do toque ao balcão
    op = 1 - prog(t, 36.2, 36.8, ease.suave);
    jan.x = JANELA.x - 320 * prog(t, 36.1, 36.9, ease.movimento);
    const pid = C.totem.produtoFluxo;
    if (t < 32.4) est = { tela: "detalhe", detalhe: pid, detalheX: 480 * (1 - prog(t, 30.2, 30.8, ease.entrada)) };
    else if (t < 33.6) est = { tela: "adicionado", detalhe: pid, carrinho: [pid],
      adY: 420 * (1 - prog(t, 32.4, 32.95, ease.entrada)), adOpacidade: prog(t, 32.4, 32.7, ease.suave) };
    else if (t < 34.7) est = { tela: "pedido", carrinho: [pid],
      folhaY: 520 * (1 - prog(t, 33.6, 34.15, ease.entrada)), folhaOpacidade: prog(t, 33.6, 33.85, ease.suave) };
    else est = { tela: "codigo", codigoY: 40 * (1 - mola(t - 34.7, { rigidez: 180, amortecimento: 24 })),
      codigoOpacidade: prog(t, 34.7, 34.95, ease.suave) };
    cam = camera(t, [[34.9, 1, 240, 445], [35.7, 1.25, 240, 445], [37, 1.25, 240, 445]]);
  }
  return { jan, op, est, cam, incl };
}

function volumeFala(t) {
  if (t < 12.7 || t > 14.4) return 0.05;
  const env = Math.sin(clamp((t - 12.7) / 1.7) * Math.PI);
  return clamp(0.25 + 0.75 * env * (0.6 + 0.4 * Math.abs(Math.sin(t * 17.3) * Math.cos(t * 7.1))));
}

// ═══ Esqueleto de Libras (pontos de mão, rosto e postura; sem pessoa) ═════════════
const MAO = [[0, 0], [-14, -12], [-24, -26], [-30, -40], [-34, -52],     // polegar
  [-10, -46], [-12, -66], [-13, -80], [-14, -92],                          // indicador
  [0, -48], [0, -70], [0, -86], [0, -99],                                  // médio
  [10, -45], [12, -65], [13, -79], [14, -90],                              // anelar
  [19, -38], [23, -53], [26, -64], [28, -74]];                             // mínimo
const LIGA = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

function esqueleto(t) {
  // o sinal: a mão sobe até a têmpora e toca três vezes ("dor de cabeça")
  const sobe = mola(t - 22.7, { rigidez: 60, amortecimento: 14 });
  const toque = t > 24.0 && t < 25.3 ? Math.abs(Math.sin((t - 24.0) / 1.3 * 3 * Math.PI)) : 0;
  const wx = lerp(330, 262, sobe), wy = lerp(330, 118, sobe) + 10 * toque;
  const ang = lerp(0.1, -0.55, sobe), dobra = 0.15 * toque;
  const mao = MAO.map(([x, y], i) => {
    const k = i >= 5 && (i - 5) % 4 >= 2 ? 1 - dobra : 1;          // pontas dobram no toque
    const xx = x, yy = y * k;
    return [wx + xx * Math.cos(ang) - yy * Math.sin(ang), wy + xx * Math.sin(ang) + yy * Math.cos(ang)];
  });
  const rosto = Array.from({ length: 22 }, (_, i) => {
    const a = i / 22 * Math.PI * 2;
    return [200 + 40 * Math.cos(a), 112 + 50 * Math.sin(a)];
  }).concat([[184, 102], [216, 102], [200, 118], [188, 135], [200, 138], [212, 135]]);
  const om = [[128, 248], [272, 248]], pesc = [200, 196];
  const cot = [lerp(320, 318, sobe), lerp(320, 220, sobe)];
  const vis = clamp(prog(t, 22.5, 22.9, ease.suave));
  const reconhecido = t >= 25.4;
  const corMao = reconhecido ? "#00e07a" : "#5fa8ff";
  let s = `<g opacity="${vis.toFixed(3)}">`;
  s += `<path d="M${om[0]} L${pesc} L${om[1]} L${cot} L${wx.toFixed(1)},${wy.toFixed(1)}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="3"/>`;
  s += rosto.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#7fb2ff"/>`).join("");
  s += LIGA.map(([a, b]) => `<line x1="${mao[a][0].toFixed(1)}" y1="${mao[a][1].toFixed(1)}" x2="${mao[b][0].toFixed(1)}" y2="${mao[b][1].toFixed(1)}" stroke="${corMao}" stroke-width="3.2" stroke-linecap="round"/>`).join("");
  s += mao.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.8" fill="#fff"/>`).join("");
  s += [...om, pesc, cot].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#fff"/>`).join("");
  return s + "</g>";
}

// ═══ Cena 2: medidores ═════════════════════════════════════════════════════════
function hudAcorda(t) {
  const op = janela(t, 4.8, 11.9, 0.6, 0.45);
  const dist = Math.round(interp(t, [5.0, 7.6], [260, CEN.acorda.distanciaCm], ease.movimento));
  const k = clamp((t - 7.6) / CEN.acorda.olharSeg);       // cronômetro: linear de propósito
  $("hud-dist").querySelector(".val").innerHTML = `${dist}<small>cm</small>`;
  $("hud-olhar").querySelector(".val").innerHTML = `${(k * CEN.acorda.olharSeg).toFixed(1).replace(".", ",")}<small>s</small>`;
  estilo($("hud-dist"), op, (1 - prog(t, 4.8, 5.5)) * 40);
  estilo($("hud-olhar"), op, (1 - prog(t, 4.95, 5.65)) * 40);
  estilo($("olhar-arco"), op, (1 - prog(t, 5.1, 5.8)) * 40);
  $("olhar-prog").setAttribute("stroke-dashoffset", (490.1 * (1 - k)).toFixed(2));
  $("olhar-prog").setAttribute("stroke", k >= 1 ? "#00e07a" : "#fff");
}

// ═══ Cena 3: onda e legenda ════════════════════════════════════════════════════
function onda(t) {
  const cliente = t >= 12.6 && t < 14.5, totem = t >= 16.4 && t < 18.9;
  const op = clamp(janela(t, 12.6, 14.6, 0.3, 0.3) + janela(t, 16.4, 19.0, 0.3, 0.3));
  estilo($("onda"), op);
  for (let i = 0; i < NB; i++) {
    const c = (i - NB / 2) / (NB / 2);
    let h = 6;
    if (cliente) {
      const env = Math.sin(clamp((t - 12.6) / 1.9) * Math.PI);
      h = 6 + 70 * env * (1 - c * c * 0.6) * (0.35 + 0.65 * Math.abs(Math.sin(t * 11 + i * 0.7) * Math.cos(t * 5.3 + i * 1.9)));
    } else if (totem) {
      const env = Math.sin(clamp((t - 16.4) / 2.5) * Math.PI);
      h = 6 + 56 * env * (1 - c * c * 0.8) * (0.5 + 0.5 * Math.sin(t * 9 + i * 0.45));
    }
    const b = $(`b${i}`);
    b.setAttribute("y", ((80 - h) / 2).toFixed(2));
    b.setAttribute("height", h.toFixed(2));
    b.setAttribute("fill", totem ? "#5fa8ff" : "#fff");
  }
}

function legendaVoz(t) {
  const el = $("fala");
  const fala = CEN.voz.falaCliente, errado = CEN.voz.trechoErrado, certo = CEN.voz.trechoCerto;
  const ini = fala.indexOf(errado), fim = ini + errado.length;
  if (t >= 12.6 && t < 16.2) {
    el.className = "";
    let html = `<span class="quem">Cliente</span>“`;
    if (t < 14.95) {
      // camada 1: o que o Whisper ouviu; o trecho errado se desfaz
      const n = Math.round(clamp((t - 12.8) / 1.4) * fala.length);
      const sai = prog(t, 14.45, 14.95, ease.saida);
      for (let i = 0; i < Math.min(n, fala.length); i++) {
        if (i >= ini && i < fim) {
          const j = i - ini, dy = sai * (50 + 110 * hash(j, 11)), rot = sai * (hash(j, 12) - 0.5) * 70;
          html += `<span class="letra" style="opacity:${(1 - sai).toFixed(3)};transform:translateY(${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg);color:#ffb3bc">${fala[i]}</span>`;
        } else html += `<span class="letra">${fala[i]}</span>`;
      }
      if (n >= fala.length) html += "”";
    } else {
      // camada 2: o termo do catálogo entra no lugar, letra por letra
      html += fala.slice(0, ini) + [...certo].map((ch, j) => {
        const m = mola(t - 14.95 - j * 0.035, { rigidez: 190, amortecimento: 22 });
        return `<span class="letra" style="opacity:${clamp(m * 1.6).toFixed(3)};transform:translateY(${((1 - m) * 60).toFixed(1)}px)">${ch}</span>`;
      }).join("") + fala.slice(fim) + "”";
      const sub = prog(t, 15.3, 15.7, ease.entrada);
      html = html.replace(`“${fala.slice(0, ini)}`, `“${fala.slice(0, ini)}<span style="position:relative;display:inline-block">`)
                 .replace(`${fala.slice(fim)}”`, `<i style="position:absolute;left:0;right:0;bottom:-6px;height:9px;border-radius:5px;background:#5fa8ff;transform-origin:0 50%;transform:scaleX(${sub.toFixed(4)})"></i></span>${fala.slice(fim)}”`);
    }
    el.innerHTML = html;
    estilo(el, clamp(prog(t, 12.6, 12.9, ease.suave) - prog(t, 15.9, 16.2, ease.saida)));
  } else if (t >= 16.3 && t < 19.4) {
    el.className = "totem-fala";
    el.innerHTML = `<span class="quem">Totem</span>${CEN.voz.respostaTotem}`;
    estilo(el, janela(t, 16.3, 19.4, 0.4, 0.35), (1 - prog(t, 16.3, 16.9)) * 30);
  } else estilo(el, 0);
  estilo($("prova-voz"), janela(t, 19.5, 21.9, 0.5, 0.4), (1 - prog(t, 19.5, 20.1)) * 40);
}

// ═══ Cena 5: toques, voo do produto e quadro do balcão ═══════════════════════════
const TOQUES = [[31.5, 306, 813], [33.4, 380, 809], [34.5, 240, 800]];
function toques(t, vis) {
  const el = $("toque");
  const ativo = TOQUES.find(([ta]) => t >= ta - 0.05 && t < ta + 0.55);
  if (!ativo || !vis) return estilo(el, 0);
  const [ta, u, v] = ativo;
  const p = mapear(vis, u, v), k = clamp((t - ta + 0.05) / 0.6);
  const d = 120 * (0.6 + 0.9 * ease.entrada(k));
  caixa(el, p.x, p.y, d, d);
  estilo(el, (1 - ease.saida(k)) * 0.95);
}

function vooProduto(t, vis) {
  const el = $("voo");
  if (!vis || t < 31.6 || t > 32.5) return estilo(el, 0);
  const k = ease.movimento(clamp((t - 31.6) / 0.8));
  const a = mapear(vis, 240, 356), b = mapear(vis, 306, 813);
  const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k) - 260 * Math.sin(k * Math.PI);  // arco
  const d = 200 * lerp(1.05, 0.3, k);
  caixa(el, x, y, d, d);
  estilo(el, 1 - prog(t, 32.3, 32.5, ease.saida));
}

function balcao(t) {
  const el = $("balcao");
  const op = clamp(prog(t, 36.3, 36.9, ease.suave) - prog(t, 39.4, 39.9, ease.saida));
  estilo(el, op, 0, 400 * (1 - prog(t, 36.2, 37.0, ease.entrada)));
  const p = produto(C.totem.produtoFluxo);
  const cart = $("cartao");
  const col = t < 37.6 ? 0 : t < 38.5 ? 1 : 2;
  const xCol = interp(t, [37.6, 38.1, 38.5, 39.0], [0, 320, 320, 640], ease.movimento) + 16;
  const ent = mola(t - 36.7, { rigidez: 150, amortecimento: 22 });
  estilo(cart, clamp((t - 36.7) / 0.25), (1 - ent) * -60 + 130, xCol);
  cart.querySelector(".cod").textContent = CEN.fluxo.codigo;
  cart.querySelector(".item").textContent = p.nome.split(" · ")[0];
  cart.querySelector(".onde").textContent = CEN.fluxo.local;
  const selo = $("cartao-selo"), pronto = col === 2 && t > 39.0;
  selo.className = pronto ? "ok" : "vazio";
  selo.textContent = pronto ? "✓ Pronto" : col === 1 ? "Separando" : "Novo";
  estilo($("prova-balcao"), janela(t, 37.2, 39.9, 0.5, 0.4), (1 - prog(t, 37.2, 37.8)) * 40);
}

// ═══ Cena 6: por dentro ════════════════════════════════════════════════════════
function porDentro(t) {
  const saida = prog(t, 44.1, 44.6, ease.saida);
  for (let i = 0; i < 4; i++) {
    const a = 40.5 + i * 0.55;
    const m = mola(t - a, { rigidez: 150, amortecimento: 22 });
    estilo($(`no${i}`), clamp(prog(t, a, a + 0.3, ease.suave) - saida), (1 - m) * 60 - saida * 40);
  }
  const alturas = [218, 300, 218];
  for (let i = 0; i < 3; i++) {
    const topo = Y_NOS[i] + alturas[i] - 6, fim = Y_NOS[i + 1] + 6;
    const k = prog(t, 40.85 + i * 0.55, 41.35 + i * 0.55, ease.entrada);
    const f = $(`fio${i}`);
    f.style.top = px(topo); f.style.height = px((fim - topo) * k);
    f.style.opacity = (1 - saida).toFixed(4);
  }
  // pacotes de dados descendo pelos fios (frames → eventos → nuvem)
  for (let j = 0; j < 6; j++) {
    const i = j % 3, el = $(`pac${j}`);
    const topo = Y_NOS[i] + alturas[i], fim = Y_NOS[i + 1];
    const fase = ((t - 42.2) * 1.4 + j * 0.5) % 1;
    const vis = t > 42.3 + i * 0.2 ? clamp(Math.sin(fase * Math.PI) * 1.5) * (1 - saida) : 0;
    el.style.left = px(540); el.style.top = px(lerp(topo, fim, fase));
    el.style.opacity = vis.toFixed(4);
  }
}

function publico(t) {
  const vis = clamp(prog(t, 44.4, 44.9, ease.suave) - prog(t, 47.3, 47.7, ease.saida));
  $("publico").style.visibility = vis > 0 ? "visible" : "hidden";
  const agrupa = prog(t, 45.1, 46.2, ease.movimento);
  const cont = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < NPES; i++) {
    const f = FAIXA_DE(i), pos = cont[f]++;
    const x0 = 120 + hash(i, 21) * 840, y0 = 760 + hash(i, 22) * 440;
    const wob = 1 - agrupa;
    const xs = x0 + wob * 26 * Math.sin(t * (1.3 + hash(i, 23)) + i), ys = y0 + wob * 22 * Math.cos(t * (1.1 + hash(i, 24)) + i);
    const x1 = 72 + (f + 0.5) * 936 / 7, y1 = 1250 - pos * 46;
    const el = $(`pes${i}`);
    el.style.left = px(lerp(xs, x1, agrupa)); el.style.top = px(lerp(ys, y1, agrupa));
    const dom = f === 1 && t > 46.3;
    el.style.background = dom ? "#ffffff" : "#5f86c9";
    el.style.opacity = (vis * (dom ? 1 : 0.75)).toFixed(4);
    const d = dom ? 40 : 34;
    el.style.width = px(d); el.style.height = px(d); el.style.margin = px(-d / 2) + " 0 0 " + px(-d / 2);
  }
  const fd = $("faixa-dom");
  fd.textContent = `${FAIXAS[1]} anos`;
  fd.style.whiteSpace = "nowrap"; fd.style.width = "auto";
  fd.style.left = px(72 + 1.5 * 936 / 7 - 70); fd.style.top = px(1250 - 9 * 46 - 100);   // acima da coluna mais alta
  estilo(fd, clamp(prog(t, 46.3, 46.7, ease.suave)) * vis, (1 - prog(t, 46.3, 46.8)) * 20);
  const troca = prog(t, 46.5, 47.0, ease.movimento);
  estilo($("anuncio-pub"), vis, (1 - prog(t, 44.6, 45.2)) * 50);
  estilo($("ap0"), 1 - troca, -troca * 60);
  estilo($("ap1"), troca, (1 - troca) * 60);
}

function numeros(t) {
  for (let i = 0; i < 3; i++) {
    const a = 47.6 + i * 0.3;
    const m = mola(t - a, { rigidez: 150, amortecimento: 22 });
    const sai = prog(t, 49.4, 49.9, ease.saida);
    estilo($(`num${i}`), clamp(prog(t, a, a + 0.3, ease.suave) - sai), (1 - m) * 80 - sai * 50);
  }
}

// ═══ Cena 7: fechamento ════════════════════════════════════════════════════════
function fechamento(t) {
  estilo($("lgpd"), janela(t, 50.2, 52.7, 0.6, 0.45), (1 - mola(t - 50.2, { rigidez: 140, amortecimento: 24 })) * 70);
  const sai = prog(t, 58.1, 59.3, ease.saida);
  const tg = $("tagline");
  [...tg.children].forEach((l, i) => {
    const a = 52.9 + i * 0.12;
    estilo(l, clamp(prog(t, a, a + 0.35, ease.suave) - sai), (1 - mola(t - a, { rigidez: 140, amortecimento: 24 })) * 80 - sai * 50);
  });
  tg.style.visibility = t > 52.8 && t < 59.4 ? "visible" : "hidden";
  estilo($("marca"), clamp(prog(t, 53.6, 54.0, ease.suave) - sai), (1 - mola(t - 53.6, { rigidez: 140, amortecimento: 24 })) * 60 - sai * 50);
  estilo($("contato"), clamp(prog(t, 54.3, 54.7, ease.suave) - sai), (1 - mola(t - 54.3, { rigidez: 140, amortecimento: 24 })) * 60 - sai * 50);
}

// ═══ renderFrame(n) ════════════════════════════════════════════════════════════
async function renderFrame(n) {
  n = ((Math.round(n) % TOTAL) + TOTAL) % TOTAL;
  const t = n / FPS;
  fundo(t);
  cenaGancho(t);

  // Títulos
  titulo($("t-acorda"), t, 4.3, 11.9);
  titulo($("t-voz"), t, 12.2, 21.9);
  titulo($("t-libras"), t, 22.2, 29.8);
  titulo($("t-fluxo"), t, 30.2, 39.8);
  titulo($("t-dentro"), t, 40.2, 44.3);
  titulo($("t-publico"), t, 44.5, 47.5);

  // O totem real
  const { jan, op, est, cam, incl } = totemNoQuadro(t);
  const disp = $("disp");
  if (op > 0) {
    const vis = vista(jan, ...cam);
    const brilho = t < 12.2 ? 0.35 + 0.65 * prog(t, 5.0, 9.1, ease.suave) * (1 - prog(t, 9.6, 11, ease.suave) * 0.5) : 0.6;
    const mold = $("moldura"), janEl = $("janela"), ap = $("aparelho");
    mold.style.left = px(jan.x - BORDA); mold.style.top = px(jan.y - BORDA);
    mold.style.width = px(jan.w + 2 * BORDA); mold.style.height = px(jan.h + 2 * BORDA);
    mold.style.boxShadow = `0 0 0 2px rgba(207,224,255,.16), 0 50px 120px rgba(0,0,0,.6), 0 0 ${Math.round(120 + 120 * brilho)}px rgba(0,87,217,${(0.25 + 0.35 * brilho).toFixed(3)})`;
    janEl.style.left = px(jan.x); janEl.style.top = px(jan.y); janEl.style.width = px(jan.w); janEl.style.height = px(jan.h);
    janEl.style.borderRadius = px(jan.r);
    ap.style.left = px(vis.x - jan.x); ap.style.top = px(vis.y - jan.y);
    ap.style.width = px(480 * vis.s); ap.style.height = px(853 * vis.s);
    disp.style.opacity = op.toFixed(4);
    disp.style.visibility = "visible";
    disp.style.transform = `translateY(${px(90 * incl)})`;
    await TOTEM.aplicar({ ...est, k: vis.s });
    toques(t, vis);
    vooProduto(t, vis);
  } else {
    disp.style.opacity = "0"; disp.style.visibility = "hidden";
    estilo($("toque"), 0); estilo($("voo"), 0);
  }

  // Pulso de "acordou" saindo do totem
  const aro = $("aro"), kp = clamp((t - 9.1) / 0.9);
  if (t >= 9.1 && t < 10.0) {
    const e2 = ease.entrada(kp), cresce = 40 * e2;
    aro.style.left = px(JANELA.x - BORDA - cresce); aro.style.top = px(JANELA.y - BORDA - cresce);
    aro.style.width = px(JANELA.w + 2 * (BORDA + cresce)); aro.style.height = px(JANELA.h + 2 * (BORDA + cresce));
    estilo(aro, (1 - kp) * 0.9);
  } else estilo(aro, 0);

  hudAcorda(t);
  onda(t);
  legendaVoz(t);
  estilo($("prova-libras"), janela(t, 26.4, 29.8, 0.5, 0.4), (1 - prog(t, 26.4, 27.0)) * 40);
  balcao(t);
  porDentro(t);
  publico(t);
  numeros(t);
  fechamento(t);
  void document.body.offsetHeight;
  await document.fonts.ready;
  return n;
}

// Garante que fontes e imagens do palco estão prontas antes do primeiro quadro
await Promise.all([400, 500, 600, 700, 800].map(p => document.fonts.load(`${p} 16px "Atkinson Hyperlegible Next"`)));
await document.fonts.ready;
await frame.contentDocument.fonts.ready;
await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
window.renderFrame = renderFrame;
window.TOTAL_QUADROS = TOTAL;

// ═══ Preview (só no navegador, nunca no render) ═════════════════════════════════
const params = new URLSearchParams(location.search);
if (params.has("preview")) {
  document.body.classList.add("preview");
  const palco = $("palco"), faixa = $("ctrl-quadro"), info = $("ctrl-info"), botao = $("ctrl-tocar");
  const ajustar = () => {
    const esc = Math.min(innerWidth / W, (innerHeight - 56) / H);
    palco.style.transform = `scale(${esc})`;
  };
  ajustar(); addEventListener("resize", ajustar);
  let quadro = Number(params.get("quadro") || 0), tocando = false, ocupado = false;
  const ir = async q => {
    quadro = ((q % TOTAL) + TOTAL) % TOTAL;
    faixa.value = quadro;
    info.textContent = `quadro ${quadro} · ${(quadro / FPS).toFixed(2)} s`;
    ocupado = true; await renderFrame(quadro); ocupado = false;
  };
  faixa.addEventListener("input", () => ir(Number(faixa.value)));
  addEventListener("keydown", ev => {
    if (ev.key === "ArrowRight") ir(quadro + (ev.shiftKey ? 60 : 1));
    if (ev.key === "ArrowLeft") ir(quadro - (ev.shiftKey ? 60 : 1));
    if (ev.key === " ") { ev.preventDefault(); botao.click(); }
  });
  // "Tocar" só avança o número do quadro para inspecionar; o vídeo de verdade sai do render
  botao.addEventListener("click", () => {
    tocando = !tocando;
    botao.textContent = tocando ? "❚❚ Pausar" : "▶︎ Tocar";
    const passo = () => { if (!tocando) return; if (!ocupado) ir(quadro + 2); requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
  });
  ir(quadro);
}
window.__pronto = true;
