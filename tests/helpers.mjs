// Заглушки привязок Worker для тестов: KV в памяти, D1 поверх node:sqlite с настоящими миграциями,
// fetch, отдающий сохранённые ответы каталогов из tests/fixtures.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const here = new URL(".", import.meta.url);
export const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, here), "utf8"));

export function fakeKV() {
  const data = new Map();
  return {
    data,
    async get(key, type) { const v = data.get(key); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async put(key, value, opts) { data.set(key, value); this.lastPut = { key, opts }; },
  };
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../worker/migrations/", here);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    all: async () => ({ results: db.prepare(sql).all(...args).map(r => ({ ...r })) }),
    first: async () => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
  });
  return { sqlite: db, prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); } };
}

// Ответ по хосту каталога; fail — хост, который «не отвечает».
export function stubFetch({ fail } = {}) {
  const calls = [];
  const byHost = {
    "api.litres.ru": "litres-magiya-utra.json",
    "api.fantlab.ru": "fantlab-zuleyha.json",
    "openlibrary.org": "openlibrary-atomic-habits.json",
  };
  globalThis.fetch = async (url, opts) => {
    const host = new URL(url).host;
    calls.push({ url: String(url), opts });
    if (host === fail) throw new TypeError("fetch failed");
    if (!byHost[host]) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(fixture(byHost[host])), { headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

export function ctx() {
  const waits = [];
  return { waits, waitUntil: p => waits.push(p), done: () => Promise.all(waits) };
}

export const req = (path, init = {}) =>
  new Request("https://shumi-api.sirenyov.workers.dev" + path, { ...init, headers: { Origin: "https://shumi.sirenyov.link", ...init.headers } });
