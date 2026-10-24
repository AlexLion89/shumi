// Хранилище полки — файл shelf.json в приватном репозитории через GitHub REST API (Contents).
// CORS у api.github.com открыт; с телефона Вики отвечает (замер 24.10.2026: 6 из 6, 0,2 с), в отличие
// от Cloudflare. Ключ — токен GitHub с доступом только к этому репозиторию (Contents: чтение и запись).
import { emptyShelf, parse } from "./shelf.js";

export const REPO = "AlexLion89/shumi-data";
export const PATH = "shelf.json";

export class AuthError extends Error {}   // ключ не подходит или у него нет доступа — повтор не поможет
export class Conflict extends Error {}    // файл успели поменять с другого устройства — перечитать и наложить

const toB64 = s => { let bin = ""; for (const x of new TextEncoder().encode(s)) bin += String.fromCharCode(x); return btoa(bin); };
const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), c => c.charCodeAt(0)));

// Ключ, вставленный из мессенджера или заметок, бывает с пробелами, кавычками, переводом строки и BOM.
export const cleanKey = s => String(s ?? "").replace(/[﻿\s"'«»`]/g, "");

// path — другой файл в том же репозитории: проверка tools/e2e-github.mjs пишет во временный, не трогая полку.
export function github({ token, base = "https://api.github.com", path = PATH, fetch: f = (...a) => fetch(...a), timeout = 15000 }) {
  async function call(url, opts = {}) {
    // Не-латиница в заголовке роняет fetch раньше GitHub, и вышло бы «нет связи» вместо «ключ не подходит».
    if (!/^[!-~]+$/.test(token)) throw new AuthError("в ключе лишние символы");
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
  const file = `/repos/${REPO}/contents/${path}`;

  return {
    // Проверка ключа при входе: приватный репозиторий без доступа GitHub показывает как 404.
    async check() {
      const r = await call(`/repos/${REPO}`);
      if (r.status === 404) throw new AuthError("ключ не видит репозиторий полки");
      if (!r.ok) throw new Error("GitHub ответил " + r.status);
      const d = await r.json();
      if (!d.permissions?.push) throw new AuthError("у ключа нет права записи");
    },
    async get() {
      const r = await call(`${file}?ref=main`);
      if (r.status === 404) return { shelf: emptyShelf(), sha: null };
      if (!r.ok) throw new Error("GitHub ответил " + r.status);
      const d = await r.json();
      return { shelf: parse(fromB64(d.content)), sha: d.sha };
    },
    async put(text, sha, message) {
      const r = await call(file, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: toB64(text), branch: "main", ...(sha ? { sha } : {}) }),
      });
      if (r.status === 409 || r.status === 422) throw new Conflict("файл изменился");
      if (!r.ok) throw new Error("GitHub ответил " + r.status);
      return { sha: (await r.json()).content.sha };
    },
  };
}
