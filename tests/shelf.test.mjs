// Данные полки: операции, файл, годы, итоги, сообщения коммитов, CSV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, describe, emptyShelf, findSame, parse, readByYear, serialize, toCSV, yearStats } from "../site/shelf.js";

const book = (title, extra = {}) => ({ title, authors: ["Автор"], shelf: "want", rating: null, reads: [], added: "2026-10-01T10:00:00Z", ...extra });
const shelfOf = books => ({ version: 1, books });

test("операции: put дописывает поля, а не заменяет книгу; del убирает", () => {
  let s = apply(emptyShelf(), [{ op: "put", id: "a", book: book("Масло") }]);
  s = apply(s, [{ op: "put", id: "a", book: { rating: 5 } }, { op: "put", id: "a", book: { shelf: "read", reads: ["2026-10"] } }]);
  assert.deepEqual(s.books.a, { ...book("Масло"), rating: 5, shelf: "read", reads: ["2026-10"] });
  assert.deepEqual(apply(s, [{ op: "del", id: "a" }]).books, {});
});

test("файл: книги в порядке добавления, кириллица как есть, обратно читается", () => {
  const s = shelfOf({ z: book("Позже", { added: "2026-10-02" }), a: book("Раньше", { added: "2026-10-01" }) });
  const text = serialize(s);
  assert.ok(text.indexOf("Раньше") < text.indexOf("Позже"));
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(parse(text).books, s.books);
  assert.throws(() => parse('{"version":1}'));
});

test("уже на полке: тот же каталог и id или то же название с автором", () => {
  const s = shelfOf({ a: book("Масло", { authors: ["Асако Юзуки"], src: "fantlab", srcId: "1" }) });
  assert.equal(findSame(s, { title: "другое", authors: [], src: "fantlab", srcId: "1" }).id, "a");
  assert.equal(findSame(s, { title: " масло", authors: ["асако юзуки"], src: "litres", srcId: "9" }).id, "a");
  assert.equal(findSame(s, { title: "Масло", authors: ["Другой"], src: "litres", srcId: "9" }), null);
});

test("прочитанное по годам: свежие сверху, перечитанная в двух годах, без даты отдельно", () => {
  const s = shelfOf({
    a: book("Весенняя", { shelf: "read", reads: ["2026-03"] }),
    b: book("Осенняя", { shelf: "read", reads: ["2026-10"] }),
    c: book("Дважды", { shelf: "read", reads: ["2023-05", "2026-01"] }),
    d: book("Давно", { shelf: "read", reads: ["2019"] }),
    e: book("Без даты", { shelf: "read", reads: [] }),
    f: book("Хочу", { shelf: "want" }),
  });
  const { years, undated } = readByYear(s);
  assert.deepEqual([...years.keys()], [2026, 2023, 2019]);
  assert.deepEqual(years.get(2026).map(b => b.title), ["Осенняя", "Весенняя", "Дважды"]);
  assert.deepEqual(years.get(2023).map(b => b.title), ["Дважды"]);
  assert.deepEqual(undated.map(b => b.title), ["Без даты"]);
});

test("итоги года: число, месяцы, без месяца, средняя оценка, пятёрки", () => {
  const s = shelfOf({
    a: book("Январская", { shelf: "read", reads: ["2026-01"], rating: 5 }),
    b: book("Октябрьская", { shelf: "read", reads: ["2026-10"], rating: 3 }),
    c: book("Только год", { shelf: "read", reads: ["2026"] }),
    d: book("Прошлогодняя", { shelf: "read", reads: ["2025-12"], rating: 1 }),
  });
  const st = yearStats(s, 2026);
  assert.equal(st.count, 3);
  assert.equal(st.months[0], 1);
  assert.equal(st.months[9], 1);
  assert.equal(st.noMonth, 1);
  assert.equal(st.avg, 4);
  assert.deepEqual(st.fives.map(b => b.title), ["Январская"]);
  assert.deepEqual(st.books.map(b => b.title), ["Только год", "Январская", "Октябрьская"]);
  assert.equal(yearStats(s, 2024).count, 0);
});

test("страницы за год — сумма по книгам, где число известно", () => {
  const s = shelfOf({
    a: book("400 стр.", { shelf: "read", reads: ["2026-01"], pages: 400 }),
    b: book("Не знаем", { shelf: "read", reads: ["2026-02"] }),
    c: book("320 стр.", { shelf: "read", reads: ["2026-03"], pages: 320 }),
    d: book("Хочу, 900 стр.", { shelf: "want", pages: 900 }),
  });
  const st = yearStats(s, 2026);
  assert.equal(st.pages, 720);
  assert.equal(st.pagesKnown, 2);
  const put = [{ op: "put", id: "b", book: { pages: 250 } }];
  assert.equal(describe(put, s, apply(s, put)), "Страниц 250: «Не знаем» — Автор");
  const cov = [{ op: "put", id: "b", book: { cover: "https://x/c.jpg" } }];
  assert.equal(describe(cov, s, apply(s, cov)), "Новая обложка: «Не знаем» — Автор");
});

test("сообщение коммита читается как дневник", () => {
  const before = shelfOf({ a: book("Масло", { authors: ["Асако Юзуки"] }) });
  const add = [{ op: "put", id: "b", book: book("Зулейха открывает глаза", { authors: ["Гузель Яхина"] }) }];
  assert.equal(describe(add, before, apply(before, add)), "Хочу прочитать: «Зулейха открывает глаза» — Гузель Яхина");
  const read = [{ op: "put", id: "a", book: { shelf: "read", reads: ["2026-10"], rating: 4 } }];
  assert.equal(describe(read, before, apply(before, read)), "Прочитано: «Масло» — Асако Юзуки ★★★★☆");
  const rate = [{ op: "put", id: "a", book: { rating: 2 } }];
  assert.equal(describe(rate, before, apply(before, rate)), "Оценка ★★☆☆☆: «Масло» — Асако Юзуки");
  const del = [{ op: "del", id: "a" }];
  assert.equal(describe(del, before, apply(before, del)), "Убрана с полки: «Масло» — Асако Юзуки");
  const two = [...add, ...del];
  assert.match(describe(two, before, apply(before, two)), /^2 изменения на полке\n\nХочу прочитать: .*\nУбрана с полки: /);
  const five = ["a", "b", "c", "d", "e"].map((id, i) => ({ op: "put", id, book: book(`Книга ${i}`) }));
  assert.match(describe(five, emptyShelf(), apply(emptyShelf(), five)), /^5 изменений на полке/);
});

test("CSV: «;», кавычки, BOM для Excel, свежие сверху", () => {
  const s = shelfOf({
    a: book('Книга "в кавычках"', { shelf: "read", reads: ["2025-01"], rating: 4 }),
    b: book("Свежая", { shelf: "read", reads: ["2026-10"] }),
  });
  const csv = toCSV(s);
  assert.ok(csv.startsWith("\uFEFF\"Название\";\"Автор\""));
  const lines = csv.trim().split("\r\n");
  assert.match(lines[1], /^"Свежая";/);
  assert.match(lines[2], /^"Книга ""в кавычках""";"Автор";"";"Прочитано";"4";"2025-01";"2026-10-01"$/);
});
