// Полка: данные и операции над ними. Без DOM и сети — проверяется в node:test.
//
// Файл shelf.json в приватном репозитории AlexLion89/shumi-data:
//   {"version": 1, "books": {"<id>": Book}}
//   Book: {title, authors: [], year, cover, src, srcId, url,
//          shelf: "reading" | "want" | "read", rating: 1..5 | null,
//          reads: ["2026-10", "2019"] — месяцы прочтения (или только год), added, updated}
// Изменения — операции {op: "put", id, book: {поля}} и {op: "del", id}. «put» дописывает поля поверх
// книги, а не заменяет её целиком: оценка с телефона и полка с планшета, поставленные одновременно,
// сохранятся обе.

export const SHELVES = { reading: "Читаю", read: "Прочитано", want: "Хочу прочитать" };
export const emptyShelf = () => ({ version: 1, books: {} });

export function apply(shelf, ops) {
  const books = { ...shelf.books };
  for (const o of ops) {
    if (o.op === "put") books[o.id] = { ...(books[o.id] ?? {}), ...o.book };
    else if (o.op === "del") delete books[o.id];
  }
  return { ...shelf, books };
}

// В файле книги идут в порядке добавления, по два пробела: git diff читается глазами.
export function serialize(shelf) {
  const ids = Object.keys(shelf.books).sort((a, b) =>
    String(shelf.books[a].added ?? "").localeCompare(String(shelf.books[b].added ?? "")) || a.localeCompare(b));
  return JSON.stringify({ version: 1, books: Object.fromEntries(ids.map(id => [id, shelf.books[id]])) }, null, 2) + "\n";
}

export function parse(text) {
  const d = JSON.parse(text);
  if (!d || typeof d.books !== "object") throw new Error("в shelf.json нет книг");
  return { version: d.version ?? 1, books: d.books };
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);
export const thisMonth = (d = new Date()) => d.toISOString().slice(0, 7);
export const list = shelf => Object.entries(shelf.books).map(([id, b]) => ({ id, ...b }));
const lastRead = b => [...(b.reads ?? [])].sort().pop() ?? "";

// Уже на полке: та же книга того же каталога или то же название с тем же первым автором.
export function findSame(shelf, b) {
  const key = x => `${String(x.title).toLowerCase().trim()}|${String(x.authors?.[0] ?? "").toLowerCase().trim()}`;
  return list(shelf).find(x => (b.src && x.src === b.src && x.srcId === b.srcId) || key(x) === key(b)) ?? null;
}

// Прочитанное по годам: Map(год → книги, свежие сверху) и книги без даты. Перечитанная в 2023 и 2026 —
// в обоих годах.
export function readByYear(shelf) {
  const years = new Map(), undated = [];
  for (const b of list(shelf).filter(b => b.shelf === "read")) {
    const ys = [...new Set((b.reads ?? []).map(r => Number(r.slice(0, 4))).filter(Boolean))];
    if (!ys.length) undated.push(b);
    for (const y of ys) (years.get(y) ?? years.set(y, []).get(y)).push(b);
  }
  for (const [y, bs] of years) bs.sort((a, b) => readIn(b, y).localeCompare(readIn(a, y)) || String(b.added).localeCompare(String(a.added)));
  return { years: new Map([...years].sort((a, b) => b[0] - a[0])), undated };
}
// Последнее прочтение в году y: «2026-10», «2026» или «».
const readIn = (b, y) => (b.reads ?? []).filter(r => r.startsWith(String(y))).sort().pop() ?? "";

// Итоги года: сколько прочтений, по месяцам (без месяца — отдельно), средняя оценка, пятёрки.
export function yearStats(shelf, y) {
  const months = Array(12).fill(0);
  let count = 0, noMonth = 0;
  const books = [];
  for (const b of list(shelf)) {
    const rs = (b.reads ?? []).filter(r => r.startsWith(String(y)));
    if (!rs.length || b.shelf !== "read") continue;
    books.push(b);
    for (const r of rs) {
      count++;
      if (r.length >= 7) months[Number(r.slice(5, 7)) - 1]++; else noMonth++;
    }
  }
  const rated = books.filter(b => b.rating);
  return {
    year: y, count, months, noMonth, books: books.sort((a, b) => readIn(a, y).localeCompare(readIn(b, y))),
    avg: rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null,
    fives: books.filter(b => b.rating === 5),
  };
}

export const stars = n => "★".repeat(n ?? 0) + "☆".repeat(5 - (n ?? 0));
const who = b => `«${b.title}»${b.authors?.length ? " — " + b.authors.join(", ") : ""}`;

// Сообщение коммита — по-человечески, чтобы история в GitHub читалась как дневник.
export function describe(ops, before, after) {
  const lines = ops.map(o => {
    if (o.op === "del") { const b = before.books[o.id]; return `Убрана с полки: ${b ? who(b) : o.id}`; }
    const b = after.books[o.id], was = before.books[o.id];
    if (!b) return `Изменена книга ${o.id}`;
    if (!was || o.book.shelf && o.book.shelf !== was.shelf) {
      const r = b.shelf === "read" && b.rating ? " " + stars(b.rating) : "";
      return `${SHELVES[b.shelf] ?? b.shelf}: ${who(b)}${r}`;
    }
    if ("rating" in o.book) return `Оценка ${b.rating ? stars(b.rating) : "снята"}: ${who(b)}`;
    return `Изменена: ${who(b)}`;
  });
  const uniq = [...new Set(lines)];
  return uniq.length === 1 ? uniq[0] : `${uniq.length} изменения на полке\n\n${uniq.join("\n")}`;
}

// CSV для «Скачать»: открывается в Excel и Numbers; разделитель «;» — как ждёт русский Excel.
export function toCSV(shelf) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = list(shelf).sort((a, b) => lastRead(b).localeCompare(lastRead(a)) || String(b.added).localeCompare(String(a.added)));
  return "\uFEFF" + [["Название", "Автор", "Год издания", "Полка", "Оценка", "Прочитано", "Добавлено"].map(q).join(";"),
    ...rows.map(b => [b.title, (b.authors ?? []).join(", "), b.year, SHELVES[b.shelf], b.rating, (b.reads ?? []).join(", "),
      String(b.added ?? "").slice(0, 10)].map(q).join(";"))].join("\r\n") + "\r\n";
}
