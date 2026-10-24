// Замечания: отправка, правка, удаление, ответ разработчика, правка одновременно с ответом, без связи.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeedback } from "../site/feedback.js";
import { github } from "../site/github.js";
import { fakeGitHub, memStorage } from "./helpers.mjs";

let n = 0;
const make = (gh, storage = memStorage()) =>
  createFeedback({ storage, client: github({ token: "t", base: gh.base, fetch: gh.fetch }), newId: () => "f" + ++n, now: () => "2026-10-25T08:00:00.000Z" });

test("замечание уходит отдельным файлом с понятным коммитом", async () => {
  const gh = fakeGitHub(), fb = make(gh);
  await fb.add("  Хочу видеть, сколько страниц за год  ");
  const [f] = fb.list();
  const saved = JSON.parse(gh.text(`feedback/${f.id}.json`));
  assert.equal(saved.text, "Хочу видеть, сколько страниц за год");
  assert.equal(saved.status, "open");
  assert.equal(gh.commits.at(-1).message, "Замечание: Хочу видеть, сколько страниц за год");
  assert.equal(fb.list()[0].pending, false);
});

test("ответ разработчика приходит при синхронизации; точка у 💬 горит, пока не прочитан", async () => {
  const gh = fakeGitHub(), fb = make(gh);
  await fb.add("Нет книги «Код Розы» в поиске");
  const id = fb.list()[0].id;
  assert.equal(fb.unseen(), 0);
  gh.setFile(`feedback/${id}.json`, JSON.stringify({ ...JSON.parse(gh.text(`feedback/${id}.json`)), reply: "Добавил поиск по LitRes", status: "done" }));
  await fb.sync();
  assert.equal(fb.list()[0].reply, "Добавил поиск по LitRes");
  assert.equal(fb.list()[0].status, "done");
  assert.equal(fb.unseen(), 1);
  fb.markSeen();
  assert.equal(fb.unseen(), 0);
});

test("правка, пока разработчик отвечал: остаются её текст и его ответ", async () => {
  const gh = fakeGitHub(), fb = make(gh);
  await fb.add("Сделай тёмную тему");
  const id = fb.list()[0].id;
  gh.setFile(`feedback/${id}.json`, JSON.stringify({ ...JSON.parse(gh.text(`feedback/${id}.json`)), reply: "Она включается по настройке телефона" }));
  await fb.edit(id, "Сделай тёмную тему, даже если телефон в светлой");
  const saved = JSON.parse(gh.text(`feedback/${id}.json`));
  assert.equal(saved.text, "Сделай тёмную тему, даже если телефон в светлой");
  assert.equal(saved.reply, "Она включается по настройке телефона");
});

test("удаление убирает файл; без связи замечание ждёт на телефоне", async () => {
  const gh = fakeGitHub(), storage = memStorage(), fb = make(gh, storage);
  await fb.add("Опечатка");
  const id = fb.list()[0].id;
  await fb.remove(id);
  assert.equal(gh.text(`feedback/${id}.json`), null);
  assert.deepEqual(fb.list(), []);

  gh.down = true;
  await fb.add("Без связи");
  assert.equal(fb.failed(), true);
  assert.equal(fb.list()[0].pending, true);
  const again = make(gh, storage);   // приложение закрыли и открыли
  gh.down = false;
  await again.sync();
  assert.equal(again.list()[0].pending, false);
  assert.equal(again.failed(), false);
  assert.match(gh.commits.at(-1).message, /^Замечание: Без связи$/);
});

test("убранное на сервере исчезает и с телефона", async () => {
  const gh = fakeGitHub(), fb = make(gh);
  await fb.add("Временное");
  const id = fb.list()[0].id;
  gh.files.delete(`feedback/${id}.json`);
  await fb.sync();
  assert.deepEqual(fb.list(), []);
});
