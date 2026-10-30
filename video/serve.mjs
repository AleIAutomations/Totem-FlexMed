// Servidor local do vídeo (preview e render). Tudo sai do disco: nenhuma CDN.
//
//  /video/                 palco (src/index.html) com renderFrame(n)
//  /video/totem.html       o index.html REAL do totem, sem os scripts dele, com o
//                          controlador do vídeo no lugar (dados fictícios, estado por quadro)
//  /video/totem-real.js    funções copiadas do frontend/script.js EM TEMPO DE EXECUÇÃO
//                          (productCardHtml, chipHtml, renderNav, mostrarAdicionado...),
//                          com setTimeout/requestAnimationFrame neutralizados
//  /frontend/*             arquivos reais do totem (styles.css, totem.css, icones.js)
//
// Uso: node serve.mjs [--abrir]   (porta 5077, ou FLEXMED_VIDEO_PORTA)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import QRCode from "qrcode";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const FRONTEND = path.join(RAIZ, "frontend");
const FONTES = path.join(AQUI, "node_modules/@fontsource/atkinson-hyperlegible-next/files");

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".webp": "image/webp",
};

// ── Extrai do script.js real o código de funções e constantes, pelo nome ────────
// Conta chaves fora de strings e comentários, respeitando template literals com ${...}.
function fimDoBloco(src, inicio) {
  // pilha: "{" "[" "(" = código aberto; "${" = expressão dentro de template; "`" = template
  const pilha = [];
  let i = inicio;
  while (!"{[(".includes(src[i])) i++;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1], topo = pilha[pilha.length - 1];
    if (topo === "`") {
      if (c === "\\") i++;
      else if (c === "`") pilha.pop();
      else if (c === "$" && d === "{") { pilha.push("${"); i++; }
      continue;
    }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === "/" && /[(,=:[!&|?{};]$/.test(src.slice(0, i).trimEnd())) {   // regex literal
      for (i++; i < src.length && src[i] !== "/"; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") while (src[++i] !== "]") if (src[i] === "\\") i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "`") { pilha.push("`"); continue; }
    if ("{[(".includes(c)) { pilha.push(c); continue; }
    if ("}])".includes(c)) {
      pilha.pop();
      if (!pilha.length) return i + 1;
    }
  }
  throw new Error("bloco sem fim a partir de " + inicio);
}

function extrair(src, nome) {
  const fn = new RegExp(`(?:async\\s+)?function\\s+${nome}\\s*\\(`).exec(src);
  if (fn) {
    // pula a lista de parâmetros (pode ter valores padrão) até a chave do corpo
    const fechaParams = fimParenteses(src, fn.index + fn[0].length - 1);
    return src.slice(fn.index, fimDoBloco(src, fechaParams));
  }
  const cst = new RegExp(`const\\s+${nome}\\s*=\\s*`).exec(src);
  if (cst) {
    const abre = cst.index + cst[0].length;
    return src.slice(cst.index, fimDoBloco(src, abre)) + ";";
  }
  throw new Error(`não achei ${nome} no script.js`);
}

function fimParenteses(src, abre) {
  let prof = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === "(") prof++;
    if (src[i] === ")" && --prof === 0) return i + 1;
  }
  throw new Error("parênteses sem fim");
}

const FUNCOES_REAIS = [
  "escapeHtml", "escapeJs", "clampText", "e", "L", "icon", "fmtBRL", "precoLabel", "descontoInfo",
  "getProductImagePath", "productIconSvg", "productImageOrIcon", "productCardHtml",
  "iconeCategoria", "chipHtml", "renderNav", "totalCarrinho", "atualizarDock",
  "openDetail", "renderRodapeDetalhe", "mostrarAdicionado", "fecharAdicionado",
  "addChatMessage", "agStatus", "agFalaAoVivo", "mostrarResultadoVoz", "renderCart", "mostrarCodigoPedido",
  "navItems",
];

function totemReal() {
  const src = fs.readFileSync(path.join(FRONTEND, "script.js"), "utf8");
  const trechos = FUNCOES_REAIS.map(n => `// ── frontend/script.js › ${n}\n${extrair(src, n)}`);
  return `// GERADO por video/serve.mjs a partir de frontend/script.js. Não edite: mude o script.js.
// Timers e quadros de animação viram chamadas imediatas: o estado vem só de renderFrame(n).
window.TotemReal = (() => {
  const requestAnimationFrame = f => f();
  const setTimeout = () => 0, clearTimeout = () => {};
  const fetch = () => Promise.reject(new Error("sem rede no vídeo"));
  let currentLang = "pt", cart = [], produtos = [], currentProduct = null, qtdDetalhe = 1;
  let adicionadoTimer = 0, ultimaBuscaVoz = null;
  const config = { assistantMessage: "" };
  const i18n = { pt: { inicio: "Início", librasNav: "Libras", assistente: "Assistente", carrinho: "Carrinho",
    unavailable: "Produto indisponível no momento.", freeSale: "Livre", prescriptionSale: "Receita" } };
  const getText = () => i18n.pt;
  const NICHO_DA_CATEGORIA = { analgesico: "medicamentos", alergias: "medicamentos", vitaminas: "bem_estar", dermato: "beleza" };
  const translateCategoryLabel = (k, l) => l;
  const getTranslatedProduct = p => p;
  const tracksStock = p => typeof p.estoque === "number";
  const rastrear = () => {}, rastrearTela = () => {}, incMetric = () => {};
  const carregarRelacionados = () => {}, carregarRecsAdicionado = () => {};
  const navHome = () => {}, openOv = () => {}, toggleAg = () => {};
  const FlexVoz = { falar: () => {} };
  const FlexSessao = undefined;
${trechos.join("\n\n")}
  return {
    set cart(v) { cart = v; }, get cart() { return cart; },
    set produtos(v) { produtos = v; },
    productCardHtml, chipHtml, renderNav, atualizarDock, openDetail, mostrarAdicionado,
    addChatMessage, agFalaAoVivo, mostrarResultadoVoz, renderCart, mostrarCodigoPedido, icon, fmtBRL,
  };
})();
`;
}

// ── O index.html real do totem, sem os scripts dele ──────────────────────────────
function totemHtml() {
  let html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");
  html = html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
    .replace(/<link[^>]+fonts\.googleapis[^>]*>/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/g, "");             // nenhum script do totem roda
  const cabeca = `
    <link rel="stylesheet" href="/video/src/fontes.css">
    <style>
      /* Nada se move sozinho: o estado de cada quadro vem do renderFrame(n) */
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      html, body { margin: 0; overflow: hidden; background: transparent; }
    </style>`;
  const pe = `
    <script src="/frontend/icones.js"></script>
    <script src="/video/totem-real.js"></script>
    <script src="/video/src/totem-controle.js"></script>`;
  html = html.replace(/<html([^>]*)>/, '<html$1 class="totem-v" style="--k:1;--tela-w:480px;--tela-h:853px">')
             .replace(/<head>/, '<head>\n    <base href="/frontend/">')
             .replace("</head>", cabeca + "\n</head>")
             .replace("</body>", pe + "\n</body>");
  return html;
}

async function qrSvg() {
  const conteudo = JSON.parse(fs.readFileSync(path.join(AQUI, "content.json"), "utf8"));
  return QRCode.toString(conteudo.contato.qr, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1b33", light: "#ffffff" } });
}

function enviarArquivo(res, arquivo) {
  fs.readFile(arquivo, (err, dados) => {
    if (err) { res.writeHead(404); res.end("não encontrado"); return; }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(dados);
  });
}

function dentro(base, rel) {
  const alvo = path.resolve(base, "." + rel);
  return alvo.startsWith(base) ? alvo : null;
}

// Chrome em modo de render determinístico (o mesmo conjunto do --deterministic-mode do headless):
// todo o compositor roda antes de desenhar, imagens decodificam de forma síncrona e não há
// tiles de baixa resolução. Sem isso o quadro capturado depende do que veio antes.
export function abrirChrome(chromium) {
  const args = [
    "--run-all-compositor-stages-before-draw", "--disable-checker-imaging", "--disable-low-res-tiling",
    "--disable-threaded-animation", "--disable-threaded-scrolling", "--disable-new-content-rendering-timeout",
    "--disable-image-animation-resync", "--force-color-profile=srgb", "--hide-scrollbars",
    "--disable-gpu",            // rasterização por software: bit a bit igual entre execuções
  ];
  return chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args } : { channel: "chrome", args });
}

export function iniciarServidor(porta = Number(process.env.FLEXMED_VIDEO_PORTA || 5077)) {
  const servidor = http.createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try {
      if (url === "/" || url === "/video" || url === "/video/") return enviarArquivo(res, path.join(AQUI, "src/index.html"));
      const gerado = { "/video/totem.html": [".html", totemHtml], "/video/totem-real.js": [".js", totemReal], "/video/qr.svg": [".svg", qrSvg] }[url];
      if (gerado) {
        const corpo = await gerado[1]();
        res.writeHead(200, { "Content-Type": TIPOS[gerado[0]], "Cache-Control": "no-store" });
        return res.end(corpo);
      }
      if (url === "/video/content.json") return enviarArquivo(res, path.join(AQUI, "content.json"));
      let alvo = null;
      if (url.startsWith("/video/src/")) alvo = dentro(path.join(AQUI, "src"), url.slice("/video/src".length));
      else if (url.startsWith("/fontes/")) alvo = dentro(FONTES, url.slice("/fontes".length));
      else if (url.startsWith("/frontend/")) alvo = dentro(FRONTEND, url.slice("/frontend".length));
      if (!alvo) { res.writeHead(404); return res.end("não encontrado"); }
      enviarArquivo(res, alvo);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(err.stack || err));
    }
  });
  return new Promise((ok, falha) => {
    servidor.once("error", falha);
    servidor.listen(porta, "127.0.0.1", () => ok({ servidor, url: `http://127.0.0.1:${porta}` }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await iniciarServidor();
  const preview = `${url}/video/?preview=1`;
  console.log(`Preview: ${preview}   (Ctrl+C para parar)`);
  if (process.argv.includes("--abrir")) execFile(process.platform === "darwin" ? "open" : "xdg-open", [preview]);
}
