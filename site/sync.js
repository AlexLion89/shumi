// Полка на телефоне и её отправка в GitHub.
// В хранилище (localStorage) две вещи: base — последняя версия файла с сервера и её sha, queue — ещё не
// отправленные операции. На экране всегда base + queue, поэтому правка видна сразу, даже без сети.
// Отправка: очередь накладывается на base и уходит одним коммитом. Файл успели поменять с другого
// устройства (Conflict) — перечитываем его и накладываем очередь заново.
import { AuthError, Conflict } from "./github.js";
import { apply, describe, emptyShelf, serialize } from "./shelf.js";

// fresh — сколько после своей записи не перечитывать файл: GitHub пару секунд может отдавать прежнюю версию,
// и только что добавленная книга на экране пропала бы.
export function createStore({ storage, client, onChange = () => {}, delay = 1500, fresh = 15000, now = Date.now }) {
  let base = storage.get("shelf.base") ?? { shelf: emptyShelf(), sha: null };
  let queue = storage.get("shelf.queue") ?? [];
  let status = queue.length ? "waiting" : "idle";   // idle | waiting | saving | offline | auth
  let running = null, timer = null, wrote = 0;

  const save = () => { storage.set("shelf.base", base); storage.set("shelf.queue", queue); };
  const setStatus = s => { if (s !== status) { status = s; onChange(); } };

  async function run() {
    let conflicts = 0;
    try {
      setStatus("saving");
      if (!queue.length && now() - wrote > fresh) {
        const r = await client.get();
        if (r.sha !== base.sha) { base = r; save(); }
      }
      // Пока шла отправка, могли появиться новые правки — отправляем, пока очередь не опустеет.
      while (queue.length) {
        const sending = queue.slice(), next = apply(base.shelf, sending);
        try {
          const r = await client.put(serialize(next), base.sha, describe(sending, base.shelf, next));
          base = { shelf: next, sha: r.sha };
          queue = queue.slice(sending.length);
          wrote = now();
          save();
        } catch (e) {
          if (!(e instanceof Conflict) || ++conflicts > 3) throw e;
          base = await client.get();
          save();
        }
      }
      setStatus("idle");
      onChange();
    } catch (e) {
      setStatus(e instanceof AuthError ? "auth" : "offline");
    }
  }

  // Одна отправка за раз. Правка, сделанная во время чтения файла, — ещё один круг сразу после.
  function sync() {
    if (!running) running = run().finally(() => { running = null; if (queue.length && status === "idle") schedule(); });
    return running;
  }
  function schedule(ms = delay) { clearTimeout(timer); timer = setTimeout(sync, ms); }

  return {
    view: () => apply(base.shelf, queue),
    status: () => status,
    pending: () => queue.length,
    change(ops) {
      queue.push(...ops);
      save();
      if (status === "idle") status = "waiting";
      onChange();
      schedule();
    },
    sync,
  };
}
