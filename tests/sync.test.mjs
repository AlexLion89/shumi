// Отправка полки: очередь, конфликты с другим устройством, нет связи, плохой ключ; клиент GitHub — на
// поддельном fetch с настоящими кодами ответов GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthError, cleanKey, github } from "../site/github.js";
import { apply, emptyShelf, parse, serialize } from "../site/shelf.js";
import { createStore } from "../site/sync.js";
import { fakeGitHub, memStorage } from "./helpers.mjs";

const op = (id, book) => ({ op: "put", id, book });

test("правка видна сразу, уходит одним коммитом, очередь пустеет", async () => {
  const gh = fakeGitHub(), storage = memStorage();
  const store = createStore({ storage, client: github({ token: "t", base: gh.base, fetch: gh.fetch }) });
  store.change([op("a", { title: "Масло", authors: ["Асако Юзуки"], shelf: "want", added: "2026-10-24" })]);
  store.change([op("a", { rating: 5 })]);
  assert.equal(store.view().books.a.rating, 5, "на экране сразу");
  assert.equal(store.pending(), 2);
  await store.sync();
  assert.equal(store.pending(), 0);
  assert.equal(store.status(), "idle");
  assert.equal(gh.commits.length, 1);
  assert.match(gh.commits[0].message, /^2 изменения на полке|^Хочу прочитать: «Масло»/);
  assert.equal(parse(gh.text()).books.a.rating, 5);
  assert.deepEqual(storage.get("shelf.queue"), [], "очередь сохранена пустой");
});

test("конфликт: файл поменяли с другого устройства — свои правки накладываются на чужие", async () => {
  const gh = fakeGitHub(serialize({ version: 1, books: { a: { title: "A", shelf: "want", added: "1" } } }));
  const store = createStore({ storage: memStorage(), client: github({ token: "t", base: gh.base, fetch: gh.fetch }) });
  await store.sync();                                    // телефон прочитал полку
  gh.external(s => apply(s, [op("b", { title: "B с планшета", shelf: "read", added: "2" })]));   // планшет дописал
  store.change([op("a", { rating: 4 })]);                // телефон ставит оценку по старой версии
  await store.sync();
  const s = parse(gh.text());
  assert.equal(s.books.a.rating, 4);
  assert.equal(s.books.b.title, "B с планшета");
  assert.equal(gh.conflicts, 1);
  assert.equal(store.view().books.b.title, "B с планшета", "и на экране — тоже");
});

test("нет связи: правки ждут на телефоне и уходят, когда связь вернулась", async () => {
  const gh = fakeGitHub(), storage = memStorage();
  const client = github({ token: "t", base: gh.base, fetch: gh.fetch });
  const store = createStore({ storage, client });
  gh.down = true;
  store.change([op("a", { title: "Офлайн", shelf: "want", added: "1" })]);
  await store.sync();
  assert.equal(store.status(), "offline");
  assert.equal(store.pending(), 1);
  // Приложение закрыли и открыли: очередь — из хранилища.
  const again = createStore({ storage, client });
  assert.equal(again.view().books.a.title, "Офлайн");
  gh.down = false;
  await again.sync();
  assert.equal(again.pending(), 0);
  assert.equal(parse(gh.text()).books.a.title, "Офлайн");
});

test("плохой ключ — статус auth, правки не теряются", async () => {
  const gh = fakeGitHub();
  const store = createStore({ storage: memStorage(), client: github({ token: "чужой", base: gh.base, fetch: gh.fetch }) });
  store.change([op("a", { title: "X", shelf: "want", added: "1" })]);
  await store.sync();
  assert.equal(store.status(), "auth");
  assert.equal(store.pending(), 1);
});

test("клиент GitHub: кириллица туда и обратно, пустой репозиторий — пустая полка, проверка ключа", async () => {
  const gh = fakeGitHub(null);
  const c = github({ token: "t", base: gh.base, fetch: gh.fetch });
  assert.deepEqual(await c.get(), { shelf: emptyShelf(), sha: null });
  const text = serialize({ version: 1, books: { a: { title: "Тревожные люди — «Бакман» ✓", added: "1" } } });
  const { sha } = await c.put(text, null, "первая");
  assert.equal(gh.text(), text);
  assert.equal((await c.get()).sha, sha);
  await c.check();
  await assert.rejects(github({ token: "чужой", base: gh.base, fetch: gh.fetch }).check(), AuthError);
});

test("сразу после своей записи файл не перечитывается — книга не мигает назад", async () => {
  const gh = fakeGitHub();
  let t = 1000;
  const store = createStore({ storage: memStorage(), client: github({ token: "t", base: gh.base, fetch: gh.fetch }), now: () => t });
  store.change([op("a", { title: "Свежая", shelf: "want", added: "1" })]);
  await store.sync();
  gh.external(() => ({ version: 1, books: {} }));      // «старая» версия, которую мог бы отдать GitHub
  t += 5000;
  await store.sync();
  assert.equal(store.view().books.a.title, "Свежая");
  t += 20000;                                          // а позже — перечитывается как обычно
  await store.sync();
  assert.deepEqual(store.view().books, {});
});

test("ключ, вставленный с мусором, чистится; с кириллицей — «ключ не подходит», а не «нет связи»", async () => {
  assert.equal(cleanKey(' \uFEFF"github_pat_AbC_123"\r\n'), "github_pat_AbC_123");
  assert.equal(cleanKey("«github_pat_x»"), "github_pat_x");
  const gh = fakeGitHub();
  await assert.rejects(github({ token: "github_pat_ключ", base: gh.base, fetch: gh.fetch }).check(), AuthError);
});

test("полка не изменилась — GitHub отвечает 304, на телефон ничего не скачивается; изменилась — скачивается", async () => {
  const gh = fakeGitHub();
  let t = 0;
  const store = createStore({ storage: memStorage(), client: github({ token: "t", base: gh.base, fetch: gh.fetch }), now: () => (t += 60000) });
  await store.sync();
  await store.sync();
  assert.equal(gh.notModified, 1);
  gh.external(s => apply(s, [op("x", { title: "С планшета", shelf: "want", added: "1" })]));
  await store.sync();
  assert.equal(store.view().books.x.title, "С планшета");
});
