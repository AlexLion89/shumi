// Склейка и порядок результатов из разных каталогов. Отдельный модуль без DOM — проверяется в node:test.

export const norm = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Основное название: до точки, двоеточия или скобки и без английского артикля в начале.
const mainTitle = t => norm(String(t).split(/[.:(]/)[0]).replace(/^(the|a|an) /, "");
// Одна книга из разных каталогов: основное название + фамилия первого автора.
export const bookKey = b => mainTitle(b.title) + "|" + (norm(b.authors[0]).split(" ").pop() ?? "");

// Слово запроса есть в тексте, если какое-то слово текста начинается с его основы (без двух последних букв
// у слов от пяти букв): «тревожные» найдёт «тревожных», «патриархат» — «патриархата».
const stem = w => w.length >= 5 ? w.slice(0, -2) : w;
const has = (words, w) => words.some(x => x.startsWith(stem(w)));

// 100 — название совпало, 90 — начинается с запроса, 50–80 — все слова нашлись (выше, чем больше их в названии),
// меньше 40 — нашлась часть слов, 0 — ничего: каталог нашёл книгу по аннотации.
export function score(b, q) {
  const qn = norm(q).replace(/^(the|a|an) /, ""), qw = qn.split(" ").filter(Boolean);
  if (!qw.length) return 0;
  const t = mainTitle(b.title);
  if (t === qn) return 100;
  if (t.startsWith(qn)) return 90;
  const tw = norm(b.title).split(" "), aw = norm(b.authors.join(" ")).split(" ");
  const inTitle = qw.filter(w => has(tw, w)).length;
  const inAny = qw.filter(w => has(tw, w) || has(aw, w)).length;
  if (inAny === qw.length) return 50 + Math.round(30 * inTitle / qw.length);
  return Math.round(40 * inAny / qw.length);
}

// got — {каталог: [книги]}, order — каталоги по старшинству для этого запроса.
// Возвращает книги без дублей, лучшие сверху; если хоть что-то совпало, совсем не совпавшее убирается.
export function merge(got, order, q) {
  const merged = new Map();
  order.forEach((s, si) => (got[s] ?? []).forEach((b, i) => {
    const key = bookKey(b), m = merged.get(key);
    if (!m) merged.set(key, { ...b, srcs: [s], pos: i * 10 + si });
    else {
      if (!m.srcs.includes(s)) m.srcs.push(s);
      if (!m.cover && b.cover) m.cover = b.cover;
    }
  }));
  let list = [...merged.values()].map(b => {
    const base = score(b, q);
    return { ...b, base, rank: base + (b.cover ? 3 : 0) + (b.srcs.length > 1 ? 5 : 0) };
  });
  if (list.some(b => b.base > 0)) list = list.filter(b => b.base > 0);
  return list.sort((a, b) => b.rank - a.rank || a.pos - b.pos);
}
