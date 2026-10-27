// Склейка и порядок результатов из разных каталогов. Отдельный модуль без DOM — проверяется в node:test.

export const norm = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const noArticle = s => s.replace(/^(the|a|an) /, "");
// Основное название: до одиночной точки, двоеточия или скобки (и китайских «：（») и без английского артикля в начале.
// Многоточие — не конец названия: «Зулейха... далёкое всё ближе» не должно стать «Зулейхой».
export const mainTitle = t => noArticle(norm(String(t).split(/(?<!\.)\.(?!\.)|[:(：（]/)[0]));
// Китайское имя бывает из двух иероглифов («余华») — его не отбрасываем.
const HAN = /\p{Script=Han}/u;
const nameWords = authors => norm(authors.join(" ")).split(" ").filter(w => w.length >= 3 || HAN.test(w));

// Одна книга из разных каталогов: то же основное название и хотя бы одно общее слово в именах авторов —
// «Юзуки Асако» в LitRes и «Асако Юзуки» в FantLab одна книга. Автора нет у одной из сторон — хватает названия.
export function sameBook(a, b) {
  if (mainTitle(a.title) !== mainTitle(b.title)) return false;
  const wa = new Set(nameWords(a.authors)), wb = nameWords(b.authors);
  return !wa.size || !wb.length || wb.some(w => wa.has(w));
}

// Слово запроса есть в тексте, если какое-то слово текста начинается с его основы (без двух последних букв
// у слов от пяти букв): «тревожные» найдёт «тревожных», «роулинг» — «роулинга». В китайском пробелов между словами
// нет — иероглифы ищутся в любом месте: «难明» найдёт «长夜难明».
const stem = w => w.length >= 5 ? w.slice(0, -2) : w;
const has = (words, w) => words.some(x => (HAN.test(w) ? x.includes(w) : x.startsWith(stem(w))));

// 100 — название совпало целиком, 91 — совпало до подзаголовка («Магия утра. Как первый час дня» — сама книга,
// выше серии «Магия утра для предпринимателей»), 90 — начинается с запроса, 85 — запрос — это автор,
// 50–80 — все слова нашлись (выше, чем больше их в названии), до 40 — часть слов, 0 — ничего:
// каталог нашёл книгу по аннотации.
export function score(b, q) {
  const qn = noArticle(norm(q)), qw = qn.split(" ").filter(Boolean);
  if (!qw.length) return 0;
  const t = mainTitle(b.title);
  if (noArticle(norm(b.title)) === qn) return 100;
  if (t === qn) return 91;
  if (t.startsWith(qn + " ")) return 90;
  const tw = norm(b.title).split(" "), aw = norm(b.authors.join(" ")).split(" ");
  if (qw.every(w => has(aw, w))) return 85;
  const inTitle = qw.filter(w => has(tw, w)).length;
  const inAny = qw.filter(w => has(tw, w) || has(aw, w)).length;
  if (inAny === qw.length) return 50 + Math.round(30 * inTitle / qw.length);
  return Math.round(40 * inAny / qw.length);
}

// got — {каталог: [книги]}, order — каталоги по старшинству для этого запроса.
// Возвращает книги без дублей, лучшие сверху; если хоть что-то совпало, совсем не совпавшее убирается.
// К оценке: +3 за обложку, +5 если книгу нашли два каталога, +2 за FantLab — это каталог произведений,
// а магазины (LitRes, Google Books) кладут рядом с романом путеводители и фан-квизы; −10 без автора (раскраски,
// сувениры); −8 за книгу тоньше 80 страниц — так выглядят пересказы («Atomic Habits» на 63 страницы от другого автора).
export function merge(got, order, q) {
  const list = [];
  order.forEach((s, si) => (got[s] ?? []).forEach((b, i) => {
    const m = list.find(x => sameBook(x, b));
    if (!m) list.push({ ...b, srcs: [s], pos: i * 10 + si });
    else {
      if (!m.srcs.includes(s)) m.srcs.push(s);
      if (!m.cover && b.cover) m.cover = b.cover;
      if (!m.authors.length && b.authors.length) m.authors = b.authors;
    }
  }));
  let scored = list.map(b => {
    const base = score(b, q);
    const bonus = (b.cover ? 3 : 0) + (b.srcs.length > 1 ? 5 : 0) + (b.srcs.includes("fantlab") ? 2 : 0) - (b.authors.length ? 0 : 10)
      - (b.pages > 0 && b.pages < 80 ? 8 : 0);
    return { ...b, base, rank: base + bonus };
  });
  if (scored.some(b => b.base > 0)) scored = scored.filter(b => b.base > 0);
  return scored.sort((a, b) => b.rank - a.rank || a.pos - b.pos);
}
