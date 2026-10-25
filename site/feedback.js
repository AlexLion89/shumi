// Замечания Вики — «неудобно», «не хватает», «ошибка», как в «Хурма вяжет». Каждое — файл feedback/<id>.json
// в shumi-data; разработчик отвечает в том же файле (reply, status: "done") командой tools/feedback.mjs, и ответ
// появляется в приложении при следующей синхронизации.
//   {id, text, status: "open" | "done", reply, createdAt, editedAt}
// На телефоне (localStorage «shumi.feedback»): {items: {id: {data, sha, dirty, deleted}}, seen: {id: ответ}} —
// seen помнит, какие ответы она уже видела: у 💬 горит точка, пока есть непрочитанный.
import { Conflict } from "./github.js";

export const newFeedback = (id, now, text) => ({ id, text, status: "open", reply: "", createdAt: now, editedAt: now });
const file = id => `feedback/${id}.json`;
const toText = f => JSON.stringify(f, null, 2) + "\n";
const short = t => (t.length > 50 ? t.slice(0, 50) + "…" : t);

export function createFeedback({ storage, client, newId, onChange = () => {}, now = () => new Date().toISOString() }) {
  const st = storage.get("shumi.feedback") ?? { items: {}, seen: {} };
  let running = null, failed = false;
  const save = () => { storage.set("shumi.feedback", st); onChange(); };

  async function push(id) {
    const it = st.items[id];
    if (it.deleted) {
      if (it.sha) {
        try { await client.files.remove(file(id), it.sha, `Замечание убрано: ${short(it.data.text)}`); }
        catch (e) {
          if (!(e instanceof Conflict)) throw e;
          const r = await client.files.read(file(id));
          if (r) await client.files.remove(file(id), r.sha, `Замечание убрано: ${short(it.data.text)}`);
        }
      }
      delete st.items[id];
      return;
    }
    try {
      const r = await client.files.write(file(id), toText(it.data), it.sha, `${it.sha ? "Замечание исправлено" : "Замечание"}: ${short(it.data.text)}`);
      Object.assign(it, { sha: r.sha, dirty: false });
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      // Пока она правила текст, разработчик ответил: остаются её текст и его ответ.
      const r = await client.files.read(file(id));
      const remote = r ? JSON.parse(r.text) : {};
      it.data = { ...it.data, reply: remote.reply ?? it.data.reply, status: remote.status ?? it.data.status };
      const w = await client.files.write(file(id), toText(it.data), r?.sha ?? null, `Замечание исправлено: ${short(it.data.text)}`);
      Object.assign(it, { sha: w.sha, dirty: false });
    }
  }

  async function run() {
    for (const id of Object.keys(st.items)) if (st.items[id].dirty || st.items[id].deleted) { await push(id); save(); }
    // Папка не изменилась с прошлого раза — 304 без тела: на мобильном это одна короткая проверка.
    const listed = await client.files.list("feedback", st.etag);
    if (!listed) { save(); return; }
    st.etag = listed.etag;
    const remote = listed.filter(f => f.name.endsWith(".json"));
    const ids = new Set();
    for (const f of remote) {
      const id = f.name.slice(0, -5), it = st.items[id];
      ids.add(id);
      if (it && (it.dirty || it.sha === f.sha)) continue;
      const r = await client.files.read(f.path);
      if (r) st.items[id] = { data: { ...newFeedback(id, "", ""), ...JSON.parse(r.text), id }, sha: r.sha, dirty: false, deleted: false };
    }
    // Нет на сервере и уже было отправлено — убрано с другого устройства или разработчиком.
    for (const [id, it] of Object.entries(st.items)) if (!ids.has(id) && it.sha && !it.dirty) delete st.items[id];
    save();
  }

  const live = () => Object.values(st.items).filter(i => !i.deleted);
  return {
    // Открытые сверху, внутри — новые сверху.
    list: () => live().map(i => ({ ...i.data, pending: i.dirty }))
      .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === "open" ? -1 : 1)),
    unseen: () => live().filter(i => i.data.reply && st.seen[i.data.id] !== i.data.reply).length,
    markSeen() {
      let changed = false;
      for (const i of live()) if (i.data.reply && st.seen[i.data.id] !== i.data.reply) { st.seen[i.data.id] = i.data.reply; changed = true; }
      if (changed) save();
    },
    failed: () => failed,
    add(text) {
      const f = newFeedback(newId(), now(), text.trim());
      st.items[f.id] = { data: f, sha: null, dirty: true, deleted: false };
      save();
      return this.sync();
    },
    edit(id, text) {
      const it = st.items[id];
      if (!it) return;
      Object.assign(it.data, { text: text.trim(), editedAt: now() });
      it.dirty = true;
      save();
      return this.sync();
    },
    remove(id) {
      if (!st.items[id]) return;
      st.items[id].deleted = true;
      save();
      return this.sync();
    },
    sync() {
      if (!running) running = run().then(() => { failed = false; }, () => { failed = true; }).finally(() => { running = null; onChange(); });
      return running;
    },
  };
}
