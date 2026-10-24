// Порядок выдачи на настоящих ответах каталогов (tests/fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../worker/src/sources.js";
import { merge, score } from "../site/rank.js";
import { fixture } from "./helpers.mjs";

const parsed = (src, name) => SOURCES[src].parse(fixture(`${src}-${name}.json`));
const RU = ["litres", "fantlab", "openlibrary"], EN = ["openlibrary", "litres", "fantlab"];

test("«тревожные люди»: роман Бакмана из FantLab первым, мусор LitRes и Open Library убран", () => {
  const got = Object.fromEntries(RU.map(s => [s, parsed(s, "trevozhnye-lyudi")]));
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
  assert.equal(score({ title: "Магия утра. Как первый час дня", authors: [] }, "магия утра"), 100, "одиночная точка по-прежнему отделяет подзаголовок");
});

test("оценка: точное название > начало > все слова > часть слов > ничего", () => {
  const b = (title, authors = []) => ({ title, authors });
  const q = "тревожные люди";
  const s = [b("Тревожные люди"), b("Тревожные люди и другие"), b("Люди тревожные: очерки"), b("Тревожные дни"), b("Перформанс")].map(x => score(x, q));
  assert.deepEqual(s.map((v, i) => i && v < s[i - 1]), [0, true, true, true, true].map((v, i) => i ? v : 0));
  assert.equal(s[4], 0);
});
