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

// localStorage-подобное хранилище: значения проходят через JSON, как в браузере.
export function memStorage() {
  const data = new Map();
  return {
    get: k => data.has(k) ? JSON.parse(data.get(k)) : null,
    set: (k, v) => data.set(k, JSON.stringify(v)),
  };
}

// GitHub Contents API для одного файла shelf.json с настоящими кодами ответов: 404 нет файла,
// 409 чужой sha, 422 нет sha у существующего файла, 401 чужой ключ. Ключ «t» — правильный.
// text = null — пустой репозиторий; down = true — нет связи; external(fn) — правка с другого устройства.
export function fakeGitHub(text = '{\n  "version": 1,\n  "books": {}\n}\n') {
  const gh = { base: "https://fake.github", commits: [], conflicts: 0, down: false };
  let sha = text == null ? null : "s0", n = 0;
  const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  gh.text = () => text;
  gh.external = fn => { text = JSON.stringify(fn(JSON.parse(text)), null, 2) + "\n"; sha = "x" + ++n; };
  gh.fetch = async (url, opts = {}) => {
    if (gh.down) throw new TypeError("Failed to fetch");
    if (opts.headers?.Authorization !== "Bearer t") return json(401, { message: "Bad credentials" });
    const { pathname } = new URL(url), method = opts.method ?? "GET";
    if (pathname === "/repos/AlexLion89/shumi-data") return json(200, { permissions: { push: true } });
    if (pathname !== "/repos/AlexLion89/shumi-data/contents/shelf.json") return json(404, { message: "Not Found" });
    if (method === "GET") return text == null ? json(404, { message: "Not Found" }) : json(200, { content: b64(text), sha });
    const body = JSON.parse(opts.body);
    if (sha && !body.sha) return json(422, { message: "sha wasn't supplied" });
    if (sha && body.sha !== sha) { gh.conflicts++; return json(409, { message: `is at ${sha} but expected ${body.sha}` }); }
    text = unb64(body.content);
    sha = "s" + ++n;
    gh.commits.push({ message: body.message });
    return json(sha === "s1" && !body.sha ? 201 : 200, { content: { sha } });
  };
  return gh;
}

export function ctx() {
  const waits = [];
  return { waits, waitUntil: p => waits.push(p), done: () => Promise.all(waits) };
}

export const req = (path, init = {}) =>
  new Request("https://shumi-api.sirenyov.workers.dev" + path, { ...init, headers: { Origin: "https://shumi.sirenyov.link", ...init.headers } });
