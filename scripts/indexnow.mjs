#!/usr/bin/env node
// IndexNow ping (Bing, Yandex, Seznam, Naver… share submissions through api.indexnow.org).
//
//   node scripts/indexnow.mjs                 → every URL in the live sitemap
//   node scripts/indexnow.mjs <url> [<url>…]  → only these
//
// The key is public by design: it is served at <site>/indexnow.txt (src/app/indexnow.txt).
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "").replace(/\/$/, "");
if (!SITE) throw new Error("set NEXT_PUBLIC_SITE_URL (e.g. https://example.com)");
const host = new URL(SITE).host;
const keyLocation = `${SITE}/indexnow.txt`;

const served = await fetch(keyLocation).then((r) => (r.ok ? r.text() : ""));
const key = (process.env.INDEXNOW_KEY ?? served).trim();
if (!key) throw new Error(`no IndexNow key: set INDEXNOW_KEY or serve ${keyLocation}`);
if (served.trim() !== key) throw new Error(`${keyLocation} does not serve this key; search engines would reject the ping`);

let urls = process.argv.slice(2);
if (!urls.length) {
  const xml = await fetch(`${SITE}/sitemap.xml`).then((r) => r.text());
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}
const foreign = urls.filter((u) => new URL(u).host !== host);
if (foreign.length) throw new Error(`URLs outside ${host}: ${foreign.join(", ")}`);
if (!urls.length) throw new Error("nothing to submit");

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
});
console.log(`IndexNow ${res.status} ${res.statusText}: ${urls.length} URL${urls.length === 1 ? "" : "s"} for ${host}`);
if (res.status !== 200 && res.status !== 202) {
  console.error((await res.text()).slice(0, 500));
  process.exit(1);
}
