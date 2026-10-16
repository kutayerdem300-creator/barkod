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


// ---------- Web kaynağı: arama motoru + sayfalardan barkod okuma
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ATLA = /(google\.|youtube\.|facebook\.|instagram\.|pinterest\.|twitter\.|x\.com|wikipedia\.|reddit\.|tiktok\.|linkedin\.|duckduckgo\.|bing\.com|microsoft\.com\/|\.pdf($|\?))/i;
async function metinGetir(url, ms) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.text()).slice(0, 700000);
}
const htmlCoz = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
function bingUrlCoz(h) {
  try {
    const u = new URL(htmlCoz(h)); const b = u.searchParams.get("u");
    if (u.hostname.endsWith("bing.com") && b && /^a1/.test(b)) return Buffer.from(b.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return u.hostname.endsWith("bing.com") ? "" : u.href;
  } catch (e) { return ""; }
}
function ddgUrlCoz(h) {
  try { const u = new URL(htmlCoz(h), "https://duckduckgo.com"); const d = u.searchParams.get("uddg"); return d ? decodeURIComponent(d) : (u.hostname.includes("duckduckgo") ? "" : u.href); } catch (e) { return ""; }
}
const etiketsiz = (t) => htmlCoz(String(t || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
async function aramaSonuclari(sorgu, ms) {
  // üç arama motorunu aynı anda dene; hangisi çalışırsa onun sonuçlarını birleştir
  const motorlar = {
    ddg: async () => {
      const html = await metinGetir("https://html.duckduckgo.com/html/?" + new URLSearchParams({ q: sorgu, kl: "tr-tr" }), ms), o = [];
      for (const m of html.matchAll(/<a([^>]+class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)) { const h = /href="([^"]+)"/.exec(m[1]); if (h) { const u = ddgUrlCoz(h[1]); if (u) o.push({ url: u, baslik: etiketsiz(m[2]) }); } }
      return o;
    },
    mojeek: async () => {
      const html = await metinGetir("https://www.mojeek.com/search?" + new URLSearchParams({ q: sorgu }), ms), o = [];
      for (const m of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)) { if (!/class="[^"]*\btitle\b/.test(m[1])) continue; const h = /href="([^"]+)"/.exec(m[1]); if (h && /^https?:/.test(htmlCoz(h[1]))) o.push({ url: htmlCoz(h[1]), baslik: etiketsiz(m[2]) }); }
      return o;
    },
    bing: async () => {
      const html = await metinGetir("https://www.bing.com/search?" + new URLSearchParams({ q: sorgu, setlang: "tr-TR", mkt: "tr-TR", cc: "TR" }), ms), o = [];
      for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a([^>]+)>([\s\S]*?)<\/a>/g)) { const h = /href="([^"]+)"/.exec(m[1]); if (h) { const u = bingUrlCoz(h[1]); if (u) o.push({ url: u, baslik: etiketsiz(m[2]) }); } }
      return o;
    },
  };
  const adlar = Object.keys(motorlar), sayim = {}, liste = [];
  const sonuc = await Promise.allSettled(adlar.map((a) => motorlar[a]()));
  sonuc.forEach((r, i) => { sayim[adlar[i]] = r.status === "fulfilled" ? r.value.length : "x"; if (r.status === "fulfilled") liste.push(...r.value); });
  const gorulen = new Set(), temiz = [];
  for (const r of liste) { if (ATLA.test(r.url) || !/^https?:/.test(r.url)) continue; let k; try { const x = new URL(r.url); k = x.hostname.replace(/^www\./, "") + x.pathname; } catch (e) { continue; } if (gorulen.has(k)) continue; gorulen.add(k); temiz.push(r); }
  return { sonuc: temiz, motor: JSON.stringify(sayim), ham: liste.length };
}
const alnum = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Sayfadan barkod adaylarını çıkarır: önce yapılandırılmış alanlar (JSON-LD, itemprop), yoksa "EAN/Barkod" etiketinin yanındaki sayı
function barkodlariCikar(html) {
  const yap = new Set(), etiket = new Set();
  for (const m of html.matchAll(/"(?:gtin|gtin8|gtin12|gtin13|gtin14|ean|ean13|barcode|barkod)"\s*:\s*"?(\d{8,14})"?/gi)) yap.add(m[1]);
  for (const m of html.matchAll(/itemprop=["'](?:gtin\d*|ean|barcode)["'][^>]*?content=["'](\d{8,14})["']/gi)) yap.add(m[1]);
  for (const m of html.matchAll(/content=["'](\d{8,14})["'][^>]*?itemprop=["'](?:gtin\d*|ean|barcode)["']/gi)) yap.add(m[1]);
  if (!yap.size) for (const m of html.matchAll(/(?:\bEAN(?:-?13)?|\bGTIN(?:-?1[34])?|Barkod(?:\s*No)?|Barcode)\s*(?:Kodu|Numaras[ıi]|No|Number|:)?\s*(?:<[^>]+>\s*){0,4}[:\s]*(\d{8,14})\b/gi)) etiket.add(m[1]);
  return [...(yap.size ? yap : etiket)];
}
function sayfaCoz(html, kodlar, url, q) {
  const baslik = htmlCoz((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1]).replace(/\s+/g, " ").trim().slice(0, 140);
  const h1 = htmlCoz((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [, ""])[1]).replace(/<[^>]+>/g, " ");
  let yol = ""; try { yol = new URL(url).pathname; } catch (e) {}
  const bas = alnum(baslik + " " + h1 + " " + yol);
  const kodVar = kodlar.some((k) => bas.includes(alnum(k)));
  const kelimeler = String(q || "").toLowerCase().replace(/[ıİ]/g, "i").replace(/[^a-z0-9ğüşöç ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  const metin = (baslik + " " + h1 + " " + yol).toLowerCase().replace(/[ıİ]/g, "i");
  const kapsam = kelimeler.length ? kelimeler.filter((w) => metin.includes(w)).length / kelimeler.length : 0;
  return { baslik, kodVar, kapsam, barkodlar: barkodlariCikar(html) };
}
function gecerliEan(k) {
  if (!/^\d+$/.test(k) || ![8, 12, 13, 14].includes(k.length)) return false;
  const d = k.split("").map(Number), c = d.pop();
  return (10 - (d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10 === c;
}
async function webAra(p) {
  const bitis = Date.now() + 8200;
  const kalan = () => Math.max(500, bitis - Date.now());
  const kodlar = (p.kod ? p.kod.split(",") : []).map((x) => x.trim()).filter(Boolean);
  const kelimeler = String(p.q || "").toLowerCase().replace(/[ıİ]/g, "i").replace(/[^a-z0-9ğüşöç ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  const ilgili = (r) => {
    const m = r.baslik + " " + r.url;
    if (kodlar.length) return kodlar.some((k) => alnum(m).includes(alnum(k)));
    const t = m.toLowerCase().replace(/[ıİ]/g, "i"); return kelimeler.length > 0 && kelimeler.filter((w) => t.includes(w)).length / kelimeler.length >= 0.6;
  };
  const sorgular = kodlar.length ? [((p.marka ? p.marka + " " : "") + kodlar[0] + " barkod"), ((p.marka ? p.marka + " " : "") + kodlar[0])] : [p.q + " barkod"];
  const secilen = [], motorlar = [], gorulen = new Set(), tumBasliklar = [];
  const sonuclar2 = await Promise.all(sorgular.map((sg) => aramaSonuclari(sg, 3200)));
  sonuclar2.forEach(({ sonuc, motor }) => {
    motorlar.push(motor);
    for (const r of sonuc) { tumBasliklar.push(r.baslik.slice(0, 50)); if (!gorulen.has(r.url) && ilgili(r)) { gorulen.add(r.url); secilen.push(r); } }
  });
  const urls = secilen.slice(0, 6).map((r) => r.url);
  if (!urls.length) return { sonuclar: [], bakilan: 0, motorlar, gorulenBasliklar: tumBasliklar.slice(0, 6), not: "Arama sonuçlarında bu ürünün sayfası görünmedi" };
  const ayrinti = [];
  const sayfalar = await Promise.all(urls.map(async (u) => {
    const h = new URL(u).hostname.replace(/^www\./, "");
    try { const s = sayfaCoz(await metinGetir(u, Math.min(4500, kalan())), kodlar.length ? kodlar : [p.q], u, p.q); s.url = u; ayrinti.push({ site: h, kodVar: s.kodVar, kapsam: Math.round(s.kapsam * 100) / 100, barkodlar: [...new Set(s.barkodlar)].length, baslik: s.baslik.slice(0, 60) }); return s; } catch (e) { ayrinti.push({ site: h, hata: String(e.message || e).slice(0, 40) }); return null; }
  }));
  const oy = new Map();
  for (const s of sayfalar) {
    if (!s) continue;
    const d = new URL(s.url).hostname.replace(/^www\./, "");
    const ham = [...new Set(s.barkodlar)];
    if (ham.length > 2) continue;                            // çok barkodlu sayfa = liste/kategori sayfası
    const adaylar = ham.filter(gecerliEan);
    if (!adaylar.length) continue;
    if (kodlar.length ? !s.kodVar : s.kapsam < 0.6) continue;   // model kodu (ya da adın çoğu) başlıkta yoksa bu ürünün sayfası olmayabilir
    for (const b of adaylar) { const o = oy.get(b) || { alanlar: new Set(), baslik: s.baslik, url: s.url }; o.alanlar.add(d); oy.set(b, o); }
  }
  return {
    sonuclar: [...oy.entries()].map(([b, o]) => ({ barkod: barkodDuzelt(b), ad: o.baslik, marka: p.marka || "", web: { sayfa: o.alanlar.size, alanlar: [...o.alanlar].slice(0, 3), url: o.url, kodVar: kodlar.length > 0 } }))
      .sort((a, b) => b.web.sayfa - a.web.sayfa).slice(0, 5),
    bakilan: urls.length, motorlar, ayrinti,
  };
}

async function sonda(p) {   // GEÇİCİ tanılama: bir adrese sunucudan istek atıp ne döndüğünü gösterir
  if (!/^https?:\/\//.test(p.url)) throw new Error("url yok");
  const r = await fetch(p.url, { headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", Accept: "text/html,application/json" }, redirect: "follow", signal: AbortSignal.timeout(7000) });
  const t = (await r.text()).slice(0, 600000);
  const eans = [...new Set((t.match(/\b\d{13}\b/g) || []))].filter(gecerliEan).slice(0, 8);
  return { durum: r.status, boyut: t.length, bas: t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300), eans, baglar: [...new Set([...t.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]))].slice(0, 12) };
}

const KAYNAKLAR = {
  sonda,
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
  web: async (p) => webAra(p),
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
  const girdi = { url: (p.url || "").slice(0, 400), q: (p.q || "").trim().slice(0, 200), marka: (p.marka || "").trim().slice(0, 60), kod: (p.kod || "").trim().slice(0, 120) };
  if (p.kaynak !== "sonda" && !girdi.q && !(girdi.marka && girdi.kod)) return cevap(400, { hata: "Aranacak ürün adı boş." });
  try {
    return cevap(200, await kaynak(girdi));
  } catch (e) {
    return cevap(200, { hata: String((e && e.message) || e) });
  }
};
exports._test = { barkodDuzelt };
