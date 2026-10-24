// API книжной полки shumi на Cloudflare Workers. Этап 0 — поиск и замеры связи.
//
//   GET  /ping              → {ok, colo}: Worker жив; colo — дата-центр Cloudflare, принявший запрос
//   GET  /search/{src}?q=…  → {items, cached}: поиск в одном каталоге (src — litres | fantlab | openlibrary).
//                             Ответ каталога лежит в KV сутки, пустой — час. Каталог молчит дольше 7 с — 502
//   POST /netlog            → замеры связи с телефона: {dev, events: [{at, k, ok, ms, err}]}, до 200 за раз.
//                             Тело — JSON с типом text/plain: так браузер не шлёт предварительный OPTIONS,
//                             а на плохой связи каждый лишний запрос — лишний шанс не дойти
//   GET  /netlog/summary    → сводка замеров за 14 дней: по дням (МСК), устройствам и видам запросов
//
// Привязки: KV — кеш поиска, DB — база D1 (миграции в ../migrations).
import { SOURCES } from "../../site/sources.js";

const ORIGINS = ["https://shumi.sirenyov.link", "http://localhost:8760", "http://127.0.0.1:8760"];
const UA = "shumi/0.1 (+https://shumi.sirenyov.link)";
const SOURCE_TIMEOUT = 7000;   // Open Library бывает медленным: 4 с ему мало
const KINDS = new Set(["ping-cf", "ping-gh", "ping-ghapi", ...Object.keys(SOURCES).map(s => "search-" + s)]);
const DAY = 86400000, MSK = 3 * 3600000;

function cors(req) {
  const o = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

const json = (req, data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(req) },
});

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
export const normQuery = q => String(q ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);

async function search(req, env, ctx, src, rawQ) {
  const source = SOURCES[src];
  if (!source) return json(req, { error: "нет такого каталога" }, 404);
  const q = normQuery(rawQ);
  if (q.length < 2) return json(req, { error: "запрос короче двух букв" }, 400);

  const key = `s:${src}:${q}`;
  const hit = await env.KV.get(key, "json");
  if (hit) return json(req, { items: hit, cached: true });

  let items;
  try {
    const r = await fetch(source.url(q), {
      headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(SOURCE_TIMEOUT),
    });
    if (!r.ok) return json(req, { error: `${src} ответил ${r.status}` }, 502);
    items = source.parse(await r.json()).slice(0, 12);
  } catch (e) {
    return json(req, { error: `${src} не ответил: ${e.name === "TimeoutError" ? "дольше 7 с" : e.message}` }, 502);
  }
  ctx.waitUntil(env.KV.put(key, JSON.stringify(items), { expirationTtl: items.length ? 86400 : 3600 }));
  return json(req, { items, cached: false });
}

async function netlog(req, env) {
  let body;
  try { body = JSON.parse(await req.text()); } catch { return json(req, { error: "нужен JSON" }, 400); }
  const dev = clean(body?.dev, 16), events = Array.isArray(body?.events) ? body.events : null;
  if (!dev || !events || events.length > 200) return json(req, { error: "нужны dev и events, не больше 200" }, 400);

  const now = Date.now();
  const rows = events.filter(e => e && KINDS.has(e.k) && (e.ok === 0 || e.ok === 1)
    && Number.isInteger(e.ms) && e.ms >= 0 && e.ms <= 120000
    && Number.isInteger(e.at) && e.at > now - 30 * DAY && e.at < now + DAY);
  const { n } = await env.DB.prepare("SELECT count(*) AS n FROM netlog WHERE at > ?").bind(now - DAY).first();
  if (n + rows.length > 5000) return json(req, { error: "на сегодня замеров достаточно" }, 429);

  // Повтор той же пачки (ответ потерялся по дороге) не задвоит строки: уникальность по (dev, at, k).
  const colo = clean(req.cf?.colo, 8) || null;
  const ins = env.DB.prepare("INSERT OR IGNORE INTO netlog (at, k, ok, ms, err, dev, colo) VALUES (?, ?, ?, ?, ?, ?, ?)");
  if (rows.length) await env.DB.batch(rows.map(e => ins.bind(e.at, e.k, e.ok, e.ms, e.ok ? null : clean(e.err, 20) || null, dev, colo)));
  return json(req, { ok: true, saved: rows.length });
}

async function summary(req, env) {
  const since = Date.now() - 14 * DAY;
  const { results } = await env.DB.prepare(
    "SELECT date((at + ?) / 1000, 'unixepoch') AS day, dev, k, ok, ms, err, colo FROM netlog WHERE at > ? ORDER BY at",
  ).bind(MSK, since).all();

  const groups = new Map();
  for (const r of results) {
    const id = `${r.day} ${r.dev} ${r.k}`;
    if (!groups.has(id)) groups.set(id, { day: r.day, dev: r.dev, k: r.k, n: 0, ok: 0, ms: [], err: {}, colo: {} });
    const g = groups.get(id);
    g.n++;
    if (r.ok) { g.ok++; g.ms.push(r.ms); } else g.err[r.err || "?"] = (g.err[r.err || "?"] || 0) + 1;
    if (r.colo) g.colo[r.colo] = (g.colo[r.colo] || 0) + 1;
  }
  const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
  const rows = [...groups.values()].map(({ ms, ...g }) => {
    ms.sort((a, b) => a - b);
    return { ...g, p50: pct(ms, 0.5), p90: pct(ms, 0.9) };
  });
  return json(req, { since: new Date(since).toISOString(), rows });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "");
    try {
      if (path === "/ping" && req.method === "GET") return json(req, { ok: true, colo: req.cf?.colo ?? null });
      const m = /^\/search\/([a-z]+)$/.exec(path);
      if (m && req.method === "GET") return await search(req, env, ctx, m[1], url.searchParams.get("q"));
      if (path === "/netlog" && req.method === "POST") return await netlog(req, env);
      if (path === "/netlog/summary" && req.method === "GET") return await summary(req, env);
      return json(req, { error: "нет такого адреса" }, 404);
    } catch (e) {
      console.error(path, e);
      return json(req, { error: "сбой на сервере" }, 500);
    }
  },
};
