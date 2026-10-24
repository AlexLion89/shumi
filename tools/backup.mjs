// Копии обложек и таблица полки — для задания shumi-data/.github/workflows/backup.yml (после каждого изменения
// shelf.json и раз в сутки). Запускается в корне клона shumi-data:  node <shumi>/tools/backup.mjs
//   covers/<id>.jpg   — обложка каждой книги: не пропадёт, если каталог сменит адрес, и годится для картинки
//                        «Итоги года» (обложки FantLab без CORS на canvas не нарисовать, а копия из репозитория — да);
//   covers/index.json — с какого адреса скачана каждая: сменила обложку — скачается заново;
//   shelf.csv         — полка таблицей, то же, что «Скачать CSV» в приложении.
// Коммит делает задание.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { parse, toCSV } from "../site/shelf.js";

const shelf = parse(readFileSync("shelf.json", "utf8"));
mkdirSync("covers", { recursive: true });
const index = existsSync("covers/index.json") ? JSON.parse(readFileSync("covers/index.json", "utf8")) : {};
let got = 0, failed = 0, removed = 0;

for (const [id, b] of Object.entries(shelf.books)) {
  if (!b.cover || (index[id] === b.cover && existsSync(`covers/${id}.jpg`))) continue;
  try {
    const r = await fetch(b.cover, { headers: { "User-Agent": "shumi-backup (+https://shumi.sirenyov.link)" }, signal: AbortSignal.timeout(20000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/")) throw new Error(`${r.status} ${type}`);
    writeFileSync(`covers/${id}.jpg`, Buffer.from(await r.arrayBuffer()));
    index[id] = b.cover;
    got++;
  } catch (e) {
    console.log(`обложка «${b.title}» (${id}): ${e.message}`);
    failed++;
  }
}
// Книгу убрали с полки — убираем и копию обложки (в истории git она останется).
for (const f of readdirSync("covers").filter(f => f.endsWith(".jpg"))) {
  const id = f.slice(0, -4);
  if (!shelf.books[id]) { unlinkSync(`covers/${f}`); delete index[id]; removed++; }
}
writeFileSync("covers/index.json", JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + "\n");
writeFileSync("shelf.csv", toCSV(shelf));
console.log(`обложки: скачано ${got}, не вышло ${failed}, убрано ${removed}; shelf.csv — книг ${Object.keys(shelf.books).length}`);
