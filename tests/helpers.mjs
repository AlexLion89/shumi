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

// GitHub Contents API для репозитория shumi-data с настоящими кодами ответов: 404 нет файла, 409 чужой sha,
// 422 нет sha у существующего файла, 401 чужой ключ. Ключ «t» — правильный. Папки, удаление, сырые байты.
// text = null — пустой репозиторий; down = true — нет связи; external(fn) — правка shelf.json с другого
// устройства; setFile(path, text) — правка любого файла снаружи (например, ответ на замечание).
export function fakeGitHub(text = '{\n  "version": 1,\n  "books": {}\n}\n') {
  const gh = { base: "https://fake.github", commits: [], conflicts: 0, down: false, files: new Map() };
  let n = 0;
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const enc = s => new TextEncoder().encode(s);
  const dec = b => new TextDecoder().decode(b);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const set = (path, bytes) => { const sha = "s" + ++n; gh.files.set(path, { bytes, sha }); return sha; };
  if (text != null) gh.files.set("shelf.json", { bytes: enc(text), sha: "s0" });

  gh.text = (path = "shelf.json") => (gh.files.has(path) ? dec(gh.files.get(path).bytes) : null);
  gh.setFile = (path, t) => set(path, typeof t === "string" ? enc(t) : t);
  gh.external = fn => set("shelf.json", enc(JSON.stringify(fn(JSON.parse(gh.text())), null, 2) + "\n"));
  gh.fetch = async (url, opts = {}) => {
    if (gh.down) throw new TypeError("Failed to fetch");
    if (opts.headers?.Authorization !== "Bearer t") return json(401, { message: "Bad credentials" });
    const { pathname } = new URL(url), method = opts.method ?? "GET";
    if (pathname === "/repos/AlexLion89/shumi-data") return json(200, { permissions: { push: true } });
    const prefix = "/repos/AlexLion89/shumi-data/contents/";
    if (!pathname.startsWith(prefix)) return json(404, { message: "Not Found" });
    const path = pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    const f = gh.files.get(path);
    if (method === "GET") {
      if (f) {
        if (opts.headers?.Accept === "application/vnd.github.raw") return new Response(f.bytes, { status: 200 });
        return json(200, { type: "file", content: b64(f.bytes), sha: f.sha });
      }
      const inDir = [...gh.files].filter(([p]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"));
      if (inDir.length) return json(200, inDir.map(([p, x]) => ({ type: "file", name: p.split("/").pop(), path: p, sha: x.sha })));
      return json(404, { message: "Not Found" });
    }
    const body = JSON.parse(opts.body);
    if (method === "DELETE") {
      if (!f) return json(404, { message: "Not Found" });
      if (body.sha !== f.sha) { gh.conflicts++; return json(409, { message: "sha mismatch" }); }
      gh.files.delete(path);
      gh.commits.push({ message: body.message, path });
      return json(200, {});
    }
    if (f && !body.sha) return json(422, { message: "sha wasn't supplied" });
    if (f && body.sha !== f.sha) { gh.conflicts++; return json(409, { message: `is at ${f.sha} but expected ${body.sha}` }); }
    const sha = set(path, Uint8Array.from(atob(body.content), c => c.charCodeAt(0)));
    gh.commits.push({ message: body.message, path });
    return json(f ? 200 : 201, { content: { sha } });
  };
  return gh;
}

export function ctx() {
  const waits = [];
  return { waits, waitUntil: p => waits.push(p), done: () => Promise.all(waits) };
}

export const req = (path, init = {}) =>
  new Request("https://shumi-api.sirenyov.workers.dev" + path, { ...init, headers: { Origin: "https://shumi.sirenyov.link", ...init.headers } });
