// Посредник для каталогов, которые не пускают браузер: у поиска LitRes и подсказок Douban нет CORS, а обложки Douban
// отдаются только со своим Referer. Функция Yandex Cloud `shumi-proxy` (каталог shumi): Cloudflare с телефона Вики
// почти не отвечает, а Yandex Cloud стоит в России. Ничего не разбирает и не хранит — пересылает запрос по короткому
// списку адресов (разбор — в site/sources.js); чужой адрес — 403, так что открытым прокси она не станет.
//
//   GET ?u=<адрес из списка>  → ответ каталога как есть: JSON или картинка
//   GET ?ping=1               → {"ok":true}
//
// Выкладка — node tools/proxy-deploy.mjs (yc с профилем shumi).
const ORIGINS = ["https://shumi.sirenyov.link", "http://localhost:8760", "http://127.0.0.1:8760"];
const UA = "shumi/0.1 (+https://shumi.sirenyov.link)";
const TIMEOUT = 8000;
const DOUBAN = "https://book.douban.com/";
// maxAge — сколько браузер держит ответ у себя: поиск — час, обложка не меняется никогда.
const ALLOWED = [
  { re: /^https:\/\/api\.litres\.ru\/foundation\/api\/search\?/, maxAge: 3600 },
  { re: /^https:\/\/book\.douban\.com\/j\/subject_suggest\?/, maxAge: 3600, referer: DOUBAN },
  { re: /^https:\/\/img\d+\.doubanio\.com\/view\/subject\/[sml]\/public\/s\d+\.(jpe?g|png|webp)$/, maxAge: 31536000, referer: DOUBAN, image: true },
];

module.exports.handler = async event => {
  const h = Object.fromEntries(Object.entries(event?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const cors = { "Access-Control-Allow-Origin": ORIGINS.includes(h.origin) ? h.origin : ORIGINS[0], "Vary": "Origin" };
  const json = (statusCode, data) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store" }, body: JSON.stringify(data) });
  const q = event?.queryStringParameters ?? {};
  if (q.ping) return json(200, { ok: true });

  const u = String(q.u ?? "");
  const rule = ALLOWED.find(r => r.re.test(u));
  if (!rule) return json(403, { error: "такой адрес посредник не пересылает" });
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, ...(rule.referer && { Referer: rule.referer }) }, signal: AbortSignal.timeout(TIMEOUT) });
    const type = r.headers.get("content-type") ?? "";
    if (rule.image && !(r.ok && type.startsWith("image/"))) return json(502, { error: `обложка: ${r.status} ${type}` });
    const body = Buffer.from(await r.arrayBuffer());
    return {
      statusCode: r.status,
      headers: { ...cors, "Content-Type": type, "Cache-Control": r.ok ? `public, max-age=${rule.maxAge}` : "no-store" },
      body: rule.image ? body.toString("base64") : body.toString("utf8"),
      isBase64Encoded: Boolean(rule.image),
    };
  } catch (e) {
    return json(502, { error: e.name === "TimeoutError" ? `каталог не ответил за ${TIMEOUT / 1000} с` : e.message });
  }
};
