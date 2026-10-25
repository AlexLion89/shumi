// Ссылка «итоги года для подруг»: итоги шифруются (AES-GCM, ключ 128 бит) и лежат в публичном репозитории
// AlexLion89/shumi-share, а ключ — только в самой ссылке, после «#»: эта часть адреса на сервер не уходит.
// Без ссылки файл не прочитать; отозвать ссылку — удалить файл. Работает и в браузере, и в Node 22 (тесты).

const toB64url = bytes => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

export const newShareId = () => toB64url(crypto.getRandomValues(new Uint8Array(9)));   // 12 знаков
export const newShareKey = () => toB64url(crypto.getRandomValues(new Uint8Array(16)));

const aes = (key, use) => crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, [use]);

export async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(key, "encrypt"),
    new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, iv: toB64url(iv), data: toB64url(data) };
}

// Чужой ключ или испорченный файл — исключение (AES-GCM проверяет целостность).
export async function unseal(box, key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(box.iv) }, await aes(key, "decrypt"), fromB64url(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// Ссылка: https://shumi.sirenyov.link/y/#<id>.<key>
export const shareUrl = (base, id, key) => `${base}y/#${id}.${key}`;
export function parseShare(hash) {
  const m = /^#?([\w-]{8,})\.([\w-]{16,})$/.exec(hash ?? "");
  return m ? { id: m[1], key: m[2] } : null;
}
