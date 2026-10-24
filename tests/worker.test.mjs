// Worker целиком: маршруты, кеш поиска, CORS, замеры связи — на заглушках KV и D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { ctx, fakeD1, fakeKV, req, stubFetch } from "./helpers.mjs";

const env = () => ({ KV: fakeKV(), DB: fakeD1() });

test("/ping отвечает и разрешает CORS для сайта полки", async () => {
  const r = await worker.fetch(req("/ping"), env(), ctx());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://shumi.sirenyov.link");
});

test("чужой сайт не получает свой Origin в CORS", async () => {
  const r = await worker.fetch(req("/ping", { headers: { Origin: "https://evil.example" } }), env(), ctx());
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://shumi.sirenyov.link");
});

test("поиск: ответ каталога, затем тот же запрос из кеша без похода в каталог", async () => {
  const calls = stubFetch(), e = env(), c = ctx();
  const q = encodeURIComponent("  Магия   УТРА ");
  let r = await worker.fetch(req(`/search/litres?q=${q}`), e, c);
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.cached, false);
  assert.match(d.items[0].title, /^Магия утра/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /q=%D0%BC%D0%B0%D0%B3%D0%B8%D1%8F%20%D1%83%D1%82%D1%80%D0%B0/, "запрос нормализован: «магия утра»");
  assert.equal(calls[0].opts.headers["User-Agent"].startsWith("shumi/"), true);
  await c.done();
  assert.equal(e.KV.lastPut.key, "s:litres:магия утра");
  assert.equal(e.KV.lastPut.opts.expirationTtl, 86400);

  r = await worker.fetch(req(`/search/litres?q=${encodeURIComponent("магия утра")}`), e, ctx());
  d = await r.json();
  assert.equal(d.cached, true);
  assert.equal(calls.length, 1);
});

test("поиск: каталог не ответил — 502 с понятной ошибкой, в кеш ничего", async () => {
  stubFetch({ fail: "api.fantlab.ru" });
  const e = env(), c = ctx();
  const r = await worker.fetch(req("/search/fantlab?q=test"), e, c);
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /^fantlab не ответил/);
  await c.done();
  assert.equal(e.KV.data.size, 0);
});

test("поиск: неизвестный каталог — 404, короткий запрос — 400", async () => {
  stubFetch();
  assert.equal((await worker.fetch(req("/search/ozon?q=test"), env(), ctx())).status, 404);
  assert.equal((await worker.fetch(req("/search/litres?q=a"), env(), ctx())).status, 400);
});

const post = (body, raw) => req("/netlog", { method: "POST", headers: { "Content-Type": "text/plain" }, body: raw ?? JSON.stringify(body) });

test("замеры: сохраняются, повтор той же пачки не задваивает, мусор отбрасывается", async () => {
  const e = env(), now = Date.now();
  const events = [
    { at: now - 2000, k: "ping-cf", ok: 1, ms: 310 },
    { at: now - 1000, k: "search-litres", ok: 0, ms: 10000, err: "timeout" },
    { at: now, k: "ping-unknown", ok: 1, ms: 5 },
    { at: now, k: "ping-gh", ok: 1, ms: -5 },
  ];
  let r = await worker.fetch(post({ dev: "abc12345", events }), e, ctx());
  assert.deepEqual(await r.json(), { ok: true, saved: 2 });
  r = await worker.fetch(post({ dev: "abc12345", events }), e, ctx());
  assert.equal(r.status, 200);
  const rows = e.DB.sqlite.prepare("SELECT k, ok, ms, err, dev FROM netlog ORDER BY at").all().map(x => ({ ...x }));
  assert.deepEqual(rows, [
    { k: "ping-cf", ok: 1, ms: 310, err: null, dev: "abc12345" },
    { k: "search-litres", ok: 0, ms: 10000, err: "timeout", dev: "abc12345" },
  ]);
});

test("замеры: не JSON, без dev или больше 200 — 400", async () => {
  const e = env();
  assert.equal((await worker.fetch(post(null, "не json"), e, ctx())).status, 400);
  assert.equal((await worker.fetch(post({ events: [] }), e, ctx())).status, 400);
  const many = Array.from({ length: 201 }, (_, i) => ({ at: Date.now() - i, k: "ping-cf", ok: 1, ms: 1 }));
  assert.equal((await worker.fetch(post({ dev: "d", events: many }), e, ctx())).status, 400);
});

test("сводка: доля удачных и медиана по дню, устройству и виду запроса", async () => {
  const e = env(), now = Date.now();
  const events = [100, 200, 300, 400].map((ms, i) => ({ at: now - 10000 + i, k: "ping-cf", ok: 1, ms }))
    .concat([{ at: now - 5000, k: "ping-cf", ok: 0, ms: 10000, err: "timeout" }]);
  await worker.fetch(post({ dev: "phone", events }), e, ctx());
  const d = await (await worker.fetch(req("/netlog/summary"), e, ctx())).json();
  assert.equal(d.rows.length, 1);
  const [row] = d.rows;
  assert.equal(row.dev, "phone");
  assert.equal(row.k, "ping-cf");
  assert.equal(row.n, 5);
  assert.equal(row.ok, 4);
  assert.equal(row.p50, 300);
  assert.equal(row.p90, 400);
  assert.deepEqual(row.err, { timeout: 1 });
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
});

test("неизвестный адрес — 404 с CORS, OPTIONS — пустой ответ с CORS", async () => {
  const r = await worker.fetch(req("/nope"), env(), ctx());
  assert.equal(r.status, 404);
  assert.ok(r.headers.get("Access-Control-Allow-Origin"));
  const o = await worker.fetch(req("/netlog", { method: "OPTIONS" }), env(), ctx());
  assert.equal(o.status, 200);
  assert.match(o.headers.get("Access-Control-Allow-Methods"), /POST/);
});
