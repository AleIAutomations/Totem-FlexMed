// =====================================================
// FlexMed v5 — API Layer
// Backend local: backend/app.py (porta 5050)
// Não inclua chaves service_role no frontend.
// =====================================================

// O backend (notebook) serve o próprio frontend, então normalmente o servidor é
// a mesma origem da página (ex.: https://192.168.0.10:5050 no totem).
// Aberta por outro servidor (porta 3000) ou como arquivo, usa a porta 5050 do mesmo host.
// Para outro endereço, defina window.FLEXMED_SERVER antes de carregar este arquivo.
const FLEXMED_SERVER = (window.FLEXMED_SERVER || (
  location.protocol.startsWith("http") && location.port !== "3000"
    ? location.origin
    : `http://${location.hostname || "localhost"}:5050`
)).replace(/\/$/, "");
const FLEXMED_API_BASE = (window.FLEXMED_API_BASE || `${FLEXMED_SERVER}/api`).replace(/\/$/, "");

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(FLEXMED_API_BASE + path, {
      ...options,
      headers: options.body instanceof FormData ? (options.headers || {}) : {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("FlexMed API error:", res.status, err);
      return null;
    }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    console.warn("FlexMed API offline:", err);
    return null;
  }
}

// PRODUTOS
async function apiGetProducts() {
  return await apiFetch("/products") || [];
}

async function apiSearch(q, categoria = "") {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (categoria) params.set("categoria", categoria);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return await apiFetch(`/products${qs}`) || [];
}

// Uma página do catálogo: { items, total } — ou null se o backend estiver offline
// Foto de produto do Supabase servida pelo notebook (/foto/…, reduzida e em cache); outros endereços seguem iguais
function fotoDoProduto(url, largura = 480) {
  const noStorage = String(url || "").match(/\/storage\/v1\/object\/public\/(.+)$/);
  return noStorage ? `/foto/${noStorage[1]}?w=${largura}` : url;
}

// Ofertas da casa (descanso de tela e banners do topo): os maiores descontos reais do catálogo,
// com foto. Propaganda de medicamento ao público tem regras (Anvisa): entram só itens fora do
// nicho Medicamentos e sem receita. Descontos acima de 70% costumam ser erro de preço "de" na
// coleta e ficam de fora. Cada item ganha `pct` (desconto em %).
async function apiOfertasDaCasa(quantas = 3) {
  try {
    const [categorias, ...paginas] = await Promise.all([
      apiGetCategorias().catch(() => []),
      ...[0, 100, 200, 300].map(offset => apiGetProductsPage({ limit: 100, offset })),
    ]);
    const remedios = new Set((categorias || []).filter(c => c.nicho === "medicamentos").map(c => c.slug));
    return paginas.flatMap(pg => (pg && pg.items) || [])
      .filter(p => p.imgUrl && !p.receita && !remedios.has(p.categoria)
                && Number(p.precoValor) > 0 && Number(p.precoOriginal) > Number(p.precoValor))
      .map(p => ({ ...p, pct: Math.round((1 - p.precoValor / p.precoOriginal) * 100) }))
      .filter(p => p.pct <= 70)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, quantas);
  } catch (_) {
    return [];
  }
}

async function apiGetProductsPage({ q = "", categoria = "", nicho = "", limit = 24, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset });
  if (q) params.set("q", q);
  if (categoria) params.set("categoria", categoria);
  else if (nicho) params.set("nicho", nicho);
  try {
    const res = await fetch(`${FLEXMED_API_BASE}/products?${params}`);
    if (!res.ok) return null;
    const items = await res.json();
    const total = Number(res.headers.get("X-Total-Count"));
    return { items, total: Number.isFinite(total) ? total : items.length };
  } catch (err) {
    console.warn("FlexMed API offline:", err);
    return null;
  }
}

async function apiGetCategorias() {
  return await apiFetch("/categorias") || [];
}

async function apiCreateProduct(product) {
  return await apiFetch("/products", { method: "POST", body: JSON.stringify(product) });
}

async function apiUpdateProduct(id, fields) {
  return await apiFetch(`/products/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(fields) });
}

async function apiDeleteProduct(id) {
  return await apiFetch(`/products/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// CONFIG / WHITE LABEL
async function apiGetConfig(tenantId = "default") {
  return await apiFetch(`/config?tenant_id=${encodeURIComponent(tenantId)}`) || null;
}

async function apiSaveConfig(configObj, tenantId = "default") {
  return await apiFetch("/config", {
    method: "POST",
    body: JSON.stringify({ ...configObj, tenant_id: tenantId })
  });
}

// MÉTRICAS
async function apiGetMetrics(tenantId = "default") {
  return await apiFetch(`/metrics?tenant_id=${encodeURIComponent(tenantId)}`) || { views: 0, libras: 0, score: 0 };
}

async function apiTrackEvent(type) {
  if (!["view", "views", "libras"].includes(type)) return;
  return await apiFetch("/metrics/event", { method: "POST", body: JSON.stringify({ type, tenant_id: "default" }) });
}

async function apiSaveRating(score) {
  if (score < 1 || score > 5) return;
  return await apiFetch("/metrics/rating", { method: "POST", body: JSON.stringify({ score, tenant_id: "default" }) });
}

// CAMPANHAS
async function apiGetCampaigns(tenantId = "default") {
  return await apiFetch(`/campaigns?tenant_id=${encodeURIComponent(tenantId)}&active=true`) || [];
}

async function apiGetAllCampaigns(tenantId = "default") {
  return await apiFetch(`/campaigns?tenant_id=${encodeURIComponent(tenantId)}`) || [];
}

async function apiCreateCampaign(campaign) {
  return await apiFetch("/campaigns", { method: "POST", body: JSON.stringify({ tenant_id: "default", ...campaign }) });
}

async function apiUpdateCampaign(id, fields) {
  return await apiFetch(`/campaigns/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(fields) });
}

async function apiDeleteCampaign(id) {
  return await apiFetch(`/campaigns/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function apiTrackCampaignEvent(campaignId, eventType, tenantId = "default") {
  return await apiFetch("/campaign_analytics", {
    method: "POST",
    body: JSON.stringify({ campaign_id: campaignId, event_type: eventType, tenant_id: tenantId })
  });
}

async function apiGetCampaignAnalytics(tenantId = "default") {
  return await apiFetch(`/campaign_analytics?tenant_id=${encodeURIComponent(tenantId)}`) || [];
}

// VISÃO COMPUTACIONAL
async function apiSaveVisionMetric(metric) {
  return await apiFetch("/vision_metrics", { method: "POST", body: JSON.stringify({ tenant_id: "default", ...metric }) });
}

async function apiGetVisionMetrics(tenantId = "default", days = 1) {
  return await apiFetch(`/vision_metrics?tenant_id=${encodeURIComponent(tenantId)}&days=${encodeURIComponent(days)}`) || [];
}

// HEATMAP DE TOQUE
async function apiSaveTouchPoint(xPct, yPct, campaignId = null) {
  return await apiFetch("/touch_heatmap", {
    method: "POST",
    body: JSON.stringify({ x_pct: xPct, y_pct: yPct, campaign_id: campaignId, tenant_id: "default" })
  });
}

async function apiGetTouchHeatmap(tenantId = "default", days = 7) {
  return await apiFetch(`/touch_heatmap?tenant_id=${encodeURIComponent(tenantId)}&days=${encodeURIComponent(days)}`) || [];
}

// IMAGEM DE PRODUTO (vai para o Supabase Storage via backend)
async function apiUploadProductImage(file) {
  const data = new FormData();
  data.append("file", file);
  const out = await apiFetch("/products/image", { method: "POST", body: data });
  if (!out || !out.url) throw new Error("Falha no upload da imagem");
  return out.url;
}

// UPLOAD DE MÍDIA
async function apiUploadMedia(file) {
  const data = new FormData();
  data.append("file", file);
  const out = await apiFetch("/upload", { method: "POST", body: data });
  if (!out || !out.url) throw new Error("Falha no upload de mídia");
  return out.url;
}
