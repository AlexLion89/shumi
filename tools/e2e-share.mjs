// Ссылка на итоги на настоящем GitHub: зашифрованный тестовый файл в shumi-share → публикация на Pages → живая
// страница https://shumi.sirenyov.link/y/ открывает его как подруга → файл удаляется → ссылка больше не открывается.
// Полку Вики не трогает. До 8 минут: Pages публикует изменения за минуту-две.
//
//   SHUMI_TOKEN_FILE=~/.shumi-dev-token node tools/e2e-share.mjs
import { readFileSync } from "node:fs";
import { SHARE_REPO, cleanKey, github } from "../site/github.js";
import { newShareId, newShareKey, seal, shareUrl } from "../site/seal.js";
import { launch } from "./cdp.mjs";

const b = readFileSync(process.env.SHUMI_TOKEN_FILE ?? "");
const token = cleanKey(b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8"));
if (!/^github_pat_\w+$/.test(token)) { console.error("нет ключа: SHUMI_TOKEN_FILE"); process.exit(2); }
const PAGES = "https://alexlion89.github.io/shumi-share/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
const status = async id => (await fetch(`${PAGES}${id}.json?t=${Date.now()}`, { cache: "no-store" })).status;
async function waitStatus(id, want, minutes = 4) {
  for (const end = Date.now() + minutes * 60000; Date.now() < end; await sleep(10000)) if (await status(id) === want) return true;
  return false;
}

const share = github({ token, repo: SHARE_REPO });
const id = newShareId(), key = newShareKey();
const data = { v: 1, year: 2026, count: 2, months: [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0], noMonth: 0, avg: 4.5, pages: 712, pagesKnown: 2,
  books: [{ t: "Проверка e2e", a: ["Тест"], c: null, r: 5 }, { t: "Вторая", a: ["Тест"], c: null, r: 4 }] };
const page = await launch({ port: 9343 });
try {
  await share.files.save(`${id}.json`, JSON.stringify(await seal(data, key)), "Проверка e2e: ссылка на итоги");
  check(true, `зашифрованный файл ${id}.json в shumi-share`);
  check(await waitStatus(id, 200), "GitHub Pages опубликовал файл");
  await page.goto(shareUrl("https://shumi.sirenyov.link/", id, key));
  await page.until("document.querySelector('#share .big') || document.querySelector('#share .empty')", 30000);
  check(await page.eval("document.querySelector('#share h1')?.textContent") === "Мой 2026 в книгах"
    && await page.eval("document.querySelector('#share .big')?.textContent") === "2", "живая страница /y/ расшифровала итоги: «Мой 2026 в книгах», 2");
  const f = await share.files.read(`${id}.json`);
  await share.files.remove(`${id}.json`, f.sha, "Проверка e2e: ссылка отозвана");
  check(await waitStatus(id, 404), "после удаления Pages больше не отдаёт файл");
  await page.goto("about:blank");   // тот же адрес с другим «#» браузер не перезагружает — сначала пустая страница
  await page.goto(shareUrl("https://shumi.sirenyov.link/", id, key));
  await page.until("document.querySelector('#share .empty')", 30000);
  check(await page.eval("document.getElementById('share').textContent.includes('Итогов по этой ссылке нет')"), "по удалённой ссылке — «Итогов по этой ссылке нет»");
} catch (e) {
  check(false, "сбой: " + e.message);
  const f = await share.files.read(`${id}.json`).catch(() => null);
  if (f) await share.files.remove(`${id}.json`, f.sha, "Проверка e2e: уборка").catch(() => {});
} finally { await page.close(); }
console.log(failed ? `\nНЕ ПРОШЛО: ${failed}` : "\nвсё прошло");
process.exit(failed ? 1 : 0);
