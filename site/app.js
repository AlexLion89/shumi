// Книжная полка Вики: экраны и действия.
// Данные — sync.js: копия полки на телефоне + файл shelf.json в приватном GitHub-репозитории (github.js).
// Поиск — FantLab и Open Library прямо с телефона (sources.js, rank.js): Cloudflare у Вики с мобильного
// почти не отвечает (замеры 24.10.2026), поэтому ни поиск, ни данные через него не идут.
import { AuthError, github } from "./github.js";
import { merge } from "./rank.js";
import { SHELVES, findSame, list, newId, readByYear, stars, thisMonth, toCSV, yearStats } from "./shelf.js";
import { SOURCES } from "./sources.js";
import { createStore } from "./sync.js";

const params = new URLSearchParams(location.search);
// Разработка: ?gh=http://localhost:8788&token=t — заглушка GitHub из tools/dev.mjs. Без ?gh ключ из адреса не берётся.
const GH = params.get("gh") || "https://api.github.com";
const KEY = "shumi.key";
if (params.get("gh") && params.get("token")) localStorage.setItem(KEY, params.get("token"));

const SOURCE_NAMES = { fantlab: "FantLab", openlibrary: "Open Library", litres: "LitRes", manual: "добавлена вручную" };
const TO_SHELF = { want: "в «Хочу прочитать»", reading: "в «Читаю»", read: "в «Прочитано»" };
const MONTHS = "ЯФМАМИИАСОНД";

const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
}
// replaceChildren не раскрывает массивы и не пропускает null — экраны собираются через fill.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* переполнено — останется в памяти */ } },
};
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
}
const books = n => `${n} ${plural(n, "книга", "книги", "книг")}`;
const short = t => (t.length > 40 ? t.slice(0, 38) + "…" : t);
const nowIso = () => new Date().toISOString();

let store = null;

// ---------- вход

function showLogin(msg = "") {
  $("app").hidden = true;
  $("login").hidden = false;
  $("login-err").textContent = msg;
}

$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const key = $("key").value.trim();
  if (!key) return;
  $("login-err").textContent = "Проверяю…";
  try {
    await github({ token: key, base: GH }).check();
    localStorage.setItem(KEY, key);
    $("key").value = "";
    start(key);
  } catch (err) {
    $("login-err").textContent = err instanceof AuthError ? `Ключ не подходит: ${err.message}.` : "Нет связи с GitHub — попробуй ещё раз.";
  }
});

function start(key) {
  store = createStore({ storage: ls, client: github({ token: key, base: GH }), onChange: render });
  $("login").hidden = true;
  $("app").hidden = false;
  render();
  store.sync();
}

// ---------- экраны

const VIEWS = { shelf: viewShelf, want: viewWant, find: viewFind, stats: viewStats };
const route = () => { const [tab, arg] = location.hash.slice(1).split("/"); return VIEWS[tab] ? { tab, arg } : { tab: "shelf" }; };

function render() {
  if (!store) return;
  const { tab, arg } = route();
  for (const b of document.querySelectorAll("nav.tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const t of Object.keys(VIEWS)) $("v-" + t).hidden = t !== tab;
  renderStatus();
  VIEWS[tab](store.view(), arg);
  sheetRender?.();
}

function renderStatus() {
  const st = store.status(), n = store.pending(), b = $("sync");
  const text = st === "auth" ? "ключ не подходит"
    : st === "offline" ? (n ? `нет связи · ждут ${n}` : "")
    : n ? "сохраняю…" : "";
  b.hidden = !text;
  b.textContent = text;
  b.classList.toggle("bad", st === "auth");
}
$("sync").addEventListener("click", () => {
  if (store.status() !== "auth") { store.sync(); return; }
  localStorage.removeItem(KEY);   // полка и несохранённые правки остаются на телефоне и уйдут с новым ключом
  showLogin("Ключ больше не подходит. Введи новый — несохранённые правки не пропадут.");
});

// Без обложки — «корешок» с названием; в маленькой обложке поиска только первая буква, иначе слова рвутся по буквам.
function coverEl(b, cls = "cover") {
  const none = () => cls.includes("sm")
    ? el("div", { class: cls + " none initial" }, (String(b.title).replace(/^[^\p{L}\p{N}]+/u, "")[0] ?? "?").toUpperCase())
    : el("div", { class: cls + " none" }, el("span", {}, b.title), b.authors?.[0] ? el("small", {}, b.authors[0]) : null);
  return b.cover
    ? el("img", { class: cls, src: b.cover, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: e => e.target.replaceWith(none()) })
    : none();
}
const tile = (b, withStars) => el("div", {},
  el("button", { class: "tile", type: "button", "aria-label": b.title, onclick: () => openBook(b.id) }, coverEl(b)),
  withStars && b.rating ? el("div", { class: "stars-sm" }, stars(b.rating)) : null);
const grid = (bs, withStars) => el("div", { class: "grid" }, bs.map(b => tile(b, withStars)));
const emptyState = (title, text, action) => el("div", { class: "empty" },
  el("img", { src: "icon-192.png", alt: "" }), el("b", {}, title), el("div", {}, text),
  action ? el("p", {}, el("button", { class: "pill main", type: "button", onclick: () => { location.hash = "find"; } }, action)) : null);
const byNewest = (a, b) => String(b.updated ?? b.added).localeCompare(String(a.updated ?? a.added));

function viewShelf(s) {
  const reading = list(s).filter(b => b.shelf === "reading").sort(byNewest);
  const { years, undated } = readByYear(s);
  const nothing = !reading.length && !years.size && !undated.length;
  fill($("v-shelf"),
    el("h1", {}, "Полка"),
    nothing ? emptyState("Полка пока пустая", "Найди книгу, которую читаешь или уже прочитала, — и она встанет сюда.", "Найти книгу") : null,
    reading.length ? el("section", {}, el("h2", {}, "Читаю"), el("div", { class: "reading" }, reading.map(b =>
      el("div", { class: "reading-card" },
        el("button", { class: "tile", type: "button", "aria-label": b.title, onclick: () => openBook(b.id) }, coverEl(b)),
        el("div", { class: "rc-title" }, b.title),
        el("button", { class: "pill main", type: "button", onclick: () => openFinish({ id: b.id }) }, "Дочитала"))))) : null,
    [...years].map(([y, bs]) => el("section", {}, el("h2", {}, String(y), el("span", { class: "count" }, " · " + books(bs.length))), grid(bs, true))),
    undated.length ? el("section", {}, el("h2", {}, "Без даты"), grid(undated, true)) : null,
  );
}

function viewWant(s) {
  const want = list(s).filter(b => b.shelf === "want").sort((a, b) => String(b.added).localeCompare(String(a.added)));
  fill($("v-want"),
    el("h1", {}, "Хочу прочитать"),
    want.length ? [el("p", { class: "sub" }, books(want.length)), grid(want, false)]
      : emptyState("Пока пусто", "Нашла книгу на потом — нажми «Хочу» в поиске.", "Найти книгу"),
  );
}

// ---------- поиск

let found = { list: [], state: {}, order: [], done: false };
let seq = 0;

function fetchT(url, ms = 12000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

async function search(raw) {
  const q = raw.trim(), my = ++seq;
  if (q.length < 2) { found = { list: [], state: {}, order: [], done: false }; renderResults(); return; }
  const order = /[а-яё]/i.test(q) ? ["fantlab", "openlibrary"] : ["openlibrary", "fantlab"];
  const got = {}, state = {};
  const draw = () => {
    if (my !== seq) return;   // пока ждали, запрос сменился
    found = { list: merge(got, order, q).slice(0, 30), state, order, done: order.every(s => state[s]) };
    renderResults();
  };
  draw();
  await Promise.all(order.map(async src => {
    try {
      const r = await fetchT(SOURCES[src].url(q.toLowerCase()));
      if (!r.ok) throw new Error(String(r.status));
      got[src] = SOURCES[src].parse(await r.json()).slice(0, 15);
      state[src] = { cls: "ok", text: String(got[src].length) };
    } catch {
      state[src] = { cls: "fail", text: "не ответил" };
    }
    draw();
  }));
}

function viewFind() { renderResults(); }

function renderResults() {
  if (!store) return;
  const s = store.view();
  fill($("find-status"), ...found.order.map(src =>
    el("span", { class: "src " + (found.state[src]?.cls ?? "") }, SOURCE_NAMES[src], " ", found.state[src]?.text ?? "…")));
  const rows = found.list.map(b => {
    const mine = findSame(s, b);
    return el("li", { class: "book" }, coverEl(b, "cover sm"),
      el("div", { class: "meta" },
        el("div", { class: "title" }, b.title),
        el("div", { class: "author" }, [b.authors.join(", "), b.year].filter(Boolean).join(" · ")),
        mine
          ? el("button", { class: "pill on", type: "button", onclick: () => openBook(mine.id) }, "На полке: " + SHELVES[mine.shelf])
          : el("div", { class: "acts" },
              el("button", { class: "pill", type: "button", onclick: () => add(b, "want") }, "Хочу"),
              el("button", { class: "pill", type: "button", onclick: () => add(b, "reading") }, "Читаю"),
              el("button", { class: "pill main", type: "button", onclick: () => openFinish({ meta: b }) }, "Прочитала"))));
  });
  fill($("results"), ...(rows.length ? rows : found.done
    ? [el("li", { class: "empty-msg" }, "Ничего не нашлось. Попробуй иначе: только фамилию автора или часть названия.")] : []));
}

let timer;
$("q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => search(e.target.value), 700); });
$("find-form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(timer); $("q").blur(); search($("q").value); });
$("manual").addEventListener("click", openManual);

function add(m, shelf, extra = {}) {
  const now = nowIso();
  store.change([{ op: "put", id: newId(), book: {
    title: m.title, authors: m.authors ?? [], year: m.year ?? null, cover: m.cover ?? null,
    src: m.src ?? "manual", srcId: m.id ?? null, url: m.url ?? null,
    shelf, rating: null, reads: [], added: now, updated: now, ...extra,
  } }]);
  toast(`«${short(m.title)}» — ${TO_SHELF[shelf]}`);
}

// ---------- итоги

function viewStats(s, arg) {
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, ...readByYear(s).years.keys()])].sort((a, b) => a - b);
  const y = years.includes(Number(arg)) ? Number(arg) : thisYear;
  const st = yearStats(s, y), i = years.indexOf(y), max = Math.max(1, ...st.months);
  const go = to => { location.hash = `stats/${to}`; };
  fill($("v-stats"),
    el("h1", {}, "Итоги"),
    el("div", { class: "year-nav" },
      el("button", { class: "arrow", type: "button", "aria-label": "год назад", disabled: i <= 0, onclick: () => go(years[i - 1]) }, "‹"),
      el("span", {}, String(y)),
      el("button", { class: "arrow", type: "button", "aria-label": "год вперёд", disabled: i >= years.length - 1, onclick: () => go(years[i + 1]) }, "›")),
    el("div", { class: "big" }, String(st.count)),
    el("div", { class: "big-sub" }, plural(st.count, "книга прочитана", "книги прочитаны", "книг прочитано")),
    el("div", { class: "bars", "aria-label": "по месяцам" }, st.months.map((n, m) => el("div", { class: "bar-col" },
      el("span", {}, n || ""),
      el("div", { class: "bar" + (n ? "" : " zero"), style: `height:${n ? Math.max(8, Math.round(76 * n / max)) : 3}px` }),
      el("span", {}, MONTHS[m])))),
    st.noMonth ? el("p", { class: "sub", style: "text-align:center" }, `и ещё ${books(st.noMonth)} — без месяца`) : null,
    st.avg ? el("p", { class: "avg" }, "Средняя оценка ", el("b", {}, st.avg.toFixed(1).replace(".", ",")), " ", el("span", { class: "star" }, "★")) : null,
    st.books.length ? el("div", { class: "mosaic" }, st.books.map(b => tile(b, false)))
      : el("p", { class: "sub", style: "text-align:center" }, "В этом году пока ничего не прочитано."),
    el("section", { class: "settings" },
      el("h2", {}, "Данные"),
      el("p", { class: "sub" }, "Полка хранится в GitHub, каждое изменение — отдельной записью: ничего не потеряется, даже если сменить телефон."),
      el("div", { class: "row" },
        el("button", { class: "pill", type: "button", onclick: downloadCSV }, "Скачать CSV"),
        el("button", { class: "link danger", type: "button", onclick: () => {
          if (!confirm("Выйти? Чтобы войти снова, понадобится ключ полки.")) return;
          localStorage.removeItem(KEY);
          location.reload();
        } }, "Сменить ключ"))),
  );
}

function downloadCSV() {
  const url = URL.createObjectURL(new Blob([toCSV(store.view())], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `полка-${nowIso().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- шторка: карточка книги, «Прочитала», «Добавить вручную»
// Перерисовывается при изменении полки, но только если изменились её данные: иначе на iPhone
// закрывался бы открытый выбор месяца, пока полка сохраняется.

let sheetRender = null;
function openSheet(build, key) {
  let last = null;
  sheetRender = force => {
    const k = key();
    if (!force && k === last) return;
    last = k;
    const body = build();
    if (!body) { closeSheet(); return; }
    fill($("sheet"), body);
  };
  sheetRender(true);
  if (!$("sheet").open) $("sheet").showModal();
}
function closeSheet() { sheetRender = null; if ($("sheet").open) $("sheet").close(); }
$("sheet").addEventListener("close", () => { sheetRender = null; });
$("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); });   // касание мимо шторки

const head = b => el("div", { class: "card-head" }, coverEl(b, "cover big"),
  el("div", {},
    el("div", { class: "title lg" }, b.title),
    el("div", { class: "author" }, [(b.authors ?? []).join(", "), b.year].filter(Boolean).join(" · ")),
    b.url ? el("a", { class: "src-link", href: b.url, target: "_blank", rel: "noopener" }, SOURCE_NAMES[b.src] ?? "источник") : null));

const starPicker = (v, set) => el("div", { class: "stars-pick" }, [1, 2, 3, 4, 5].map(n =>
  el("button", { class: n <= (v ?? 0) ? "on" : null, type: "button", "aria-label": `${n} из 5`, onclick: () => set(v === n ? null : n) }, "★")));

function readsEditor(reads, set) {
  const year = new Date().getFullYear();
  return el("div", { class: "reads" },
    reads.map((r, i) => {
      const upd = v => set(reads.map((x, j) => (j === i ? v : x)).sort());
      const input = r.length >= 7
        ? el("input", { type: "month", value: r.slice(0, 7), max: thisMonth(), onchange: e => e.target.value && upd(e.target.value) })
        : el("input", { type: "number", inputmode: "numeric", min: 1950, max: year, value: r,
            onchange: e => /^\d{4}$/.test(e.target.value) && upd(e.target.value) });
      return el("div", { class: "read-row" }, input,
        el("button", { class: "link", type: "button", onclick: () => upd(r.length >= 7 ? r.slice(0, 4) : `${r}-01`) },
          r.length >= 7 ? "помню только год" : "указать месяц"),
        reads.length > 1 ? el("button", { class: "link danger", type: "button", "aria-label": "убрать", onclick: () => set(reads.filter((_, j) => j !== i)) }, "✕") : null);
    }),
    el("button", { class: "link", type: "button", onclick: () => set([...reads, thisMonth()].sort()) }, reads.length ? "＋ прочитала ещё раз" : "＋ указать, когда"));
}

function openBook(id) {
  openSheet(() => {
    const b = store.view().books[id];
    if (!b) return null;
    const put = book => store.change([{ op: "put", id, book: { ...book, updated: nowIso() } }]);
    return el("div", { class: "sheet-body" },
      head(b),
      el("div", { class: "seg" }, [["reading", "Читаю"], ["read", "Прочитано"], ["want", "Хочу"]].map(([k, label]) =>
        el("button", { class: b.shelf === k ? "on" : null, type: "button",
          onclick: () => put(k === "read" && !b.reads?.length ? { shelf: k, reads: [thisMonth()] } : { shelf: k }) }, label))),
      b.shelf === "read" ? [
        el("div", { class: "field" }, el("label", {}, "Оценка"), starPicker(b.rating, rating => put({ rating }))),
        el("div", { class: "field" }, el("label", {}, "Когда прочитала"), readsEditor(b.reads ?? [], reads => put({ reads }))),
      ] : null,
      el("div", { class: "sheet-foot" },
        el("button", { class: "link danger", type: "button", onclick: () => remove(id) }, "Убрать с полки"),
        el("button", { class: "pill main", type: "button", onclick: closeSheet }, "Готово")));
  }, () => JSON.stringify(store.view().books[id] ?? null));
}

// «Прочитала» из поиска (meta — книга каталога) или «Дочитала» из «Читаю» (id — книга с полки).
function openFinish({ id, meta }) {
  let rating = null, month = thisMonth();
  openSheet(() => {
    const b = id ? store.view().books[id] : meta;
    if (!b) return null;
    return el("div", { class: "sheet-body" },
      head(b),
      el("div", { class: "field" }, el("label", {}, "Оценка"), starPicker(rating, r => { rating = r; sheetRender(true); })),
      el("div", { class: "field" }, el("label", {}, "Когда прочитала"),
        el("div", { class: "read-row" }, el("input", { type: "month", value: month, max: thisMonth(), onchange: e => { month = e.target.value || month; } }))),
      el("div", { class: "sheet-foot" },
        el("button", { class: "link danger", type: "button", onclick: closeSheet }, "Отмена"),
        el("button", { class: "pill main", type: "button", onclick: () => {
          if (id) {
            store.change([{ op: "put", id, book: { shelf: "read", rating, reads: [...(b.reads ?? []), month].sort(), updated: nowIso() } }]);
            toast(`«${short(b.title)}» — ${TO_SHELF.read}`);
          } else add(meta, "read", { rating, reads: [month] });
          closeSheet();
        } }, "Сохранить")));
  }, () => (id ? JSON.stringify(store.view().books[id] ?? null) : "new"));
}

function openManual() {
  let title = $("q").value.trim(), author = "";
  const meta = () => ({ title: title.trim(), authors: author.trim() ? [author.trim()] : [], src: "manual" });
  const ok = () => title.trim() || ($("manual-title")?.focus(), false);
  openSheet(() => el("div", { class: "sheet-body" },
    el("h2", {}, "Добавить вручную"),
    el("input", { id: "manual-title", class: "text", placeholder: "Название", value: title, oninput: e => { title = e.target.value; } }),
    el("input", { class: "text", placeholder: "Автор", value: author, oninput: e => { author = e.target.value; } }),
    el("div", { class: "acts" },
      el("button", { class: "pill", type: "button", onclick: () => { if (ok()) { add(meta(), "want"); closeSheet(); } } }, "Хочу"),
      el("button", { class: "pill", type: "button", onclick: () => { if (ok()) { add(meta(), "reading"); closeSheet(); } } }, "Читаю"),
      el("button", { class: "pill main", type: "button", onclick: () => { if (ok()) { const m = meta(); closeSheet(); openFinish({ meta: m }); } } }, "Прочитала"))),
  () => "manual");
}

function remove(id) {
  const b = store.view().books[id];
  if (!b || !confirm(`Убрать «${b.title}» с полки?`)) return;
  store.change([{ op: "del", id }]);
  closeSheet();
  toast(`«${short(b.title)}» убрана`, "Вернуть", () => store.change([{ op: "put", id, book: b }]));
}

// ---------- сообщение снизу

let toastTimer;
function toast(text, action, fn) {
  const t = $("toast");
  fill(t, el("span", {}, text), action ? el("button", { type: "button", onclick: () => { t.hidden = true; fn(); } }, action) : null);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2500);
}

// ---------- запуск

for (const b of document.querySelectorAll("nav.tabs button")) {
  b.addEventListener("click", () => { location.hash = b.dataset.tab; window.scrollTo(0, 0); });
}
window.addEventListener("hashchange", render);
window.addEventListener("online", () => store?.sync());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") store?.sync(); });
setInterval(() => { if (store?.pending() && document.visibilityState === "visible") store.sync(); }, 30000);
// Офлайн и мгновенный запуск. В разработке (?gh=…) не нужен: мешал бы видеть свежий код.
if ("serviceWorker" in navigator && !params.get("gh")) navigator.serviceWorker.register("sw.js").catch(() => {});

const key = localStorage.getItem(KEY);
if (key) start(key); else showLogin();
