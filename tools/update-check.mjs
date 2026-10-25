// Кнопка «Обновить» на живом сайте: открывает https://shumi.sirenyov.link (ключ — только для входа; запись в GitHub
// браузер отклоняет — readOnlyGitHub), ждёт, пока выкладка сменит версию в sw.js, и проверяет, что в открытом приложении появилась
// «Вышла новая версия · Обновить», а по нажатию включилась новая версия. Запускать перед пушем и не закрывать,
// пока идёт выкладка (до 8 минут).
//
//   SHUMI_TOKEN_FILE=~/.shumi-dev-token node tools/update-check.mjs
import { readFileSync } from "node:fs";
import { cleanKey } from "../site/github.js";
import { launch } from "./cdp.mjs";

const token = cleanKey(process.env.SHUMI_TOKEN_FILE ? readFileSync(process.env.SHUMI_TOKEN_FILE, "utf8") : process.env.SHUMI_TOKEN);
if (!/^github_pat_\w+$/.test(token)) { console.error("нет ключа: SHUMI_TOKEN_FILE или SHUMI_TOKEN"); process.exit(2); }
const SITE = "https://shumi.sirenyov.link/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const live = async () => (await (await fetch(`${SITE}sw.js?r=${Date.now()}`)).text()).match(/VERSION = "([^"]+)"/)?.[1];
const shell = "caches.keys().then(k => (k.find(x => x.startsWith('shell-')) || '').slice(6))";

const page = await launch({ port: 9341 });
await page.readOnlyGitHub();   // только чтение: в настоящую полку ничего не запишется
let ok = false;
try {
  await page.goto(SITE);
  await page.eval(`localStorage.setItem("shumi.key", ${JSON.stringify(token)}); location.reload(); 1`);
  await page.until("navigator.serviceWorker.controller && !document.getElementById('app').hidden", 30000);
  const before = await page.eval(shell);
  console.log(`открыта версия ${before}; жду выкладку…`);
  let now = before;
  for (let i = 0; i < 32 && now === before; i++) { await sleep(15000); now = await live(); }
  if (now === before) throw new Error("выкладка не сменила версию за 8 минут");
  console.log(`на сайте ${now}`);
  await page.eval("navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => 1)");
  await page.until("!document.getElementById('update').hidden", 60000);
  console.log("PASS появилась «Вышла новая версия · Обновить»");
  await page.click("#update");
  await page.until(`${shell}.then(v => v === ${JSON.stringify(now)})`, 30000);
  await page.until("document.readyState === 'complete' && !document.getElementById('app').hidden && document.getElementById('update').hidden", 30000);
  console.log(`PASS после «Обновить» работает ${now}`);
  ok = !page.errors.length;
  if (!ok) console.log("FAIL ошибки: " + page.errors.join(" | "));
} catch (e) {
  console.log("FAIL " + e.message);
} finally {
  await page.eval("localStorage.clear(); 1").catch(() => {});
  await page.close();
}
process.exit(ok ? 0 : 1);
