// Разбор настоящих ответов каталогов (tests/fixtures, сохранены 24.10.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../site/sources.js";
import { fixture } from "./helpers.mjs";

test("LitRes: название, автор без переводчиков, маленькая обложка, ссылка", () => {
  const items = SOURCES.litres.parse(fixture("litres-magiya-utra.json"));
  assert.ok(items.length >= 3);
  const b = items[0];
  assert.match(b.title, /^Магия утра/);
  assert.deepEqual(b.authors, ["Хэл Элрод"]);
  assert.equal(b.cover, "https://cdn.litres.ru/pub/c/cover_200/19063017.jpg");
  assert.match(b.url, /^https:\/\/www\.litres\.ru\/book\//);
  assert.equal(typeof b.year, "number");
});

test("LitRes: пересказы чужих книг отброшены", () => {
  const raw = fixture("litres-magiya-utra.json");
  const all = raw.payload.data.map(x => x.instance.title);
  assert.ok(all.some(t => /^Ключевые идеи книги/.test(t)), "в образце должны быть пересказы");
  const titles = SOURCES.litres.parse(raw).map(b => b.title);
  assert.ok(titles.length > 0);
  for (const t of titles) assert.doesNotMatch(t, /^(Ключевые идеи|Саммари|Краткое содержание|Инфографика)|\. Кратко$/, t);
  assert.ok(titles.includes("Магия утра для финансовой свободы. Как заложить основы счастливой и богатой жизни"));
});

test("FantLab: только книги — рецензии и статьи о романе отброшены", () => {
  const raw = fixture("fantlab-zuleyha.json");
  assert.ok(raw.matches.some(m => m.name_eng === "review"), "в образце должны быть рецензии");
  const items = SOURCES.fantlab.parse(raw);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Зулейха открывает глаза");
  assert.deepEqual(items[0].authors, ["Гузель Яхина"]);
  assert.match(items[0].cover, /^https:\/\/fantlab\.ru\/images\/editions\/big\/\d+$/);
  assert.match(items[0].url, /^https:\/\/fantlab\.ru\/work\d+$/);
});

test("Open Library: обложка среднего размера, год и страницы", () => {
  const b = SOURCES.openlibrary.parse(fixture("openlibrary-atomic-habits.json"))[0];
  assert.equal(b.title, "Atomic Habits");
  assert.deepEqual(b.authors, ["James Clear"]);
  assert.equal(b.cover, "https://covers.openlibrary.org/b/id/12539702-M.jpg");
  assert.equal(b.year, 2016);
  assert.equal(b.pages, 322);
  assert.equal(b.id, "OL17930368W");
});

test("Open Library: без пересказов, «Paperback - …» и наборов; книги с обложкой выше", () => {
  const items = SOURCES.openlibrary.parse(fixture("openlibrary-silent-patient.json"));
  const titles = items.map(b => b.title);
  assert.equal(titles[0], "The Silent Patient");
  for (const t of titles) assert.doesNotMatch(t, /^(Summary|Paperback)|Collection Set/, t);
  const firstBare = items.findIndex(b => !b.cover);
  assert.ok(firstBare === -1 || items.slice(firstBare).every(b => !b.cover), "после первой книги без обложки обложек нет");
  assert.ok(titles.includes("The Maidens"));
});

test("пустые и сломанные ответы не роняют разбор", () => {
  for (const s of Object.values(SOURCES)) {
    assert.deepEqual(s.parse(null), []);
    assert.deepEqual(s.parse({}), []);
  }
});

test("FantLab: номер издания из адреса обложки, страницы издания, издания произведения — русские и новые сверху", async () => {
  const { FANTLAB, fantlabEdition } = await import("../site/sources.js");
  assert.equal(fantlabEdition("https://fantlab.ru/images/editions/big/150604"), 150604);
  assert.equal(fantlabEdition("https://fantlab.ru/images/editions/small/7?r=1"), 7);
  assert.equal(fantlabEdition("https://cdn.litres.ru/pub/c/cover_200/1.jpg"), null);
  assert.equal(FANTLAB.pages(fixture("fantlab-edition-zuleyha.json")), 512);
  assert.equal(FANTLAB.pages({ pages: 0 }), null);
  const eds = FANTLAB.editions(fixture("fantlab-work-zuleyha.json"));
  assert.ok(eds.length > 10);
  assert.equal(eds[0].lang, "русский");
  const ru = eds.filter(e => e.lang === "русский");
  assert.ok(ru.every((e, i) => i === 0 || (ru[i - 1].year ?? 0) >= (e.year ?? 0)), "русские — новые сверху");
  assert.ok(eds.indexOf(ru.at(-1)) < eds.findIndex(e => e.lang !== "русский"), "сначала все русские");
  assert.ok(eds.every(e => typeof e.hasCover === "boolean") && eds.some(e => e.hasCover));
  assert.deepEqual(FANTLAB.editions(null), []);
});

test("Google Books: без пересказов и комплектов, обложка крупнее и по https, страницы", () => {
  const items = SOURCES.google.parse(fixture("google-magiya-utra.json"));
  assert.ok(items.length >= 5);
  for (const b of items) assert.doesNotMatch(b.title, /^(Саммари|Краткое)|комплект/i, b.title);
  const b = items.find(x => x.title.startsWith("Магия утра. Как первый час"));
  assert.deepEqual(b.authors, ["Хэл Элрод"]);
  assert.ok(b.pages > 100);
  assert.match(b.cover, /^https:\/\/books\.google\.com\/books\/content\?.*&fife=w400-h600$/);
  assert.doesNotMatch(b.cover, /edge=curl/);
  assert.match(b.url, /^https:/);
  assert.equal(SOURCES.google.url("x", { googleKey: "K" }).endsWith("&key=K"), true);
  assert.equal(SOURCES.google.url("x").includes("key="), false);
  assert.deepEqual(SOURCES.google.parse({}), []);
});
