// Проверка приложения в браузере: путь Вики на пустой полке (поиск — живой FantLab) и снимки экранов
// на демо-полке в светлой и тёмной теме. Сам поднимает tools/dev.mjs; файл полки сверяет по заглушке GitHub.
//
//   node tools/ui-check.mjs [папка для снимков]      (по умолчанию ../.mcp/ui)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const out = process.argv[2] ?? fileURLToPath(new URL("../../.mcp/ui/", import.meta.url));
mkdirSync(out, { recursive: true });
const APP = "http://localhost:8760/?gh=http://localhost:8788&token=t";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };

async function dev(...args) {
  const p = spawn(process.execPath, [fileURLToPath(new URL("dev.mjs", import.meta.url)), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  p.log = [];
  p.stdout.on("data", d => p.log.push(...String(d).trim().split("\n")));
  for (let i = 0; i < 50; i++) { await sleep(200); try { await fetch("http://localhost:8760/"); return p; } catch { /* стартует */ } }
  throw new Error("dev.mjs не поднялся");
}
async function shelfFile() {
  const r = await fetch("http://localhost:8788/repos/AlexLion89/shumi-data/contents/shelf.json", { headers: { Authorization: "Bearer t" } });
  const d = await r.json();
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(d.content), c => c.charCodeAt(0))));
}
const bookIn = (s, title) => Object.values(s.books).find(b => b.title === title);
// Нажать кнопку с текстом label в строке выдачи, где есть text.
const inRow = (text, label) => `(() => { const row = [...document.querySelectorAll("#results .book")].find(r => r.textContent.includes(${JSON.stringify(text)}));
  const b = row && [...row.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;
const saved = "document.getElementById('sync').hidden";

// ---------- путь Вики на пустой полке

let server = await dev("--empty");
let page = await launch();
try {
  await page.goto(APP + "#shelf");
  await page.until("document.querySelector('#v-shelf .empty')");
  check(await page.eval("document.querySelector('#v-shelf').textContent.includes('Полка пока пустая')"), "пустая полка: приглашение найти книгу");
  await page.shot(join(out, "01-empty.png"));

  await page.click("nav.tabs button", "Найти");
  await page.type("#q", "масло");
  await page.until("[...document.querySelectorAll('#results .book')].some(r => r.textContent.includes('Юзуки'))");
  await page.shot(join(out, "02-find.png"));
  check(await page.eval(inRow("Юзуки", "Хочу")), "«Масло» Юзуки → «Хочу»");
  await page.until(saved);
  await page.until("[...document.querySelectorAll('#results .book')].find(r => r.textContent.includes('Юзуки')).textContent.includes('На полке: Хочу прочитать')");
  let s = await shelfFile();
  check(bookIn(s, "Масло")?.shelf === "want", "в GitHub: «Масло» на полке «Хочу»");

  await page.type("#q", "тревожные люди");
  await page.until("[...document.querySelectorAll('#results .book')].some(r => r.textContent.includes('Бакман'))");
  check(await page.eval(inRow("Бакман", "Прочитала")), "«Тревожные люди» → «Прочитала»");
  await page.until("document.getElementById('sheet').open");
  await page.click("#sheet .stars-pick button:nth-child(4)");
  await page.shot(join(out, "03-finish.png"));
  await page.click("#sheet .pill.main", "Сохранить");
  await page.until(saved);
  s = await shelfFile();
  const trev = bookIn(s, "Тревожные люди");
  const month = new Date().toISOString().slice(0, 7);
  check(trev?.shelf === "read" && trev.rating === 4 && trev.reads?.[0] === month, `в GitHub: «Тревожные люди» прочитано, ★4, ${month}`);

  await page.click("nav.tabs button", "Полка");
  await page.until("document.querySelectorAll('#v-shelf .grid .tile').length === 1");
  check(await page.eval(`document.querySelector('#v-shelf h2').textContent.includes('${month.slice(0, 4)} · 1 книга')`), "полка: год и «1 книга»");
  await page.click("#v-shelf .tile");
  await page.until("document.getElementById('sheet').open");
  await page.click("#sheet .seg button", "Хочу");
  await page.until(saved);
  s = await shelfFile();
  check(bookIn(s, "Тревожные люди")?.shelf === "want", "карточка: перенос в «Хочу» дошёл до GitHub");
  check(bookIn(s, "Тревожные люди")?.rating === 4, "оценка при переносе не потерялась");
  await page.click("#sheet .pill.main", "Готово");

  await page.click("nav.tabs button", "Итоги");
  await page.until("document.querySelector('#v-stats .big')");
  check(await page.eval("document.querySelector('#v-stats .big').textContent") === "0", "итоги: книга ушла в «Хочу» — за год 0");

  const commits = server.log.filter(l => l.startsWith("коммит:"));
  console.log(commits.map(c => "   " + c).join("\n"));
  check(commits.length >= 3, "каждое действие — коммит с понятным сообщением");
  check(!page.errors.length, "ошибок в консоли нет" + (page.errors.length ? ": " + page.errors.join(" | ") : ""));
} finally {
  await page.close();
  server.kill();
}

// ---------- снимки на демо-полке

await sleep(500);
server = await dev();
for (const dark of [false, true]) {
  page = await launch({ dark, port: dark ? 9335 : 9334 });
  const t = dark ? "dark" : "light";
  try {
    for (const v of ["shelf", "want", "stats"]) {
      await page.goto(`${APP}#${v}`);
      await page.until(`!document.getElementById('v-${v}').hidden && document.querySelectorAll('#v-${v} img').length > 0`);
      await sleep(2500);   // обложки грузятся с FantLab, LitRes и Open Library
      await page.shot(join(out, `${t}-${v}.png`), { full: true });
    }
    await page.goto(`${APP}#shelf`);
    await page.until("document.querySelectorAll('#v-shelf .tile').length > 3");
    await page.click("#v-shelf .grid .tile");
    await page.until("document.getElementById('sheet').open");
    await sleep(1500);
    await page.shot(join(out, `${t}-card.png`));
    check(!page.errors.length, `демо (${t}): ошибок в консоли нет` + (page.errors.length ? ": " + page.errors.join(" | ") : ""));
  } finally { await page.close(); }
}
// Экран входа: без ключа.
page = await launch({ port: 9336 });
try {
  await page.goto("http://localhost:8760/");
  await page.until("!document.getElementById('login').hidden");
  await page.shot(join(out, "login.png"));
  await page.type("#key", "чужой");
  await page.eval("document.getElementById('login-form').requestSubmit(); 1");
  await sleep(100);
} finally { await page.close(); server.kill(); }

console.log(failed ? `\nНЕ ПРОШЛО: ${failed}` : "\nвсё прошло", "· снимки:", out);
process.exit(failed ? 1 : 0);
