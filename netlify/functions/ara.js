// Barkod Bulucu - Netlify fonksiyonu (v2)
// Tek görev: şifreyi doğrulamak ve seçilen TEK kaynağı sunucu tarafında sorgulamak
// (tarayıcılar bu kaynakları doğrudan okuyamaz: CORS). Puanlama sayfada yapılır.
// Ortam değişkenleri (Netlify > Site configuration > Environment variables):
//   SIFRE             -> siteyi kullanacakların gireceği şifre (zorunlu)
//   EAN_SEARCH_TOKEN  -> EAN-Search.org API anahtarı (isteğe bağlı; yoksa o kaynak atlanır)
const crypto = require("crypto");

function barkodDuzelt(k) {
  k = String(k || "").replace(/\D/g, "");
  return [8, 13, 14].includes(k.length) ? k : k ? k.padStart(13, "0") : "";
}

async function getJson(url, ayar = {}) {
  let r;
  for (let deneme = 0; deneme < 2; deneme++) {
    r = await fetch(url, { headers: { "User-Agent": "BarkodBulucu/2.0", Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    if (r.status >= 500 && deneme === 0) { await new Promise((ok) => setTimeout(ok, 800)); continue; }   // geçici sunucu hatası: bir kez daha dene
    break;
  }
  if (r.status === 404 && ayar.bos404) return null;     // UPCitemdb: sonuç yoksa 404 döner
  if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 429 ? " (limit doldu, biraz bekle)" : r.status >= 500 ? " (kaynak şu an yoğun, sonra tekrar dene)" : ""));
  return r.json();
}

const KAYNAKLAR = {
  ean: async (q) => {
    const token = (process.env.EAN_SEARCH_TOKEN || "").trim();
    if (!token) return { atlandi: "EAN_SEARCH_TOKEN tanımlı değil (atlandı)" };
    const v = await getJson("https://api.ean-search.org/api?" + new URLSearchParams({ token, op: "product-search", name: q, language: "99", format: "json" }));
    if (v && v.error) throw new Error(String(v.error));
    return { sonuclar: (Array.isArray(v) ? v : v.productlist || []).slice(0, 10).map((p) => ({ barkod: barkodDuzelt(p.ean), ad: p.name || "", marka: "" })) };
  },
  upc: async (q) => {
    const v = await getJson("https://api.upcitemdb.com/prod/trial/search?" + new URLSearchParams({ s: q, match_mode: "0", type: "product" }), { bos404: true });
    return { sonuclar: ((v && v.items) || []).slice(0, 10).map((i) => ({ barkod: barkodDuzelt(i.ean || i.upc), ad: i.title || "", marka: i.brand || "" })) };
  },
  off: async (q) => {
    const v = await getJson("https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({ search_terms: q, search_simple: "1", action: "process", json: "1", page_size: "10", fields: "code,product_name,brands" }));
    return { sonuclar: (v.products || []).map((p) => ({ barkod: barkodDuzelt(p.code), ad: p.product_name || "", marka: p.brands || "" })) };
  },
};

function sifreDogru(gelen) {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(gelen || ""), h(process.env.SIFRE));
}
const cevap = (kod, obj) => ({
  statusCode: kod,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (!process.env.SIFRE) return cevap(500, { hata: "Sunucuda SIFRE ortam değişkeni tanımlı değil (Netlify > Environment variables)." });
  if (!sifreDogru((event.headers || {})["x-sifre"])) return cevap(401, { hata: "Şifre yanlış." });
  const p = event.queryStringParameters || {};
  const kaynak = KAYNAKLAR[p.kaynak];
  if (!kaynak) return cevap(400, { hata: "Bilinmeyen kaynak." });
  const q = (p.q || "").trim().slice(0, 200);
  if (!q) return cevap(400, { hata: "Aranacak ürün adı boş." });
  try {
    return cevap(200, await kaynak(q));
  } catch (e) {
    return cevap(200, { hata: String((e && e.message) || e) });
  }
};
exports._test = { barkodDuzelt };// Barkod Bulucu - Netlify fonksiyonu (v2)
// Tek görev: şifreyi doğrulamak ve seçilen TEK kaynağı sunucu tarafında sorgulamak
// (tarayıcılar bu kaynakları doğrudan okuyamaz: CORS). Puanlama sayfada yapılır.
// Ortam değişkenleri (Netlify > Site configuration > Environment variables):
//   SIFRE             -> siteyi kullanacakların gireceği şifre (zorunlu)
//   EAN_SEARCH_TOKEN  -> EAN-Search.org API anahtarı (isteğe bağlı; yoksa o kaynak atlanır)
const crypto = require("crypto");

function barkodDuzelt(k) {
  k = String(k || "").replace(/\D/g, "");
  return [8, 13, 14].includes(k.length) ? k : k ? k.padStart(13, "0") : "";
}

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "BarkodBulucu/2.0", Accept: "application/json" }, signal: AbortSignal.timeout(8500) });
  if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 429 ? " (limit doldu, biraz bekle)" : ""));
  return r.json();
}

const KAYNAKLAR = {
  ean: async (q) => {
    const token = (process.env.EAN_SEARCH_TOKEN || "").trim();
    if (!token) return { atlandi: "EAN_SEARCH_TOKEN tanımlı değil (atlandı)" };
    const v = await getJson("https://api.ean-search.org/api?" + new URLSearchParams({ token, op: "product-search", name: q, language: "99", format: "json" }));
    if (v && v.error) throw new Error(String(v.error));
    return { sonuclar: (Array.isArray(v) ? v : v.productlist || []).slice(0, 10).map((p) => ({ barkod: barkodDuzelt(p.ean), ad: p.name || "", marka: "" })) };
  },
  upc: async (q) => {
    const v = await getJson("https://api.upcitemdb.com/prod/trial/search?" + new URLSearchParams({ s: q, match_mode: "0", type: "product" }));
    return { sonuclar: (v.items || []).slice(0, 10).map((i) => ({ barkod: barkodDuzelt(i.ean || i.upc), ad: i.title || "", marka: i.brand || "" })) };
  },
  off: async (q) => {
    const v = await getJson("https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({ search_terms: q, search_simple: "1", action: "process", json: "1", page_size: "10", fields: "code,product_name,brands" }));
    return { sonuclar: (v.products || []).map((p) => ({ barkod: barkodDuzelt(p.code), ad: p.product_name || "", marka: p.brands || "" })) };
  },
};

function sifreDogru(gelen) {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(gelen || ""), h(process.env.SIFRE));
}
const cevap = (kod, obj) => ({
  statusCode: kod,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (!process.env.SIFRE) return cevap(500, { hata: "Sunucuda SIFRE ortam değişkeni tanımlı değil (Netlify > Environment variables)." });
  if (!sifreDogru((event.headers || {})["x-sifre"])) return cevap(401, { hata: "Şifre yanlış." });
  const p = event.queryStringParameters || {};
  const kaynak = KAYNAKLAR[p.kaynak];
  if (!kaynak) return cevap(400, { hata: "Bilinmeyen kaynak." });
  const q = (p.q || "").trim().slice(0, 200);
  if (!q) return cevap(400, { hata: "Aranacak ürün adı boş." });
  try {
    return cevap(200, await kaynak(q));
  } catch (e) {
    return cevap(200, { hata: String((e && e.message) || e) });
  }
};
exports._test = { barkodDuzelt };
