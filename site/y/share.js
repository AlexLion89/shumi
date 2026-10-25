// Итоги года по ссылке: https://shumi.sirenyov.link/y/#<id>.<ключ>. Зашифрованный файл <id>.json лежит в публичном
// AlexLion89/shumi-share (GitHub Pages), ключ — только в ссылке; браузер расшифровывает сам (../seal.js).
// В разработке файл берётся у заглушки: ?pages=<адрес>.
import { parseShare, unseal } from "../seal.js";

const PAGES = new URLSearchParams(location.search).get("pages") || "https://alexlion89.github.io/shumi-share/";
const MONTHS = "ЯФМАМИИАСОНД";

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
}
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
}
// replaceChildren не раскрывает массивы и не пропускает null.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));
const stars = n => "★".repeat(n ?? 0) + "☆".repeat(5 - (n ?? 0));
const main = document.getElementById("share");
const say = (title, text) => fill(main, el("div", { class: "empty" },
  el("img", { src: "../icon-192.png", alt: "" }), el("b", {}, title), el("div", {}, text)));

function cover(b) {
  const none = () => el("div", { class: "cover none" }, el("span", {}, b.t), b.a?.[0] ? el("small", {}, b.a[0]) : null);
  if (!b.c) return none();
  const img = el("img", { class: "cover", src: b.c, alt: b.t, loading: "lazy", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(none()));
  return img;
}
const book = (b, withStars) => el("div", {}, cover(b), withStars && b.r ? el("div", { class: "stars-sm" }, stars(b.r)) : null);

function render(d) {
  document.title = `Мой ${d.year} в книгах · Книжная полка`;
  const max = Math.max(1, ...d.months), fives = d.books.filter(b => b.r === 5);
  fill(main,
    el("div", { class: "share-top" }, el("img", { src: "../icon-192.png", alt: "" })),
    el("h1", { style: "text-align:center" }, `Мой ${d.year} в книгах`),
    el("div", { class: "big" }, String(d.count)),
    el("div", { class: "big-sub" }, plural(d.count, "книга прочитана", "книги прочитаны", "книг прочитано")),
    el("div", { class: "bars" }, d.months.map((n, m) => el("div", { class: "bar-col" },
      el("span", {}, n || ""),
      el("div", { class: "bar" + (n ? "" : " zero"), style: `height:${n ? Math.max(8, Math.round(76 * n / max)) : 3}px` }),
      el("span", {}, MONTHS[m])))),
    d.avg ? el("p", { class: "avg" }, "Средняя оценка ", el("b", {}, d.avg.toFixed(1).replace(".", ",")), " ", el("span", { class: "star" }, "★")) : null,
    d.pagesKnown ? el("p", { class: "avg" }, el("b", {}, `≈ ${d.pages.toLocaleString("ru-RU")} ${plural(d.pages, "страница", "страницы", "страниц")}`)) : null,
    el("div", { class: "share-grid" }, d.books.map(b => book(b, true))),
    fives.length ? [el("h2", {}, "Любимые · ", el("span", { class: "star" }, "★★★★★")), el("div", { class: "mosaic" }, fives.map(b => book(b, false)))] : null,
    el("p", { class: "sub", style: "text-align:center;margin-top:32px" }, "Книжная полка"),
  );
}

const link = parseShare(location.hash);
if (!link) {
  say("Ссылка неполная", "Попросите отправить её ещё раз — целиком, вместе с частью после «#».");
} else {
  try {
    // ?t= — мимо кеша GitHub Pages: обновлённые итоги видны сразу.
    const r = await fetch(`${PAGES}${link.id}.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.status === 404) say("Итогов по этой ссылке нет", "Ссылку отозвали — или она только что создана и ещё публикуется: обновите страницу через минуту.");
    else if (!r.ok) throw new Error(String(r.status));
    else {
      let d;
      try { d = await unseal(await r.json(), link.key); } catch { say("Ссылка повреждена", "Попросите отправить её ещё раз — целиком."); }
      if (d) render(d);
    }
  } catch {
    say("Не получилось открыть", "Нет связи? Обновите страницу.");
  }
}
