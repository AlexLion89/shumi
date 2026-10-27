// Посредник Yandex Cloud (proxy/index.js): пересылает только адреса из списка, Douban — со своим Referer, обложки — base64.
import { test } from "node:test";
import assert from "node:assert/strict";
import proxy from "../proxy/index.js";
import { fixture } from "./helpers.mjs";

const call = (u, headers = {}) => proxy.handler({ httpMethod: "GET", headers, queryStringParameters: u === undefined ? {} : { u } });
function stub(respond) {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return respond(String(url)); };
  return calls;
}
const LITRES = "https://api.litres.ru/foundation/api/search?q=%D0%BC%D0%B0%D1%81%D0%BB%D0%BE&types=text_book&limit=12";
const COVER = "https://img3.doubanio.com/view/subject/m/public/s29793550.jpg";

test("ping отвечает и разрешает CORS сайту полки", async () => {
  const r = await proxy.handler({ headers: { Origin: "https://shumi.sirenyov.link" }, queryStringParameters: { ping: "1" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  assert.equal(r.headers["Access-Control-Allow-Origin"], "https://shumi.sirenyov.link");
});

test("поиск LitRes: ответ как есть, кешируется на час; заголовки в любом регистре", async () => {
  const calls = stub(() => new Response(JSON.stringify(fixture("litres-maslo.json")), { headers: { "Content-Type": "application/json" } }));
  const r = await call(LITRES, { origin: "http://localhost:8760" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), fixture("litres-maslo.json"));
  assert.equal(r.isBase64Encoded, false);
  assert.equal(r.headers["Cache-Control"], "public, max-age=3600");
  assert.equal(r.headers["Access-Control-Allow-Origin"], "http://localhost:8760");
  assert.equal(calls[0].url, LITRES);
  assert.equal(calls[0].opts.headers.Referer, undefined);
});

test("Douban: подсказки и обложка — с Referer Douban; обложка уходит base64", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const calls = stub(url => (url.includes("doubanio")
    ? new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } })
    : new Response(JSON.stringify(fixture("douban-huaixiaohai.json")), { headers: { "Content-Type": "application/json; charset=utf-8" } })));
  const s = await call(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent("坏小孩")}`);
  assert.equal(JSON.parse(s.body)[0].title, "坏小孩");
  const c = await call(COVER);
  assert.equal(c.statusCode, 200);
  assert.equal(c.isBase64Encoded, true);
  assert.deepEqual(Buffer.from(c.body, "base64"), jpeg);
  assert.equal(c.headers["Content-Type"], "image/jpeg");
  assert.equal(c.headers["Cache-Control"], "public, max-age=31536000");
  assert.deepEqual(calls.map(x => x.opts.headers.Referer), ["https://book.douban.com/", "https://book.douban.com/"]);
});

test("чужие адреса — 403 без похода наружу; чужой сайт не получает свой Origin", async () => {
  const calls = stub(() => assert.fail("не должен ходить наружу"));
  for (const u of [undefined, "", "https://evil.example/", "http://api.litres.ru/foundation/api/search?q=x",
    "https://api.litres.ru.evil.example/foundation/api/search?q=x", "https://api.litres.ru/foundation/api/users/me",
    "https://img3.doubanio.com/view/subject/m/public/s1.jpg/../../../etc", "https://book.douban.com/people/x/"]) {
    const r = await call(u, { Origin: "https://evil.example" });
    assert.equal(r.statusCode, 403, String(u));
    assert.equal(r.headers["Access-Control-Allow-Origin"], "https://shumi.sirenyov.link");
  }
  assert.equal(calls.length, 0);
});

test("каталог молчит или вместо обложки отдал не картинку — 502 с понятной причиной", async () => {
  stub(() => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); });
  let r = await call(LITRES);
  assert.equal(r.statusCode, 502);
  assert.match(JSON.parse(r.body).error, /не ответил за 8 с/);
  stub(() => new Response("teapot", { status: 418, headers: { "Content-Type": "text/plain" } }));
  r = await call(COVER);
  assert.equal(r.statusCode, 502);
  assert.match(JSON.parse(r.body).error, /418/);
});
