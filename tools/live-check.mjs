// Живой сайт с настоящим ключом — только чтение: открывает https://shumi.sirenyov.link в headless Edge,
// кладёт ключ в хранилище страницы, ждёт, что полка загрузилась из GitHub, и сообщает, сколько книг.
// Ничего не пишет: браузер отклоняет всё, кроме GET, к GitHub API (readOnlyGitHub) — 25.10.2026 без этого
// приложение само дописало её книгам число страниц. Ключ никуда не выводится.
//
//   SHUMI_TOKEN_FILE=~/.shumi-dev-token node tools/live-check.mjs [снимок.png]
import { readFileSync } from "node:fs";
import { cleanKey } from "../site/github.js";
import { launch } from "./cdp.mjs";

const token = cleanKey(process.env.SHUMI_TOKEN_FILE ? readFileSync(process.env.SHUMI_TOKEN_FILE, "utf8") : process.env.SHUMI_TOKEN);
if (!/^github_pat_\w+$/.test(token)) { console.error("нет ключа: SHUMI_TOKEN_FILE или SHUMI_TOKEN"); process.exit(2); }

const page = await launch({ port: 9340 });
const blocked = await page.readOnlyGitHub();
let ok = false;
try {
  await page.goto("https://shumi.sirenyov.link/");
  await page.until("!document.getElementById('login').hidden || !document.getElementById('app').hidden");
  await page.eval(`localStorage.setItem("shumi.key", ${JSON.stringify(token)}); location.reload(); 1`);
  await page.until("document.readyState === 'complete' && !document.getElementById('app').hidden", 20000);
  // Полка прочитана, когда значок сохранения пропал и в хранилище есть sha файла.
  await page.until("document.getElementById('sync').hidden && JSON.parse(localStorage.getItem('shelf.base') || '{}').sha", 20000);
  const n = await page.eval("Object.keys(JSON.parse(localStorage.getItem('shelf.base')).shelf.books).length");
  console.log(`PASS живой сайт прочитал полку из GitHub: книг ${n}`);
  if (process.argv[2]) await page.shot(process.argv[2]);
  // Отклонённая запись видна в консоли как сетевая ошибка — это ожидаемо, её не считаем.
  const errs = page.errors.filter(e => !/Failed to fetch|Load failed|ERR_BLOCKED_BY_CLIENT/i.test(e));
  ok = !errs.length;
  console.log(ok ? "PASS ошибок в консоли нет" : "FAIL ошибки: " + errs.join(" | "));
  console.log(`PASS записей в GitHub не было (отклонено попыток: ${blocked()})`);
} catch (e) {
  console.log("FAIL " + e.message);
} finally {
  await page.eval("localStorage.clear(); 1").catch(() => {});
  await page.close();
}
process.exit(ok ? 0 : 1);
