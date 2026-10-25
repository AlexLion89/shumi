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
// Сторож: проверка, которая идёт дольше 8 минут, — сбой, а не вечное ожидание.
setTimeout(() => { console.log("FAIL проверка зависла (8 минут)"); process.exit(1); }, 8 * 60 * 1000).unref();
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
  await page.until("document.querySelectorAll('#v-shelf .shelves .tile').length === 1");
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

  // Замечание: 💬 → текст → «Отправить» → файл feedback/<id>.json; ответ разработчика → точка у 💬 и ответ на экране.
  await page.click("#fb-open");
  await page.until("!document.getElementById('v-feedback').hidden");
  await page.eval("document.getElementById('fb-text').value = 'Хочу видеть, сколько страниц за год'; 1");
  await page.eval("document.getElementById('fb-form').requestSubmit(); 1");
  await page.until("document.querySelector('#fb-list .fb-item') && !document.querySelector('#fb-list .fb-item .when').textContent.includes('отправляется')");
  const fbFiles = await (await fetch("http://localhost:8788/repos/AlexLion89/shumi-data/contents/feedback", { headers: { Authorization: "Bearer t" } })).json();
  check(Array.isArray(fbFiles) && fbFiles.length === 1, "замечание ушло файлом в feedback/");
  const fbFile = await (await fetch(`http://localhost:8788/repos/AlexLion89/shumi-data/contents/${fbFiles[0].path}`, { headers: { Authorization: "Bearer t" } })).json();
  const fbData = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(fbFile.content), c => c.charCodeAt(0))));
  check(fbData.text === "Хочу видеть, сколько страниц за год" && fbData.status === "open", "в файле — её текст, статус «открыто»");
  const answered = { ...fbData, reply: "Сделаю: страницы есть не у всех книг, покажу, где известны", status: "done" };
  const enc = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  await fetch(`http://localhost:8788/repos/AlexLion89/shumi-data/contents/${fbFiles[0].path}`, { method: "PUT", headers: { Authorization: "Bearer t" },
    body: JSON.stringify({ message: "Ответ на замечание", content: enc(JSON.stringify(answered)), sha: fbFile.sha }) });
  await page.click("nav.tabs button", "Полка");
  await page.eval("document.dispatchEvent(new Event('visibilitychange')); 1");   // вернулась в приложение — синхронизация
  await page.until("!document.getElementById('fb-dot').hidden");
  check(true, "ответ пришёл — у 💬 горит точка");
  await page.shot(join(out, "04-fb-dot.png"));
  await page.click("#fb-open");
  await page.until("document.querySelector('#fb-list .reply')");
  check(await page.eval("document.querySelector('#fb-list .reply').textContent.includes('страницы есть не у всех')"), "ответ виден под замечанием");
  check(await page.eval("document.querySelector('#fb-list .when').textContent.includes('сделано')"), "замечание помечено «сделано»");
  await page.shot(join(out, "05-feedback.png"));
  await page.click("nav.tabs button", "Полка");
  check(await page.eval("document.getElementById('fb-dot').hidden"), "после просмотра точка погасла");

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
    if (!dark) {
      // «Найти на полке»: при 6 книгах не видна; вписанный текст оставляет только подходящие.
      await page.goto(`${APP}#shelf`);
      await page.until("document.querySelectorAll('#v-shelf .tile').length > 3");
      check(await page.eval("document.getElementById('f-shelf').hidden"), "мало книг — строки «найти на полке» нет");
      await page.type("#f-shelf", "зулейха");
      await page.until("document.querySelectorAll('#v-shelf .shelves .tile').length === 1");
      check(await page.eval("document.querySelector('#v-shelf .tile').getAttribute('aria-label').startsWith('Зулейха')"), "«зулейха» — на полке одна «Зулейха открывает глаза»");
      await page.type("#f-shelf", "");

      // Картинка «Итоги года»: 1080×1920, обложки — копии из репозитория (FantLab без CORS иначе не нарисовать).
      // Сменить обложку: обложка другого издания «Зулейхи» с FantLab, потом своё фото (art/raccoon.png).
      await page.goto(`${APP}#shelf`);
      await page.until("document.querySelector('#v-shelf .tile[aria-label^=\"Зулейха\"]')");
      await page.click("#v-shelf .tile[aria-label^='Зулейха']");
      await page.until("document.getElementById('sheet').open");
      await page.click("#sheet .link", "Сменить обложку");
      await page.until("document.querySelectorAll('#sheet .cover-picks img').length > 3", 30000);
      await sleep(1500);
      await page.shot(join(out, "light-cover-picker.png"));
      const picked = await page.eval("(() => { const b = document.querySelectorAll('#sheet .cover-picks button')[1]; const u = b.querySelector('img').src; b.click(); return u; })()");
      await page.until(saved);
      check((await shelfFile()).books.zul.cover === picked, "обложка другого издания «Зулейхи» сохранилась");

      await page.click("#v-shelf .tile[aria-label^='Зулейха']");
      await page.until("document.getElementById('sheet').open");
      await page.click("#sheet .link", "Сменить обложку");
      await page.until("document.querySelector('#sheet input[type=file]')");
      const { root } = await page.send("DOM.getDocument");
      const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#sheet input[type=file]" });
      await page.send("DOM.setFileInputFiles", { nodeId, files: [fileURLToPath(new URL("../art/raccoon.png", import.meta.url))] });
      await page.until("!document.getElementById('sheet').open", 30000);
      await page.until(saved);
      const zul = (await shelfFile()).books.zul;
      const photo = await (await fetch("http://localhost:8788/repos/AlexLion89/shumi-data/contents/covers/zul.jpg", { headers: { Authorization: "Bearer t", Accept: "application/vnd.github.raw" } })).arrayBuffer();
      check(zul.cover.startsWith("repo:covers/zul.jpg?v=") && new Uint8Array(photo)[0] === 0xff && new Uint8Array(photo)[1] === 0xd8,
        `фото обложки: JPEG ${photo.byteLength} байт в covers/zul.jpg, у книги ${zul.cover}`);
      await page.until("document.querySelector('#v-shelf .tile[aria-label^=\"Зулейха\"] img')?.src.startsWith('blob:')", 20000);
      check(true, "на полке обложка — из фото");
      await page.shot(join(out, "light-shelf-photo.png"));

      // «Хочу» по автору: Перрин, Элрод, Clear — русские фамилии перед латинскими.
      await page.goto(`${APP}#want`);
      await page.until("document.querySelector('#v-want select.sort')");
      await page.eval("const s = document.querySelector('#v-want select.sort'); s.value = 'author'; s.dispatchEvent(new Event('change')); 1");
      await page.until("document.querySelector('#v-want .tile')?.getAttribute('aria-label') === 'Опасная игра бабули'");
      check(true, "«Хочу» по автору: первой — Перрин");
      await page.eval("localStorage.removeItem('shumi.wantSort'); 1");

      await page.goto(`${APP}#stats/2026`);
      await page.until("[...document.querySelectorAll('#v-stats button')].some(b => b.textContent === 'Поделиться итогами')");
      // Страницы книг FantLab приложение спрашивает у изданий само — в итогах появляется «≈ N страниц».
      await page.until("document.querySelector('#v-stats').textContent.includes('страниц')", 45000);
      check(true, "страницы за год: " + await page.eval("[...document.querySelectorAll('#v-stats .avg')].map(p => p.textContent).join(' | ')"));
      await sleep(3000);   // заглушка GitHub докачивает копии обложек
      await page.click("#v-stats button", "Поделиться итогами");
      await page.until("document.querySelector('#sheet .story-preview')?.complete && document.querySelector('#sheet .story-preview').naturalWidth > 0", 30000);
      const size = await page.eval("[document.querySelector('#sheet .story-preview').naturalWidth, document.querySelector('#sheet .story-preview').naturalHeight].join('x')");
      check(size === "1080x1920", `картинка для сторис ${size}`);
      const png = await page.eval(`fetch(document.querySelector('#sheet .story-preview').src).then(r => r.blob()).then(b => new Promise(ok => {
        const f = new FileReader(); f.onload = () => ok(f.result.split(",")[1]); f.readAsDataURL(b); }))`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(out, "story-2026.png"), Buffer.from(png, "base64"));
      await page.shot(join(out, "light-story-sheet.png"));
      await page.click("#sheet .link", "Закрыть");

      // Ссылка для подруг: зашифрованные итоги в shumi-share, страница /y/ открывается без ключа, отзыв работает.
      await page.click("#v-stats button", "Ссылка для подруг");
      await page.until("[...document.querySelectorAll('#sheet button')].some(b => b.textContent === 'Создать ссылку')");
      await page.click("#sheet button", "Создать ссылку");
      await page.until("document.querySelector('#sheet .share-url')", 30000);
      const shareLink = await page.eval("document.querySelector('#sheet .share-url').value");
      const shares = await (await fetch("http://localhost:8788/repos/AlexLion89/shumi-data/contents/shares.json", { headers: { Authorization: "Bearer t" } })).json();
      const entry = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(shares.content), c => c.charCodeAt(0))))["2026"];
      const boxText = await (await fetch(`http://localhost:8788/pages/shumi-share/${entry.id}.json`)).text();
      check(shareLink.includes(`#${entry.id}.${entry.key}`) && !boxText.includes("Тревожные") && boxText.includes('"iv"'),
        "ссылка создана; в shumi-share — шифр без открытого текста");
      await page.shot(join(out, "light-share-sheet.png"));
      await page.goto(shareLink);
      await page.until("document.querySelector('#share .big')", 30000);
      check(await page.eval("document.querySelector('#share h1').textContent") === "Мой 2026 в книгах" && await page.eval("document.querySelector('#share .big').textContent") === "3",
        "подруга открыла ссылку: «Мой 2026 в книгах», 3 книги");
      check(await page.eval("[...document.querySelectorAll('#share img.cover')].some(i => i.src.startsWith('data:image/jpeg'))"), "фото обложки из приложения — внутри ссылки");
      check(await page.eval("(t => !t.includes('[object') && !t.includes('null'))(document.getElementById('share').textContent) && document.querySelector('#share h2')?.textContent.startsWith('Любимые')"),
        "страница итогов: «Любимые» на месте, без «[object…» и «null»");
      await sleep(2000);
      await page.shot(join(out, "light-share-page.png"), { full: true });
      await page.goto(`${APP}#stats/2026`);
      await page.until("[...document.querySelectorAll('#v-stats button')].some(b => b.textContent === 'Ссылка для подруг')");
      await page.click("#v-stats button", "Ссылка для подруг");
      await page.until("document.querySelector('#sheet .share-url')", 20000);
      await page.eval("window.confirm = () => true; 1");
      await page.click("#sheet button", "Отозвать");
      await page.until("[...document.querySelectorAll('#sheet button')].some(b => b.textContent === 'Создать ссылку')", 20000);
      check((await fetch(`http://localhost:8788/pages/shumi-share/${entry.id}.json`)).status === 404, "отозвана: файла в shumi-share нет");
      await page.goto(shareLink);
      await page.until("document.querySelector('#share .empty')", 20000);
      check(await page.eval("document.querySelector('#share').textContent.includes('Итогов по этой ссылке нет')"), "по отозванной ссылке — «Итогов по этой ссылке нет»");
    }
    await page.goto(`${APP}#shelf`);
    await page.until("document.querySelectorAll('#v-shelf .tile').length > 3");
    await page.click("#v-shelf .shelves .tile");
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
  // Снимок экрана входа headless Edge иногда не отдаёт — это не повод валить проверку.
  await Promise.race([page.shot(join(out, "login.png")).catch(() => {}), sleep(10000)]);
  await page.type("#key", "  «чужой ключ»  ");
  await page.eval("document.getElementById('login-form').requestSubmit(); 1");
  await page.until("document.getElementById('login-err').textContent.startsWith('Ключ не подходит')");
  check(true, "вход: ключ с кириллицей — «" + await page.eval("document.getElementById('login-err').textContent") + "»");
} catch (e) {
  check(false, "экран входа: " + e.message);
} finally { await page.close(); server.kill(); }

console.log(failed ? `\nНЕ ПРОШЛО: ${failed}` : "\nвсё прошло", "· снимки:", out);
process.exit(failed ? 1 : 0);
