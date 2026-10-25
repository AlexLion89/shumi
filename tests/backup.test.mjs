// tools/backup.mjs в отдельной временной папке: фото обложки (repo:) не скачивается и не удаляется,
// копия обложки убранной книги удаляется, shelf.csv пишется. Без сети: у книг нет обложек-адресов.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("копии обложек: фото из приложения остаётся, обложка убранной книги удаляется, таблица пишется", () => {
  const dir = mkdtempSync(join(tmpdir(), "shumi-backup-"));
  try {
    writeFileSync(join(dir, "shelf.json"), JSON.stringify({ version: 1, books: {
      ph: { title: "С фото", authors: ["А"], shelf: "want", cover: "repo:covers/ph.jpg?v=abc", reads: [], added: "2026-10-25" },
      nc: { title: "Без обложки", authors: ["Б"], shelf: "read", cover: null, reads: ["2026-10"], added: "2026-10-24" },
    } }));
    mkdirSync(join(dir, "covers"));
    writeFileSync(join(dir, "covers", "ph.jpg"), "фото");
    writeFileSync(join(dir, "covers", "gone.jpg"), "убранная книга");
    execFileSync(process.execPath, [fileURLToPath(new URL("../tools/backup.mjs", import.meta.url))], { cwd: dir, stdio: "pipe" });
    assert.equal(readFileSync(join(dir, "covers", "ph.jpg"), "utf8"), "фото");
    assert.equal(existsSync(join(dir, "covers", "gone.jpg")), false);
    assert.equal(JSON.parse(readFileSync(join(dir, "covers", "index.json"), "utf8")).ph, "repo:covers/ph.jpg?v=abc");
    assert.match(readFileSync(join(dir, "shelf.csv"), "utf8"), /"Без обложки";"Б"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
