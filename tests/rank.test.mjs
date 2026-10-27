// Порядок выдачи на настоящих ответах каталогов (tests/fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../site/sources.js";
import { mainTitle, merge, sameBook, score } from "../site/rank.js";
import { fixture } from "./helpers.mjs";

const parsed = (src, name) => SOURCES[src].parse(fixture(`${src}-${name}.json`));
const RU = ["litres", "fantlab", "google", "openlibrary"], EN = ["openlibrary", "google", "litres", "fantlab"];

test("«тревожные люди»: роман Бакмана из FantLab первым, мусор LitRes и Open Library убран", () => {
  const got = Object.fromEntries(["litres", "fantlab", "openlibrary"].map(s => [s, parsed(s, "trevozhnye-lyudi")]));
  const list = merge(got, RU, "Тревожные люди");
  assert.equal(list[0].title, "Тревожные люди");
  assert.deepEqual(list[0].authors, ["Фредрик Бакман"]);
  assert.equal(list[1].title, "Тревожные люди", "тёзка без обложки — вторым");
  const titles = list.map(b => b.title);
  for (const junk of ["Перформанс", "Белгородские рассказы – 2", "Волосы мертвой царевны"]) assert.ok(!titles.includes(junk), junk);
});

test("«магия утра»: первой — сама книга, а не книги серии", () => {
  const list = merge({ litres: parsed("litres", "magiya-utra") }, RU, "магия утра");
  assert.equal(list[0].title, "Магия утра. Как первый час дня определяет ваш успех");
  assert.ok(list.slice(1).every(b => /магия/i.test(b.title)));
});

test("«silent patient»: The Silent Patient с обложкой выше тёзок без обложки", () => {
  const list = merge({ openlibrary: parsed("openlibrary", "silent-patient") }, EN, "silent patient");
  assert.equal(list[0].title, "The Silent Patient");
  assert.deepEqual(list[0].authors, ["Alex Michaelides"]);
  assert.ok(list[0].cover);
});

test("поиск по автору: «бакман» оставляет книги Бакмана", () => {
  const list = merge({ fantlab: parsed("fantlab", "trevozhnye-lyudi") }, RU, "бакман");
  assert.deepEqual(list.map(b => b.authors[0]), ["Фредрик Бакман"]);
});

test("одна книга из двух каталогов — одна строка с обоими каталогами и обложкой", () => {
  const a = { src: "fantlab", title: "Зулейха открывает глаза", authors: ["Гузель Яхина"], cover: null };
  const b = { src: "litres", title: "Зулейха открывает глаза", authors: ["Гузель Яхина"], cover: "https://x/c.jpg" };
  const list = merge({ litres: [b], fantlab: [a] }, RU, "зулейха");
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].srcs, ["litres", "fantlab"]);
  assert.equal(list[0].cover, "https://x/c.jpg");
});

test("многоточие не обрезает название: «Зулейха... далёкое» ниже «Зулейха открывает глаза»", () => {
  const far = { title: "Зулейха... далёкое всё ближе и ближе", authors: ["Джалиль аль-Кейси"], cover: null };
  const eyes = { title: "Зулейха открывает глаза", authors: ["Гузель Яхина"], cover: "https://x/c.jpg" };
  const list = merge({ fantlab: [far, eyes] }, RU, "Зулейха");
  assert.equal(list[0].title, "Зулейха открывает глаза");
  assert.equal(score(far, "Зулейха"), 90, "начало названия, а не точное совпадение");
  assert.equal(score({ title: "Магия утра. Как первый час дня", authors: [] }, "магия утра"), 91, "одиночная точка по-прежнему отделяет подзаголовок");
});

test("оценка: точное название > начало > все слова > часть слов > ничего", () => {
  const b = (title, authors = []) => ({ title, authors });
  const q = "тревожные люди";
  const s = [b("Тревожные люди"), b("Тревожные люди и другие"), b("Люди тревожные: очерки"), b("Тревожные дни"), b("Перформанс")].map(x => score(x, q));
  assert.deepEqual(s.map((v, i) => i && v < s[i - 1]), [0, true, true, true, true].map((v, i) => i ? v : 0));
  assert.equal(s[4], 0);
});

test("«масло»: одна книга, хотя у LitRes «Юзуки Асако», а у FantLab «Асако Юзуки»", () => {
  const got = { litres: parsed("litres", "maslo"), fantlab: parsed("fantlab", "maslo") };
  const list = merge(got, RU, "масло");
  const yuzuki = list.filter(b => b.authors.some(a => /Юзуки/.test(a)));
  assert.equal(yuzuki.length, 1);
  assert.deepEqual(yuzuki[0].srcs, ["litres", "fantlab"]);
  assert.equal(list[0], yuzuki[0], "и она первая: нашли оба каталога, есть обложка");
});

test("«роулинг»: сверху книги Роулинг, а не книги о ней", () => {
  const got = { litres: parsed("litres", "rouling"), fantlab: parsed("fantlab", "rouling") };
  const top = merge(got, RU, "роулинг").slice(0, 5);
  for (const b of top) assert.ok(b.authors.some(a => /Роулинг/.test(a)), `${b.title} — ${b.authors}`);
});

test("«гарри поттер»: сверху романы, а не цикл целиком и не сувенирные издания без автора", () => {
  const got = { litres: parsed("litres", "garri-potter"), fantlab: parsed("fantlab", "garri-potter") };
  const list = merge(got, RU, "гарри поттер");
  assert.ok(!list.some(b => b.title === "Гарри Поттер" && b.srcs.includes("fantlab")), "цикла FantLab нет");
  const top = list.slice(0, 3);
  for (const b of top) assert.match(b.title, /^Гарри Поттер и /, b.title);
});

test("Google: «магия утра» — сама книга выше серии; «atomic habits» — Джеймс Клир выше пересказа на 63 страницы", () => {
  const magic = merge({ google: parsed("google", "magiya-utra") }, RU, "магия утра");
  assert.match(magic[0].title, /^Магия утра\. Как первый час/);
  const habits = merge({ google: parsed("google", "atomic-habits"), openlibrary: parsed("openlibrary", "atomic-habits") }, EN, "atomic habits");
  assert.equal(habits[0].authors[0], "James Clear");
});

// Замечания Вики 26.10.2026: часть названия и автор вперемешку; китайские книги.
test("«остров стругацкие»: «Обитаемый остров» первым, два издания LitRes склеены в одно", () => {
  const list = merge({ litres: parsed("litres", "ostrov-strugackie") }, ["fantlab", "litres", "google"], "остров стругацкие");
  assert.equal(list[0].title, "Обитаемый остров");
  assert.deepEqual(list[0].authors, ["Аркадий и Борис Стругацкие"]);
  assert.equal(list.filter(b => b.title === "Обитаемый остров" && b.authors[0] === "Аркадий и Борис Стругацкие").length, 1);
});

test("иероглифы: слово ищется в любом месте названия, автор — целиком, издания склеиваются", () => {
  const b = { title: "长夜难明", authors: ["紫金陈"] };
  assert.equal(score(b, "长夜难明"), 100);
  assert.ok(score(b, "难明") >= 50, "середина названия");
  assert.equal(score(b, "紫金陈"), 85, "запрос — автор");
  assert.equal(mainTitle("坏小孩（修订新版）"), "坏小孩");
  assert.ok(sameBook({ title: "坏小孩（修订新版）", authors: ["紫金陈"] }, { title: "坏小孩", authors: ["紫金陈"] }));
  assert.ok(!sameBook({ title: "活着", authors: ["余华"] }, { title: "活着", authors: ["张三"] }), "двухиероглифное имя тоже различает авторов");
  const list = merge({ douban: SOURCES.douban.parse(fixture("douban-huaixiaohai.json")) }, ["douban", "google"], "坏小孩");
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "坏小孩");
});
