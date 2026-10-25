// Ссылка «итоги года для подруг»: шифрование, разбор ссылки, что попадает в итоги.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newShareId, newShareKey, parseShare, seal, shareUrl, unseal } from "../site/seal.js";
import { shareData } from "../site/shelf.js";

test("итоги шифруются: без ключа не прочитать, с ключом — то же самое; чужой ключ — ошибка", async () => {
  const key = newShareKey(), data = { year: 2026, books: [{ t: "Тревожные люди", a: ["Фредрик Бакман"] }] };
  const box = await seal(data, key);
  assert.ok(!JSON.stringify(box).includes("Тревожные"), "в файле нет открытого текста");
  assert.deepEqual(await unseal(box, key), data);
  await assert.rejects(unseal(box, newShareKey()));
  const big = { books: Array.from({ length: 300 }, (_, i) => ({ t: "Книга " + i, c: "data:image/jpeg;base64," + "A".repeat(3000) })) };
  assert.equal((await unseal(await seal(big, key), key)).books.length, 300, "большие итоги — тоже");
});

test("ссылка: адрес, разбор, случайные id и ключ", () => {
  const id = newShareId(), key = newShareKey();
  assert.equal(id.length, 12);
  assert.ok(key.length >= 21);
  const url = shareUrl("https://shumi.sirenyov.link/", id, key);
  assert.equal(url, `https://shumi.sirenyov.link/y/#${id}.${key}`);
  assert.deepEqual(parseShare(new URL(url).hash), { id, key });
  assert.equal(parseShare("#мусор"), null);
  assert.notEqual(newShareId(), newShareId());
});

test("в итоги для подруг попадает только прочитанное за год, без «Хочу» и «Читаю»", () => {
  const shelf = { version: 1, books: {
    a: { title: "Прочитала", authors: ["А"], shelf: "read", reads: ["2026-03"], rating: 5, cover: "https://x/a.jpg", pages: 300, added: "1" },
    b: { title: "Хочу", authors: ["Б"], shelf: "want", reads: [], added: "2" },
    c: { title: "Читаю", authors: ["В"], shelf: "reading", reads: [], added: "3" },
    d: { title: "Прошлый год", authors: ["Г"], shelf: "read", reads: ["2025-12"], added: "4" },
  } };
  const d = shareData(shelf, 2026);
  assert.deepEqual(d.books, [{ id: "a", t: "Прочитала", a: ["А"], c: "https://x/a.jpg", r: 5 }]);
  assert.equal(d.count, 1);
  assert.equal(d.pages, 300);
  assert.ok(!JSON.stringify(d).includes("Хочу"));
});
