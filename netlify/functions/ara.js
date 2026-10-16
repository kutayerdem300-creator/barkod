// Barkod Bulucu - Netlify fonksiyonu (v3)
// Görev: şifreyi doğrulamak ve seçilen TEK kaynağı sunucu tarafında sorgulamak
// (tarayıcılar bu kaynakları doğrudan okuyamaz: CORS). Puanlama ve karar sayfada yapılır.
// Ortam değişkenleri (Netlify > Site configuration > Environment variables):
//   SIFRE             -> siteyi kullanacakların gireceği şifre (zorunlu)
//   EAN_SEARCH_TOKEN  -> EAN-Search.org API anahtarı (isteğe bağlı; yoksa o kaynak atlanır)
//   ICECAT_USER       -> Icecat kullanıcı adı (isteğe bağlı; yoksa herkese açık "openicecat-live" kullanılır)
const crypto = require("crypto");

function barkodDuzelt(k) {
  k = String(k || "").replace(/\D/g, "");
  return [8, 13, 14].includes(k.length) ? k : k ? k.padStart(13, "0") : "";
}

async function getJson(url, ayar = {}) {
  let r;
  for (let deneme = 0; deneme < 2; deneme++) {
    r = await fetch(url, { headers: { "User-Agent": "BarkodBulucu/3.0", Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    if (r.status >= 500 && deneme === 0) { await new Promise((ok) => setTimeout(ok, 800)); continue; }   // geçici sunucu hatası: bir kez daha dene
    break;
  }
  if (ayar.bos4xx && (r.status === 404 || r.status === 400 || r.status === 422)) return null;   // "sonuç yok" anlamında
  if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 429 ? " (limit doldu, biraz bekle)" : r.status >= 500 ? " (kaynak şu an yoğun, sonra tekrar dene)" : ""));
  return r.json();
}

const KAYNAKLAR = {
  ean: async (p) => {
    const token = (process.env.EAN_SEARCH_TOKEN || "").trim();
    if (!token) return { atlandi: "EAN_SEARCH_TOKEN tanımlı değil (atlandı)" };
    const v = await getJson("https://api.ean-search.org/api?" + new URLSearchParams({ token, op: "product-search", name: p.q, language: "99", format: "json" }));
    if (v && v.error) throw new Error(String(v.error));
    return { sonuclar: (Array.isArray(v) ? v : v.productlist || []).slice(0, 10).map((x) => ({ barkod: barkodDuzelt(x.ean), ad: x.name || "", marka: "" })) };
  },
  upc: async (p) => {
    const v = await getJson("https://api.upcitemdb.com/prod/trial/search?" + new URLSearchParams({ s: p.q, match_mode: "0", type: "product" }), { bos4xx: true });
    return { sonuclar: ((v && v.items) || []).slice(0, 10).map((i) => ({ barkod: barkodDuzelt(i.ean || i.upc), ad: i.title || "", marka: i.brand || "" })) };
  },
  off: async (p) => {
    const v = await getJson("https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({ search_terms: p.q, search_simple: "1", action: "process", json: "1", page_size: "10", fields: "code,product_name,brands" }));
    return { sonuclar: (v.products || []).map((x) => ({ barkod: barkodDuzelt(x.code), ad: x.product_name || "", marka: x.brands || "" })) };
  },
  // Icecat: marka + üretici model kodu ile birebir arama (aramada bulanık eşleşme yok, bulursa kesindir)
  icecat: async (p) => {
    if (!p.marka || !p.kod) return { sonuclar: [] };
    const user = (process.env.ICECAT_USER || "openicecat-live").trim();
    const v = await getJson("https://live.icecat.biz/api?" + new URLSearchParams({ lang: "EN", shopname: user, Brand: p.marka, ProductCode: p.kod }), { bos4xx: true });
    const g = v && v.data && v.data.GeneralInfo;
    if (!g) return { sonuclar: [] };
    const liste = [].concat(g.GTIN || []).map(barkodDuzelt).filter(Boolean);
    const ad = g.Title || g.ProductName || ((g.Brand || "") + " " + (g.BrandPartCode || p.kod)).trim();
    return { sonuclar: liste.slice(0, 5).map((b) => ({ barkod: b, ad, marka: g.Brand || p.marka, kesin: true })) };
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
  const girdi = { q: (p.q || "").trim().slice(0, 200), marka: (p.marka || "").trim().slice(0, 60), kod: (p.kod || "").trim().slice(0, 60) };
  if (!girdi.q && !(girdi.marka && girdi.kod)) return cevap(400, { hata: "Aranacak ürün adı boş." });
  try {
    return cevap(200, await kaynak(girdi));
  } catch (e) {
    return cevap(200, { hata: String((e && e.message) || e) });
  }
};
exports._test = { barkodDuzelt };
