// Проверка на настоящем GitHub: тот же клиент и та же отправка, что в приложении, но во временный файл
// tests/e2e-shelf.json репозитория shumi-data — настоящая полка (shelf.json) не меняется. В конце файл удаляется.
// Два «устройства» правят полку одновременно — проверяется, что правки обоих доходят.
//
//   SHUMI_TOKEN_FILE=~/.shumi-dev-token node tools/e2e-github.mjs     (или SHUMI_TOKEN=…)
// Ключ берётся из файла или переменной окружения и никуда не выводится. Файл может быть в UTF-16 с BOM —
// так Windows кладёт текст в буфер обмена, а `cat /dev/clipboard > файл` сохраняет как есть.
import { AuthError, cleanKey, github, REPO } from "../site/github.js";
import { parse } from "../site/shelf.js";
import { createStore } from "../site/sync.js";
import { memStorage } from "../tests/helpers.mjs";
import { readFileSync } from "node:fs";

function readKey(file) {
  const b = readFileSync(file);
  const text = b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8");
  return text.replace(/^﻿/, "").trim();
}
const token = cleanKey(process.env.SHUMI_TOKEN_FILE ? readKey(process.env.SHUMI_TOKEN_FILE) : process.env.SHUMI_TOKEN);
if (!/^github_pat_\w+$/.test(token ?? "")) { console.error("нет ключа: SHUMI_TOKEN_FILE или SHUMI_TOKEN (github_pat_…)"); process.exit(2); }
const PATH = "tests/e2e-shelf.json";
const API = `https://api.github.com/repos/${REPO}`;
const auth = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
const op = (id, book) => ({ op: "put", id, book });

const shelfBefore = (await (await fetch(`${API}/contents/shelf.json?ref=main`, { headers: auth })).json()).sha;
const client = () => github({ token, path: PATH });

try {
  await client().check();
  check(true, "ключ видит shumi-data и может писать");
  await github({ token: "github_pat_0000000000invalid", path: PATH }).check().then(() => check(false, "чужой ключ отклонён"),
    e => check(e instanceof AuthError, "чужой ключ отклонён"));

  const phone = createStore({ storage: memStorage(), client: client(), delay: 1e9 });
  const tablet = createStore({ storage: memStorage(), client: client(), delay: 1e9 });
  const now = new Date().toISOString();
  phone.change([op("e2e1", { title: "Тревожные люди", authors: ["Фредрик Бакман"], shelf: "want", rating: null, reads: [], added: now, updated: now })]);
  await phone.sync();
  check(phone.status() === "idle" && phone.pending() === 0, "телефон: книга ушла коммитом");

  await new Promise(r => setTimeout(r, 1500));
  await tablet.sync();
  check(tablet.view().books.e2e1?.title === "Тревожные люди", "планшет: прочитал полку с книгой телефона (кириллица цела)");

  // Одновременно: телефон ставит оценку, планшет добавляет книгу — по одной и той же версии файла.
  phone.change([op("e2e1", { shelf: "read", rating: 5, reads: [now.slice(0, 7)] })]);
  tablet.change([op("e2e2", { title: "Масло", authors: ["Асако Юзуки"], shelf: "reading", rating: null, reads: [], added: now, updated: now })]);
  await tablet.sync();
  await phone.sync();
  check(phone.status() === "idle", "телефон: конфликт с планшетом разрешён, правка ушла");

  await new Promise(r => setTimeout(r, 1500));
  const r = await fetch(`${API}/contents/${PATH}?ref=main`, { headers: auth, cache: "no-store" });
  const file = await r.json();
  const s = parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, "")), c => c.charCodeAt(0))));
  check(s.books.e2e1?.rating === 5 && s.books.e2e1?.shelf === "read", "в файле: оценка телефона");
  check(s.books.e2e2?.title === "Масло", "в файле: книга планшета");

  const commits = await (await fetch(`${API}/commits?path=${PATH}&per_page=5`, { headers: auth })).json();
  console.log(commits.map(c => "   коммит: " + c.commit.message.split("\n")[0]).join("\n"));
  check(commits.some(c => c.commit.message.startsWith("Прочитано: «Тревожные люди» — Фредрик Бакман ★★★★★")), "сообщение коммита — по-человечески");

  const del = await fetch(`${API}/contents/${PATH}`, { method: "DELETE", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Проверка e2e: временный файл убран", sha: file.sha, branch: "main" }) });
  check(del.ok, "временный файл удалён");
} catch (e) {
  check(false, "сбой: " + e.message);
}

const shelfAfter = (await (await fetch(`${API}/contents/shelf.json?ref=main`, { headers: auth })).json()).sha;
check(shelfBefore && shelfBefore === shelfAfter, "настоящая полка shelf.json не тронута");
console.log(failed ? `\nНЕ ПРОШЛО: ${failed}` : "\nвсё прошло");
process.exit(failed ? 1 : 0);
