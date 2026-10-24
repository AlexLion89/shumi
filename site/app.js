// Этап 0 полки: поиск по каталогам через Worker и замеры связи с этого телефона.
// Замеры копятся в localStorage («netlog») и уходят на Worker пачками, когда он доступен;
// сводка по всем устройствам — GET <API>/netlog/summary. Адрес API можно подменить: ?api=…

const API = new URLSearchParams(location.search).get("api") || "https://shumi-api.sirenyov.workers.dev";
const TIMEOUT = 10000;
const SOURCES = { litres: "LitRes", fantlab: "FantLab", openlibrary: "Open Library" };
const KINDS = [
  ["ping-cf", "Сервер полки"],
  ["ping-gh", "Сайт"],
  ["search-litres", "Поиск LitRes"],
  ["search-fantlab", "Поиск FantLab"],
  ["search-openlibrary", "Поиск Open Library"],
];

const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
}
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };
const sec = ms => (ms / 1000).toFixed(1).replace(".", ",") + " с";

const dev = load("dev", null) || (() => { const d = Math.random().toString(36).slice(2, 10); save("dev", d); return d; })();

// ---------- замеры

let log = load("netlog", []);   // [{at, k, ok, ms, err, s}]; s: 1 — уже на сервере
const lastAt = {};

function record(k, ok, ms, err) {
  // На сервере замер уникален по (устройство, время, вид) — два замера одного вида в одну миллисекунду разводим.
  const at = Math.max(Date.now(), (lastAt[k] ?? 0) + 1);
  lastAt[k] = at;
  log.push(ok ? { at, k, ok: 1, ms } : { at, k, ok: 0, ms, err });
  if (log.length > 1000) log = log.slice(-1000);
  save("netlog", log);
  renderNet();
}

function fetchT(url, opts = {}) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), TIMEOUT);
  return fetch(url, { cache: "no-store", ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

// Запрос с замером: {data, ms}. При отказе — исключение, замер всё равно записан.
async function measured(k, url) {
  const t0 = performance.now();
  let err = "net";
  try {
    const r = await fetchT(url);
    if (!r.ok) { err = "http" + r.status; throw new Error(err); }
    const data = await r.json();
    const ms = Math.round(performance.now() - t0);
    record(k, true, ms);
    if (k !== "ping-gh") flush();
    return { data, ms };
  } catch (e) {
    if (e.name === "AbortError") err = "timeout";
    record(k, false, Math.round(performance.now() - t0), err);
    throw e;
  }
}

let flushing = false;
async function flush() {
  const batch = log.filter(e => !e.s).slice(0, 200);
  if (flushing || !batch.length) return;
  flushing = true;
  try {
    // text/plain — «простой» запрос без предварительного OPTIONS.
    const r = await fetchT(API + "/netlog", {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ dev, events: batch.map(({ at, k, ok, ms, err }) => ({ at, k, ok, ms, err })) }),
    });
    if (r.ok) { for (const e of batch) e.s = 1; save("netlog", log); }
  } catch { /* не дошло — уйдёт со следующим удачным запросом */ }
  finally { flushing = false; renderNet(); }
}

function renderNet() {
  const rows = KINDS.map(([k, name]) => {
    const xs = log.filter(e => e.k === k);
    if (!xs.length) return null;
    const ok = xs.filter(e => e.ok), ms = ok.map(e => e.ms).sort((a, b) => a - b);
    const share = ok.length / xs.length;
    return el("tr", { class: share < 0.9 ? "bad" : share < 1 ? "meh" : null },
      el("th", {}, name),
      el("td", {}, `${ok.length} из ${xs.length}`),
      el("td", {}, ms.length ? "обычно " + sec(ms[Math.floor(ms.length / 2)]) : "—"));
  });
  $("net-table").replaceChildren(...rows.filter(Boolean));
  const wait = log.filter(e => !e.s).length;
  $("net-sent").textContent = wait ? `Ждут отправки на сервер: ${wait}` : log.length ? "Все замеры на сервере." : "";
}

let checking = false;
async function checkNet(rounds) {
  if (checking) return;
  checking = true;
  $("net-check").disabled = true;
  for (let i = 0; i < rounds; i++) {
    await Promise.allSettled([
      measured("ping-cf", API + "/ping"),
      measured("ping-gh", "ping.json?r=" + Math.random().toString(36).slice(2)),
    ]);
    if (i < rounds - 1) await new Promise(r => setTimeout(r, 1500));
  }
  checking = false;
  $("net-check").disabled = false;
}

// ---------- поиск

const norm = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Одна книга из разных каталогов: название до первой точки/двоеточия/скобки + фамилия первого автора.
const bookKey = b => norm(String(b.title).split(/[.:(]/)[0]) + "|" + norm(b.authors[0]).split(" ").pop();

const noCover = b => el("div", { class: "cover none" }, (String(b.title).trim()[0] || "?").toUpperCase());
function bookRow(b) {
  const cover = b.cover
    ? el("img", { class: "cover", src: b.cover, alt: "", loading: "lazy", referrerpolicy: "no-referrer",
        onerror: e => e.target.replaceWith(noCover(b)) })
    : noCover(b);
  return el("li", { class: "book" }, cover,
    el("div", { class: "meta" },
      el("div", { class: "title" }, b.title),
      el("div", { class: "author" }, [b.authors.join(", "), b.year].filter(Boolean).join(" · ")),
      el("div", { class: "from" }, b.srcs.map(s => SOURCES[s]).join(" · "))));
}

let seq = 0;
function search(raw) {
  const q = raw.trim(), my = ++seq;
  if (q.length < 2) { $("sources").replaceChildren(); $("results").replaceChildren(); return; }
  const order = /[а-яё]/i.test(q) ? ["litres", "fantlab", "openlibrary"] : ["openlibrary", "litres", "fantlab"];
  const got = {}, state = {};

  const draw = () => {
    if (my !== seq) return;   // пока ждали, запрос сменился
    $("sources").replaceChildren(...order.map(s =>
      el("span", { class: "src " + (state[s]?.cls ?? "wait") }, SOURCES[s], " ", state[s]?.text ?? "…")));
    const merged = new Map();
    for (const s of order) for (const b of got[s] ?? []) {
      const key = bookKey(b), m = merged.get(key);
      if (!m) merged.set(key, { ...b, srcs: [s] });
      else {
        if (!m.srcs.includes(s)) m.srcs.push(s);
        if (!m.cover && b.cover) m.cover = b.cover;
      }
    }
    const list = [...merged.values()].slice(0, 30);
    const done = order.every(s => state[s]);
    $("results").replaceChildren(...(list.length ? list.map(bookRow)
      : done ? [el("li", { class: "empty" }, "Ничего не нашлось. Попробуй по-другому: только фамилию автора или часть названия.")] : []));
  };

  draw();
  for (const s of order) {
    measured("search-" + s, `${API}/search/${s}?q=${encodeURIComponent(q)}`)
      .then(({ data, ms }) => { got[s] = data.items; state[s] = { cls: "ok", text: `${data.items.length} · ${sec(ms)}` }; })
      .catch(e => { state[s] = { cls: "fail", text: e.name === "AbortError" ? "не дождались" : "не ответил" }; })
      .finally(draw);
  }
}

let timer;
$("q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => search(e.target.value), 800); });
$("search-form").addEventListener("submit", e => {
  e.preventDefault();
  clearTimeout(timer);
  $("q").blur();
  search($("q").value);
});
$("net-check").addEventListener("click", () => checkNet(3));
window.addEventListener("online", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkNet(1); });

renderNet();
checkNet(3).then(flush);
const q0 = new URLSearchParams(location.search).get("q");   // поиск по ссылке: …/?q=магия утра
if (q0) { $("q").value = q0; search(q0); }
