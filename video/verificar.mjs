// Verificações do vídeo (npm run verificar):
//  1. Determinismo: o mesmo quadro, renderizado em ordens diferentes e numa página nova,
//     precisa dar exatamente o mesmo PNG (hash SHA-256 igual).
//  2. Loop: a emenda do último quadro com o quadro 0 precisa ser do tamanho de uma
//     diferença normal entre dois quadros seguidos (sem pulo).
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { iniciarServidor, abrirChrome } from "./serve.mjs";

const { servidor, url } = await iniciarServidor(Number(process.env.FLEXMED_VIDEO_RENDER_PORTA || 5078));
const navegador = await abrirChrome(chromium);
const sha = buf => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function novaPagina() {
  const p = await navegador.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto(`${url}/video/`);
  await p.waitForFunction(() => window.__pronto === true, null, { timeout: 120000 });
  return p;
}
async function quadro(p, n) {
  await p.evaluate(q => window.renderFrame(q), n);
  return p.locator("#palco").screenshot({ type: "png", animations: "disabled", caret: "hide" });
}

let falhou = false;
try {
  // 1. Determinismo
  const amostra = (process.env.AMOSTRA || "0,300,800,905,1000,1234,1400,1500,1620,1700,2000,2130,2250,2760,3300,3599").split(",").map(Number);
  const p1 = await novaPagina();
  const ida = {};
  for (const n of amostra) ida[n] = sha(await quadro(p1, n));
  const volta = {};
  for (const n of [...amostra].reverse()) volta[n] = sha(await quadro(p1, n));
  const p2 = await novaPagina();
  const outra = {};
  for (const n of [amostra[3], amostra[7], amostra[1]]) outra[n] = sha(await quadro(p2, n));
  console.log("1. Determinismo (hash do PNG)");
  for (const n of amostra) {
    const ok = ida[n] === volta[n] && (outra[n] === undefined || outra[n] === ida[n]);
    if (!ok) falhou = true;
    console.log(`   quadro ${String(n).padStart(4)}  ${ida[n]}  ${ok ? "igual em todas as ordens" : `DIFERENTE (volta ${volta[n]}, página nova ${outra[n]})`}`);
  }

  // 2. Loop: diferença média por pixel (0–255), medida no próprio navegador
  const TOTAL = await p1.evaluate(() => window.TOTAL_QUADROS);
  const pares = [[TOTAL - 1, 0], [0, 1], [1, 2], [TOTAL - 2, TOTAL - 1]];
  const imgs = {};
  for (const n of new Set(pares.flat())) imgs[n] = (await quadro(p1, n)).toString("base64");
  const dif = await p1.evaluate(async ({ imgs, pares }) => {
    const carregar = b64 => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + b64; });
    const dados = {};
    for (const [n, b64] of Object.entries(imgs)) {
      const im = await carregar(b64), c = document.createElement("canvas");
      c.width = im.width; c.height = im.height;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      dados[n] = g.getImageData(0, 0, c.width, c.height).data;
    }
    return pares.map(([a, b]) => {
      const A = dados[a], B = dados[b];
      let s = 0;
      for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      return s / (A.length / 4 * 3);
    });
  }, { imgs, pares });
  console.log("2. Loop (diferença média por canal, 0–255)");
  pares.forEach(([a, b], i) => console.log(`   ${String(a).padStart(4)} → ${String(b).padStart(4)}: ${dif[i].toFixed(3)}${i === 0 ? "   ← emenda do loop" : ""}`));
  const normal = Math.max(...dif.slice(1));
  const emendaOk = dif[0] <= normal * 1.5 + 0.05;
  if (!emendaOk) falhou = true;
  console.log(`   ${emendaOk ? "OK: a emenda é do tamanho de um passo normal" : "PULO: a emenda é maior que um passo normal"}`);
} finally {
  await navegador.close();
  servidor.close();
}
process.exit(falhou ? 1 : 0);
