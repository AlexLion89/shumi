// Локальный запуск без wrangler: настоящий код Worker на :8787 (KV в памяти, D1 — node:sqlite с миграциями,
// каталоги — живые) и сайт на :8760, который ходит в этот Worker.
//
//   node tools/dev.mjs        → http://localhost:8760/?api=http://localhost:8787
// Нужен Node 22+ (на машине владельца — C:\out\node22\node.exe; системный Node 16 не подойдёт).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import worker from "../worker/src/index.js";
import { fakeD1, fakeKV } from "../tests/helpers.mjs";

const env = { KV: fakeKV(), DB: fakeD1() };
const readBody = req => new Promise(ok => { const parts = []; req.on("data", d => parts.push(d)); req.on("end", () => ok(Buffer.concat(parts))); });

createServer(async (req, res) => {
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection"].includes(k)));
  const r = await worker.fetch(new Request("http://localhost:8787" + req.url, { method: req.method, headers, body }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log("Worker: http://localhost:8787"));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const site = new URL("../site/", import.meta.url);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  if (path.includes("..")) { res.writeHead(400).end(); return; }
  try {
    const data = await readFile(new URL(path, site));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(data);
  } catch {
    res.writeHead(404).end("нет файла");
  }
}).listen(8760, () => console.log("Сайт:   http://localhost:8760/?api=http://localhost:8787"));
