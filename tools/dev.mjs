// Локальный запуск без wrangler и без настоящего GitHub:
//   :8760 — сайт;
//   :8788 — заглушка GitHub API для shelf.json (ключ «t»), с демо-полкой из сохранённых ответов каталогов;
//   :8787 — Worker (KV в памяти, D1 — node:sqlite); полке не нужен, остался от этапа 0 (LitRes).
//
//   node tools/dev.mjs          → http://localhost:8760/?gh=http://localhost:8788&token=t
//   node tools/dev.mjs --empty  → то же с пустой полкой
// Нужен Node 22+ (на машине владельца — C:\out\node22\node.exe; системный Node 16 не подойдёт).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import worker from "../worker/src/index.js";
import { SOURCES } from "../site/sources.js";
import { serialize } from "../site/shelf.js";
import { fakeD1, fakeGitHub, fakeKV, fixture } from "../tests/helpers.mjs";

const readBody = req => new Promise(ok => { const parts = []; req.on("data", d => parts.push(d)); req.on("end", () => ok(Buffer.concat(parts))); });

// ---------- демо-полка: книги из настоящих ответов каталогов

function demo() {
  const pick = (src, name, title, author = "") => {
    const b = SOURCES[src].parse(fixture(`${src}-${name}.json`)).find(x => x.title.startsWith(title) && x.authors.join().includes(author));
    if (!b) throw new Error(`в ${src}-${name} нет «${title}» ${author}`);
    return { title: b.title, authors: b.authors, year: b.year, cover: b.cover, src, srcId: b.id, url: b.url };
  };
  const at = d => `${d}T12:00:00.000Z`;
  const books = {
    maslo: { ...pick("fantlab", "maslo", "Масло", "Юзуки"), shelf: "reading", rating: null, reads: [], added: at("2026-10-20") },
    trev: { ...pick("fantlab", "trevozhnye-lyudi", "Тревожные люди"), shelf: "read", rating: 5, reads: ["2026-09"], added: at("2026-09-01") },
    zul: { ...pick("fantlab", "zuleyha", "Зулейха"), shelf: "read", rating: 4, reads: ["2026-03"], added: at("2026-03-01") },
    patient: { ...pick("openlibrary", "silent-patient", "The Silent Patient"), shelf: "read", rating: 4, reads: ["2026-07"], added: at("2026-07-01") },
    hp: { ...pick("fantlab", "garri-potter", "Гарри Поттер и философский камень"), shelf: "read", rating: 5, reads: ["2025-12"], added: at("2025-12-01") },
    cuckoo: { ...pick("fantlab", "rouling", "Зов Кукушки"), shelf: "read", rating: 3, reads: ["2024"], added: at("2026-10-01") },
    habits: { ...pick("openlibrary", "atomic-habits", "Atomic Habits"), shelf: "want", rating: null, reads: [], added: at("2026-10-10") },
    magic: { ...pick("litres", "magiya-utra", "Магия утра. Как первый"), shelf: "want", rating: null, reads: [], added: at("2026-10-12") },
    granny: { title: "Опасная игра бабули", authors: ["Кристен Перрин"], year: 2024, cover: null, src: "manual", srcId: null, url: null,
              shelf: "want", rating: null, reads: [], added: at("2026-10-15") },
  };
  for (const b of Object.values(books)) b.updated = b.added;
  return { version: 1, books };
}

// ---------- заглушка GitHub API

const shelf = process.argv.includes("--empty") ? { version: 1, books: {} } : demo();
const gh = fakeGitHub(serialize(shelf));
// Копии обложек, как их кладёт задание backup.yml в shumi-data (для картинки «Итоги года»), — фоном.
for (const [id, b] of Object.entries(shelf.books)) {
  if (b.cover) fetch(b.cover).then(r => (r.ok ? r.arrayBuffer() : null)).then(a => a && gh.setFile(`covers/${id}.jpg`, new Uint8Array(a))).catch(() => {});
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS" };
createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return; }
  const body = ["PUT", "DELETE"].includes(req.method) ? (await readBody(req)).toString("utf8") : undefined;
  const r = await gh.fetch("https://fake.github" + req.url, { method: req.method, headers: { Authorization: req.headers.authorization, Accept: req.headers.accept }, body });
  res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "application/octet-stream", ...CORS }).end(Buffer.from(await r.arrayBuffer()));
  if (["PUT", "DELETE"].includes(req.method) && r.ok) console.log("коммит:", gh.commits.at(-1).message.split("\n")[0]);
}).listen(8788, () => console.log("GitHub: http://localhost:8788 (ключ «t»)"));

// ---------- Worker

const env = { KV: fakeKV(), DB: fakeD1() };
createServer(async (req, res) => {
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection"].includes(k)));
  const r = await worker.fetch(new Request("http://localhost:8787" + req.url, { method: req.method, headers, body }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log("Worker: http://localhost:8787"));

// ---------- сайт

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const site = new URL("../site/", import.meta.url);

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  if (path.includes("..")) { res.writeHead(400).end(); return; }
  try {
    const data = await readFile(new URL(path, site));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(data);
  } catch {
    res.writeHead(404).end("нет файла");
  }
}).listen(8760, () => console.log("Сайт:   http://localhost:8760/?gh=http://localhost:8788&token=t"));
