// Motor de movimento: tudo aqui é função pura dos argumentos. Nada de relógio,
// nada de Math.random(). (Princípios da skill remotion-best-practices: interpolate
// sobre uma faixa explícita, curvas bezier e molas como funções do tempo.)

export const FPS = 60;
export const DURACAO = 60;                 // segundos
export const TOTAL = FPS * DURACAO;        // 3600 quadros
export const W = 1080, H = 1920;           // quadro de trabalho (o 4K usa deviceScaleFactor 2)

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;

// cubic-bezier(x1, y1, x2, y2), resolvido por Newton + bisseção (igual ao CSS)
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x, d = dx(t);
      if (Math.abs(err) < 1e-7) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

// Curvas das skills animate / impeccable (e a --tv-entrada do próprio totem)
export const ease = {
  entrada: bezier(0.16, 1, 0.3, 1),          // chegada confiante (= --tv-entrada do totem)
  saida: bezier(0.7, 0, 0.84, 0),            // saída: acelera para fora
  movimento: bezier(0.77, 0, 0.175, 1),      // deslocamento na tela (ease-in-out forte)
  suave: bezier(0.45, 0, 0.55, 1),
  linear: x => x,
};

// Mola amortecida analítica: posição de 0 → 1 após t segundos (sem estado, sem integração)
export function mola(t, { rigidez = 170, amortecimento = 26, massa = 1 } = {}) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(rigidez / massa);
  const zeta = amortecimento / (2 * Math.sqrt(rigidez * massa));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/**
 * interp(t, [t0, t1, ...], [v0, v1, ...], easings?) — como o interpolate do Remotion,
 * sempre com clamp nas pontas. easings pode ser uma função ou uma lista (n-1).
 */
export function interp(t, tempos, valores, easings = ease.entrada) {
  if (t <= tempos[0]) return valores[0];
  const ult = tempos.length - 1;
  if (t >= tempos[ult]) return valores[ult];
  let i = 0;
  while (t > tempos[i + 1]) i++;
  const k = (t - tempos[i]) / (tempos[i + 1] - tempos[i]);
  const f = Array.isArray(easings) ? easings[i] : easings;
  return lerp(valores[i], valores[i + 1], f(k));
}

// Progresso 0→1 de uma janela [a, b] com easing (atalho do caso mais comum)
export const prog = (t, a, b, f = ease.entrada) => f(clamp((t - a) / (b - a)));

// Entrada e saída numa mesma janela: sobe em [a, a+ent], desce em [b-sai, b]
export function janela(t, a, b, ent = 0.6, sai = 0.4) {
  if (t < a || t > b) return 0;
  return Math.min(prog(t, a, a + ent), 1 - prog(t, b - sai, b, ease.saida));
}

// Hash inteiro determinístico → [0, 1). Substitui Math.random() (índice + semente).
export function hash(i, semente = 0) {
  let h = (i * 374761393 + semente * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Oscilação periódica: período em segundos dividindo exatamente a DURACAO (loop perfeito)
export const ciclo = (t, voltas, fase = 0) => Math.sin(2 * Math.PI * (t / DURACAO * voltas + fase));
