// Книжная полка Вики: экраны и действия.
// Данные — sync.js: копия полки на телефоне + файл shelf.json в приватном GitHub-репозитории (github.js).
// Поиск — FantLab и Open Library прямо с телефона (sources.js, rank.js): Cloudflare у Вики с мобильного
// почти не отвечает (замеры 24.10.2026), поэтому ни поиск, ни данные через него не идут.
import { createFeedback } from "./feedback.js";
import { AuthError, cleanKey, github } from "./github.js";
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

let store = null, fb = null, ghClient = null;

// ---------- вход

function showLogin(msg = "") {
  $("app").hidden = true;
  $("login").hidden = false;
  $("login-err").textContent = msg;
}

$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const key = cleanKey($("key").value);
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
  const client = ghClient = github({ token: key, base: GH });
  store = createStore({ storage: ls, client, onChange: render });
  fb = createFeedback({ storage: ls, client, newId, onChange: renderFeedback });
  $("login").hidden = true;
  $("app").hidden = false;
  render();
  store.sync();
  fb.sync();   // ответы на замечания — точка у 💬
}

// ---------- экраны

const VIEWS = { shelf: viewShelf, want: viewWant, find: viewFind, stats: viewStats, feedback: viewFeedback };
const route = () => { const [tab, arg] = location.hash.slice(1).split("/"); return VIEWS[tab] ? { tab, arg } : { tab: "shelf" }; };

function render() {
  if (!store) return;
  const { tab, arg } = route();
  for (const b of document.querySelectorAll("nav.tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const t of Object.keys(VIEWS)) $("v-" + t).hidden = t !== tab;
  renderStatus();
  VIEWS[tab](store.view(), arg);
  renderFeedback();
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
// «По типу книжных полок» (ТЗ): ряд обложек стоит на полке, звёзды — подписью под полкой, как ценник на краю.
// В ряду 3 книги на телефоне и 4 на широком экране.
const WIDE = matchMedia("(min-width: 560px)");
const cover = b => el("button", { class: "tile", type: "button", "aria-label": b.title, onclick: () => openBook(b.id) }, coverEl(b));
function grid(bs, withStars) {
  const n = WIDE.matches ? 4 : 3, rows = [];
  for (let i = 0; i < bs.length; i += n) rows.push(bs.slice(i, i + n));
  return el("div", { class: "shelves", style: `--n:${n}` }, rows.map(row => el("div", { class: "shelf-row" },
    el("div", { class: "row-books" }, row.map(cover)),
    el("div", { class: "plank" }),
    withStars && row.some(b => b.rating)
      ? el("div", { class: "row-labels" }, row.map(b => el("div", { class: "stars-sm", "aria-label": b.rating ? `${b.rating} из 5` : null }, b.rating ? stars(b.rating) : "")))
      : null)));
}
WIDE.addEventListener("change", () => render());
const emptyState = (title, text, action) => el("div", { class: "empty" },
  el("img", { src: "icon-192.png", alt: "" }), el("b", {}, title), el("div", {}, text),
  action ? el("p", {}, el("button", { class: "pill main", type: "button", onclick: () => { location.hash = "find"; } }, action)) : null);
const byNewest = (a, b) => String(b.updated ?? b.added).localeCompare(String(a.updated ?? a.added));

// «Найти на полке» появляется, когда книг на экране от FILTER_FROM: по названию или автору, без учёта ё и регистра.
const FILTER_FROM = 12;
const fold = s => String(s ?? "").toLowerCase().replace(/ё/g, "е");
function filtered(input, books) {
  input.hidden = books.length < FILTER_FROM && !input.value;
  const q = fold(input.value.trim());
  return q ? books.filter(b => fold(`${b.title} ${(b.authors ?? []).join(" ")}`).includes(q)) : books;
}
const nothingFound = () => el("p", { class: "sub" }, "На полке такой нет. Поискать в каталогах — вкладка «Найти».");

function viewShelf(s) {
  const all = list(s).filter(b => b.shelf === "reading" || b.shelf === "read");
  const mine = filtered($("f-shelf"), all), q = $("f-shelf").value.trim();
  const shown = { version: 1, books: Object.fromEntries(mine.map(({ id, ...b }) => [id, b])) };
  const reading = list(shown).filter(b => b.shelf === "reading").sort(byNewest);
  const { years, undated } = readByYear(shown);
  const nothing = !reading.length && !years.size && !undated.length;
  fill($("b-shelf"),
    nothing && q ? nothingFound() : null,
    nothing && !q ? emptyState("Полка пока пустая", "Найди книгу, которую читаешь или уже прочитала, — и она встанет сюда.", "Найти книгу") : null,
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
  const all = list(s).filter(b => b.shelf === "want").sort((a, b) => String(b.added).localeCompare(String(a.added)));
  const want = filtered($("f-want"), all), q = $("f-want").value.trim();
  fill($("b-want"),
    want.length ? [el("p", { class: "sub" }, q ? `${books(want.length)} из ${all.length}` : books(want.length)), grid(want, false)]
      : q ? nothingFound() : emptyState("Пока пусто", "Нашла книгу на потом — нажми «Хочу» в поиске.", "Найти книгу"),
  );
}
$("f-shelf").addEventListener("input", () => render());
$("f-want").addEventListener("input", () => render());

// ---------- поиск

let found = { list: [], state: {}, order: [], done: false };
let seq = 0;

function fetchT(url, ms = 12000, outer) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  outer?.addEventListener("abort", () => c.abort());
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

// На мобильном важно не гонять лишнее:
// — кириллица — только FantLab: Open Library на русские запросы отвечает мусором и медленно (~3 с даже по Wi-Fi);
// — допечатала дальше — прежний поиск отменяется, а не тянет ответы, которые уже не нужны;
// — тот же запрос в течение 10 минут — из памяти.
const searchCache = new Map();
let searchAbort = null;

async function search(raw) {
  const q = raw.trim(), my = ++seq;
  searchAbort?.abort();
  if (q.length < 2) { found = { list: [], state: {}, order: [], done: false }; renderResults(); return; }
  const order = /[а-яё]/i.test(q) ? ["fantlab"] : ["openlibrary", "fantlab"];
  const key = q.toLowerCase(), hit = searchCache.get(key);
  const got = {}, state = {};
  const draw = () => {
    if (my !== seq) return;   // пока ждали, запрос сменился
    found = { list: merge(got, order, q).slice(0, 30), state, order, done: order.every(s => state[s]) };
    renderResults();
  };
  if (hit && Date.now() - hit.at < 10 * 60000) {
    Object.assign(got, hit.got);
    for (const s of order) state[s] = { cls: "ok", text: String(got[s]?.length ?? 0) };
    draw();
    return;
  }
  const abort = searchAbort = new AbortController();
  draw();
  await Promise.all(order.map(async src => {
    try {
      const r = await fetchT(SOURCES[src].url(key), 12000, abort.signal);
      if (!r.ok) throw new Error(String(r.status));
      got[src] = SOURCES[src].parse(await r.json()).slice(0, 15);
      state[src] = { cls: "ok", text: String(got[src].length) };
    } catch {
      if (abort.signal.aborted) return;   // отменён новым запросом — молча
      state[src] = { cls: "fail", text: "не ответил" };
    }
    draw();
  }));
  if (!abort.signal.aborted && order.every(s => got[s])) {
    searchCache.set(key, { at: Date.now(), got: { ...got } });
    if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value);
  }
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
    st.count ? el("p", { class: "share-row" }, el("button", { class: "pill main", type: "button", onclick: () => openStory(y) }, "Поделиться итогами")) : null,
    st.books.length ? el("div", { class: "mosaic" }, st.books.map(b => tile(b, false)))
      : el("p", { class: "sub", style: "text-align:center" }, "В этом году пока ничего не прочитано."),
    st.fives.length ? [el("h2", {}, "Любимые · ", el("span", { class: "star" }, "★★★★★")),
      el("div", { class: "mosaic" }, st.fives.map(b => tile(b, false)))] : null,
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

// ---------- картинка «Итоги года» для сторис, 1080×1920 — как сторис про книги за год со скриншотов Вики.
// Обложки: копия из shumi-data через GitHub API (с CORS — её можно рисовать на canvas; кладёт задание backup.yml),
// иначе адрес каталога, если он отдаёт CORS (LitRes, Open Library); иначе — «корешок» с названием.

const FONT = '-apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif';

async function coverBitmap(b) {
  try { const blob = await ghClient.files.blob(`covers/${b.id}.jpg`); if (blob) return await createImageBitmap(blob); } catch { /* нет копии */ }
  if (b.cover) {
    // Не дольше 8 с: один медленный каталог не должен держать всю картинку.
    try { const r = await fetchT(b.cover, 8000); if (r.ok) return await createImageBitmap(await r.blob()); } catch { /* без CORS или не дождались */ }
  }
  return null;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Строки текста, которые влезают в ширину w (для «корешка» без обложки).
function wrap(g, text, w) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > w && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function storyImage(y) {
  const st = yearStats(store.view(), y), W = 1080, H = 1920;
  const cv = el("canvas", { width: W, height: H }), g = cv.getContext("2d");
  g.fillStyle = "#F7EEE0";
  g.fillRect(0, 0, W, H);

  const icon = await createImageBitmap(await (await fetch("icon-192.png")).blob());
  g.drawImage(icon, W / 2 - 75, 100, 150, 150);
  g.textAlign = "center";
  g.fillStyle = "#2A2A2A";
  g.font = `600 58px ${FONT}`;
  g.fillText(`Мой ${y} в книгах`, W / 2, 330);
  g.font = `700 210px ${FONT}`;
  g.fillText(String(st.count), W / 2, 560);
  g.fillStyle = "#8A8580";
  g.font = `400 46px ${FONT}`;
  g.fillText(plural(st.count, "книга прочитана", "книги прочитаны", "книг прочитано"), W / 2, 630);
  if (st.avg) g.fillText(`средняя оценка ${st.avg.toFixed(1).replace(".", ",")} ★`, W / 2, 700);

  // Мозаика: столько столбцов, чтобы все обложки 2:3 влезли в рамку; последний ряд — по центру.
  const list = st.books.slice(0, 120), n = list.length;
  const box = { x: 70, y: st.avg ? 770 : 720, w: W - 140, h: 0 };
  box.h = 1800 - box.y;
  let lay;
  for (let cols = 1; cols <= 14 && !lay; cols++) {
    const gap = Math.max(10, Math.round(110 / cols)), cw = (box.w - gap * (cols - 1)) / cols, ch = cw * 1.5, rows = Math.ceil(n / cols);
    if (rows * ch + gap * (rows - 1) <= box.h || cols === 14) lay = { cols, gap, cw, ch, rows };
  }
  const bitmaps = await Promise.all(list.map(coverBitmap));
  const top = box.y + Math.max(0, (box.h - (lay.rows * lay.ch + lay.gap * (lay.rows - 1))) / 2);
  list.forEach((b, i) => {
    const row = Math.floor(i / lay.cols), inRow = Math.min(lay.cols, n - row * lay.cols), col = i % lay.cols;
    const x = box.x + (box.w - (inRow * lay.cw + (inRow - 1) * lay.gap)) / 2 + col * (lay.cw + lay.gap);
    const yy = top + row * (lay.ch + lay.gap), r = Math.max(4, lay.cw * 0.05);
    g.save();
    g.shadowColor = "rgba(60, 40, 20, .28)";
    g.shadowBlur = lay.cw * 0.12;
    g.shadowOffsetY = lay.cw * 0.03;
    roundRect(g, x, yy, lay.cw, lay.ch, r);
    g.fillStyle = "#E3D2B6";
    g.fill();
    g.restore();
    g.save();
    roundRect(g, x, yy, lay.cw, lay.ch, r);
    g.clip();
    const bm = bitmaps[i];
    if (bm) {
      const k = Math.max(lay.cw / bm.width, lay.ch / bm.height), sw = lay.cw / k, sh = lay.ch / k;
      g.drawImage(bm, (bm.width - sw) / 2, (bm.height - sh) / 2, sw, sh, x, yy, lay.cw, lay.ch);
    } else {
      g.fillStyle = "#2A2A2A";
      const fs = Math.max(12, Math.round(lay.cw * 0.12));
      g.font = `600 ${fs}px ${FONT}`;
      const lines = wrap(g, b.title, lay.cw * 0.84).slice(0, 5);
      lines.forEach((l, j) => g.fillText(l, x + lay.cw / 2, yy + lay.ch / 2 - ((lines.length - 1) * fs * 1.2) / 2 + j * fs * 1.2 + fs * 0.35));
    }
    g.restore();
  });

  g.fillStyle = "#8A8580";
  g.font = `400 34px ${FONT}`;
  g.fillText(n < st.books.length ? `и ещё ${books(st.books.length - n)} · Книжная полка` : "Книжная полка", W / 2, 1870);
  return new Promise((ok, fail) => cv.toBlob(b => (b ? ok(b) : fail(new Error("не нарисовалось"))), "image/png"));
}

async function openStory(y) {
  openSheet(() => el("div", { class: "sheet-body" }, el("h2", {}, `Итоги ${y}`), el("p", { class: "sub" }, "Рисую картинку…")), () => "story-wait");
  let blob;
  try { blob = await storyImage(y); } catch (e) { closeSheet(); toast("Не получилось нарисовать: " + e.message); return; }
  const url = URL.createObjectURL(blob), file = new File([blob], `итоги-${y}.png`, { type: "image/png" });
  // «Поделиться» — отдельным нажатием: iOS даёт открыть меню только сразу по касанию, а рисование занимает время.
  const share = navigator.canShare?.({ files: [file] })
    ? el("button", { class: "pill main", type: "button", onclick: () => navigator.share({ files: [file] }).catch(() => {}) }, "Поделиться")
    : el("a", { class: "pill main", href: url, download: file.name }, "Сохранить картинку");
  openSheet(() => el("div", { class: "sheet-body" },
    el("img", { class: "story-preview", src: url, alt: `Итоги ${y}` }),
    el("p", { class: "sub", style: "margin:0" }, "В Instagram — «Поделиться» → Instagram, или сохрани картинку и выложи в сторис."),
    el("div", { class: "sheet-foot" }, el("button", { class: "link danger", type: "button", onclick: closeSheet }, "Закрыть"), share)), () => url);
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

// ---------- замечания (как в «Хурма вяжет»): форма вверху, ниже — её замечания с ответами разработчика.
// Форма в разметке постоянная, перерисовывается только список: иначе пропадал бы текст, который она печатает.

const fbDate = iso => (iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "");

function viewFeedback() {
  renderFeedback();
  fb?.markSeen();
}

function renderFeedback() {
  if (!fb) return;
  const onScreen = route().tab === "feedback";
  $("fb-dot").hidden = onScreen || !fb.unseen();
  $("fb-open").hidden = onScreen;
  if (!onScreen) return;
  const items = fb.list();
  fill($("fb-list"),
    fb.failed() && items.some(f => f.pending) ? el("p", { class: "sub" }, "Нет связи — замечания уйдут, когда она появится.") : null,
    items.map(f => el("div", { class: "fb-item" + (f.status === "done" ? " done" : "") },
      el("div", { class: "when" }, fbDate(f.createdAt), f.status === "done" ? " · ✅ сделано" : "", f.pending ? " · ⏳ отправляется" : ""),
      el("div", { class: "text" }, f.text),
      f.reply ? el("div", { class: "reply" }, "💬 ", f.reply) : null,
      el("div", { class: "row" },
        el("button", { class: "link", type: "button", onclick: () => openFbEdit(f) }, "изменить"),
        el("button", { class: "link danger", type: "button", onclick: () => { if (confirm("Удалить это замечание?")) fb.remove(f.id); } }, "удалить")))));
}

function openFbEdit(f) {
  let text = f.text;
  openSheet(() => el("div", { class: "sheet-body" },
    el("h2", {}, "Замечание"),
    el("textarea", { class: "text", rows: 5, oninput: e => { text = e.target.value; } }, f.text),
    el("div", { class: "sheet-foot" },
      el("button", { class: "link danger", type: "button", onclick: closeSheet }, "Отмена"),
      el("button", { class: "pill main", type: "button", onclick: () => { if (text.trim()) { fb.edit(f.id, text); closeSheet(); } } }, "Сохранить"))),
  () => "fb-edit");
}

$("fb-open").addEventListener("click", () => { location.hash = "feedback"; window.scrollTo(0, 0); });
$("fb-form").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("fb-text").value.trim();
  if (!text) { $("fb-text").focus(); return; }
  fb.add(text);
  $("fb-text").value = "";
  $("fb-text").blur();
  toast("Спасибо! Замечание записано");
});

// ---------- новая версия: кнопка «Обновить», а не «закрой и открой» (как в «Хурма вяжет»)
// Service Worker новой версии ждёт, пока она не нажмёт кнопку; обновления проверяются, когда приложение
// возвращается на экран, и раз в полчаса.

async function setupUpdates() {
  if (!("serviceWorker" in navigator) || params.get("gh")) return;   // в разработке (?gh=…) не нужен
  const reg = await navigator.serviceWorker.register("sw.js").catch(() => null);
  if (!reg) return;
  const offer = w => {
    if (!w || !navigator.serviceWorker.controller) return;   // первая установка — обновлять нечего
    $("update").hidden = false;
    $("update").onclick = () => { $("update").disabled = true; w.postMessage("skip-waiting"); };
  };
  offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    w?.addEventListener("statechange", () => { if (w.state === "installed") offer(w); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
  const check = () => reg.update().catch(() => {});
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  setInterval(check, 30 * 60 * 1000);
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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { store?.sync(); fb?.sync(); } });
setInterval(() => { if (store?.pending() && document.visibilityState === "visible") store.sync(); }, 30000);
setupUpdates();

const key = localStorage.getItem(KEY);
if (key) start(key); else showLogin();
