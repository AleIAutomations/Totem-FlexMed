// Render do vídeo: Chrome sem tela → renderFrame(n) → PNG → ffmpeg (H.264, 60 fps).
//
//   node render.mjs                     vídeo completo, 1080×1920 → out/totem-motion-vertical.mp4
//   node render.mjs --4k                2160×3840 (deviceScaleFactor 2; as cenas não mudam)
//   node render.mjs --frames 600:900    só um trecho (quadros 600 a 899) → out/trecho-600-900.mp4
//   node render.mjs --png 0,300,1200    só esses quadros, em PNG → out/quadros/
//
// Usa o Google Chrome instalado (ou o caminho em CHROME_PATH).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import ffmpeg from "ffmpeg-static";
import { iniciarServidor, abrirChrome } from "./serve.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(AQUI, "out");
const args = process.argv.slice(2);
const opcao = nome => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const k4 = args.includes("--4k");
const escala = k4 ? 2 : 1;

// porta própria do render (o preview usa a 5077), para os dois poderem rodar juntos
const { servidor, url } = await iniciarServidor(Number(process.env.FLEXMED_VIDEO_RENDER_PORTA || 5078));
const navegador = await abrirChrome(chromium);
const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: escala });
pagina.on("pageerror", e => console.error("Erro na página:", e.message));
await pagina.goto(`${url}/video/`);
await pagina.waitForFunction(() => window.__pronto === true, null, { timeout: 120000 });
const TOTAL = await pagina.evaluate(() => window.TOTAL_QUADROS);
const palco = pagina.locator("#palco");

async function quadro(n) {
  await pagina.evaluate(q => window.renderFrame(q), n);
  return palco.screenshot({ type: "png", animations: "disabled", caret: "hide" });
}

fs.mkdirSync(OUT, { recursive: true });
try {
  const png = opcao("--png");
  if (png) {
    const dir = path.join(OUT, "quadros");
    fs.mkdirSync(dir, { recursive: true });
    for (const n of png.split(",").map(Number)) {
      const arq = path.join(dir, `quadro-${String(n).padStart(4, "0")}${k4 ? "-4k" : ""}.png`);
      fs.writeFileSync(arq, await quadro(n));
      console.log(arq);
    }
  } else {
    const faixa = opcao("--frames");
    const [ini, fim] = faixa ? faixa.split(":").map(Number) : [0, TOTAL];
    const nome = faixa ? `trecho-${ini}-${fim}${k4 ? "-4k" : ""}.mp4` : `totem-motion-vertical${k4 ? "-4k" : ""}.mp4`;
    const saida = path.join(OUT, nome);
    const ff = spawn(ffmpeg, [
      "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "60", "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-r", "60",
      "-movflags", "+faststart", saida,
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const terminou = new Promise((ok, falha) => ff.on("close", c => c === 0 ? ok() : falha(new Error(`ffmpeg saiu com ${c}`))));
    const inicio = Date.now();
    for (let n = ini; n < fim; n++) {
      const img = await quadro(n);
      if (!ff.stdin.write(img)) await new Promise(ok => ff.stdin.once("drain", ok));
      const feitos = n - ini + 1;
      if (feitos % 60 === 0 || n === fim - 1) {
        const seg = (Date.now() - inicio) / 1000, falta = seg / feitos * (fim - ini - feitos);
        process.stdout.write(`\rquadro ${n + 1}/${fim}  ·  ${(feitos / seg).toFixed(1)} q/s  ·  falta ~${Math.ceil(falta / 60)} min   `);
      }
    }
    ff.stdin.end();
    await terminou;
    console.log(`\nPronto: ${saida}`);
  }
} finally {
  await navegador.close();
  servidor.close();
}
