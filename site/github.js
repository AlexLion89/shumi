// Хранилище полки — приватный репозиторий через GitHub REST API (Contents): shelf.json — книги,
// feedback/<id>.json — замечания, covers/<id>.jpg — копии обложек (их кладёт ночное задание shumi-data).
// CORS у api.github.com открыт; с телефона Вики отвечает (замер 24.10.2026: 6 из 6, 0,2 с), в отличие
// от Cloudflare. Ключ — токен GitHub с доступом только к этому репозиторию (Contents: чтение и запись).
import { emptyShelf, parse } from "./shelf.js";

export const REPO = "AlexLion89/shumi-data";
export const PATH = "shelf.json";
export const SHARE_REPO = "AlexLion89/shumi-share";   // публичный, на GitHub Pages: зашифрованные итоги для ссылок

export class AuthError extends Error {}   // ключ не подходит или у него нет доступа — повтор не поможет
export class Conflict extends Error {}    // файл успели поменять с другого устройства — перечитать и наложить

// Текст — в UTF-8, байты (Uint8Array — фото обложки) — как есть.
const toB64 = s => { let bin = ""; for (const x of typeof s === "string" ? new TextEncoder().encode(s) : s) bin += String.fromCharCode(x); return btoa(bin); };
const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), c => c.charCodeAt(0)));

// Ключ, вставленный из мессенджера или заметок, бывает с пробелами, кавычками, переводом строки и BOM.
export const cleanKey = s => String(s ?? "").replace(/[\uFEFF\s"'«»`]/g, "");

// repo — другой репозиторий (ссылки на итоги — SHARE_REPO); path — другой файл полки: проверка tools/e2e-github.mjs
// пишет во временный.
export function github({ token, base = "https://api.github.com", repo = REPO, path = PATH, fetch: f = (...a) => fetch(...a), timeout = 15000 }) {
  async function call(url, opts = {}) {
    // Не-латиница в заголовке роняет fetch раньше GitHub, и вышло бы «нет связи» вместо «ключ не подходит».
    if (!/^[\x21-\x7e]+$/.test(token)) throw new AuthError("в ключе лишние символы");
    const c = new AbortController(), t = setTimeout(() => c.abort(), timeout);
    try {
      const r = await f(base + url, {
        ...opts, cache: "no-store", signal: c.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...opts.headers },
      });
      if (r.status === 401) throw new AuthError("ключ не подходит");
      if (r.status === 403) {
        const msg = (await r.json().catch(() => ({}))).message ?? "";
        if (/rate limit/i.test(msg)) throw new Error("GitHub просит подождать: " + msg);
        throw new AuthError("у ключа нет доступа к полке");
      }
      return r;
    } finally { clearTimeout(t); }
  }
  const at = p => `/repos/${repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}`;
  const fail = r => { throw new Error("GitHub ответил " + r.status); };

  // etag — версия, которая уже есть на телефоне: не изменилось — GitHub отвечает 304 без тела, и на мобильном
  // полка не скачивается заново при каждом открытии (304 к тому же не расходует лимит запросов).
  const cond = etag => (etag ? { headers: { "If-None-Match": etag } } : {});
  const files = {
    // Файл целиком: {text, sha, etag}; null — файла нет; {same: true} — не изменился с etag.
    async read(p, etag) {
      const r = await call(`${at(p)}?ref=main`, cond(etag));
      if (r.status === 304) return { same: true };
      if (r.status === 404) return null;
      if (!r.ok) fail(r);
      const d = await r.json();
      return { text: fromB64(d.content), sha: d.sha, etag: r.headers.get("ETag") };
    },
    // Записать: sha — версия, поверх которой пишем (null — новый файл). Чужая версия — Conflict.
    async write(p, text, sha, message) {
      const r = await call(at(p), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: toB64(text), branch: "main", ...(sha ? { sha } : {}) }),
      });
      if (r.status === 409 || r.status === 422) throw new Conflict("файл изменился");
      if (!r.ok) fail(r);
      return { sha: (await r.json()).content.sha };
    },
    // Записать, не зная версии: новый файл — сразу, существующий — поверх текущей версии (фото обложки).
    async save(p, content, message) {
      try { return await files.write(p, content, null, message); } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        const r = await call(`${at(p)}?ref=main`);
        if (!r.ok) fail(r);
        return files.write(p, content, (await r.json()).sha, message);
      }
    },
    async remove(p, sha, message) {
      const r = await call(at(p), {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sha, branch: "main" }),
      });
      if (r.status === 404) return;
      if (r.status === 409 || r.status === 422) throw new Conflict("файл изменился");
      if (!r.ok) fail(r);
    },
    // Файлы папки: [{name, path, sha}] (у массива — etag); нет папки — []; null — не изменилась с etag.
    async list(dir, etag) {
      const r = await call(`${at(dir)}?ref=main`, cond(etag));
      if (r.status === 304) return null;
      if (r.status === 404) return [];
      if (!r.ok) fail(r);
      const d = await r.json();
      const out = Array.isArray(d) ? d.filter(x => x.type === "file").map(({ name, path, sha }) => ({ name, path, sha })) : [];
      out.etag = r.headers.get("ETag");
      return out;
    },
    // Байты файла (обложки) — Blob или null. Для картинки сторис: обложки FantLab без CORS на canvas не нарисовать,
    // а копия из репозитория приходит с CORS.
    async blob(p) {
      const r = await call(`${at(p)}?ref=main`, { headers: { Accept: "application/vnd.github.raw" } });
      if (r.status === 404) return null;
      if (!r.ok) fail(r);
      return r.blob();
    },
  };

  return {
    files,
    // Проверка ключа при входе: приватный репозиторий без доступа GitHub показывает как 404.
    async check() {
      const r = await call(`/repos/${repo}`);
      if (r.status === 404) throw new AuthError(repo === REPO ? "ключ не видит репозиторий полки" : `ключ не видит ${repo}`);
      if (!r.ok) fail(r);
      const d = await r.json();
      if (!d.permissions?.push) throw new AuthError("у ключа нет права записи");
    },
    // etag — версия на телефоне; не изменилась — {same: true}.
    async get(etag) {
      const f = await files.read(path, etag);
      if (f?.same) return f;
      return f ? { shelf: parse(f.text), sha: f.sha, etag: f.etag } : { shelf: emptyShelf(), sha: null };
    },
    put: (text, sha, message) => files.write(path, text, sha, message),
  };
}
