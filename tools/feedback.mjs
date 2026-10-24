// Замечания Вики: прочитать и ответить — как scripts/feedback.mjs в «Хурма вяжет». Работает с клоном приватного
// shumi-data рядом с этим репозиторием (../shumi-data; git с обычными учётными данными). Ответ появится в
// приложении при ближайшей синхронизации; «done» ещё и закрывает issue-уведомление (задание feedback.yml в shumi-data).
//
//   node tools/feedback.mjs                       # открытые замечания
//   node tools/feedback.mjs all                   # все
//   node tools/feedback.mjs reply <id> "текст"    # ответить, не закрывая
//   node tools/feedback.mjs done <id> "текст"     # ответить и пометить «сделано»
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "..", "shumi-data");
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

if (!existsSync(join(dir, ".git"))) {
  // Без подмены переводов строк (глобально на Windows включена): иначе JSON уходят с CRLF.
  execFileSync("git", ["clone", "-q", "-c", "core.autocrlf=false", "https://github.com/AlexLion89/shumi-data.git", dir]);
  git("config", "user.name", "AlexLion89");
  git("config", "user.email", "sirenyov@gmail.com");
  git("config", "core.autocrlf", "false");
} else {
  git("pull", "-q", "--ff-only");
}

const fbDir = join(dir, "feedback");
const load = () => (existsSync(fbDir) ? readdirSync(fbDir) : [])
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(join(fbDir, f), "utf8")))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const msk = iso => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК";

const [cmd = "open", id, ...rest] = process.argv.slice(2);
if (cmd === "open" || cmd === "all") {
  const items = load().filter(f => cmd === "all" || f.status !== "done");
  if (!items.length) console.log("Замечаний нет.");
  for (const f of items) {
    console.log(`— ${f.id} · ${msk(f.createdAt)}${f.status === "done" ? " · сделано" : ""}`);
    console.log(`  ${f.text.replace(/\n/g, "\n  ")}`);
    if (f.reply) console.log(`  ↳ ответ: ${f.reply}`);
  }
} else if (cmd === "reply" || cmd === "done") {
  const text = rest.join(" ").trim(), path = join(fbDir, `${id}.json`);
  if (!id || !text || !existsSync(path)) {
    console.error('Нужно: reply|done <id> "текст" — и такое замечание должно существовать');
    process.exit(1);
  }
  const f = JSON.parse(readFileSync(path, "utf8"));
  f.reply = text;
  if (cmd === "done") f.status = "done";
  writeFileSync(path, JSON.stringify(f, null, 2) + "\n");
  git("add", path);
  git("commit", "-q", "-m", `Ответ на замечание: ${f.text.slice(0, 50)}`);
  git("push", "-q");
  console.log(`Ответ записан${cmd === "done" ? ", замечание закрыто" : ""}.`);
} else {
  console.error('Команды: open (по умолчанию), all, reply <id> "текст", done <id> "текст"');
  process.exit(1);
}
