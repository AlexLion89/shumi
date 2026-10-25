// Офлайн и мгновенный запуск. Оболочка приложения — из кеша своей версии: новая версия при выкладке скачивается
// целиком и включается по кнопке «Обновить» или при следующем открытии, так что файлы разных версий не смешиваются. Обложки — из кеша
// навсегда. Запросы к GitHub API и каталогам не трогаем: данные ведёт sync.js, поиск всегда живой.
const VERSION = "__VERSION__";   // при выкладке сюда подставляется коммит (.github/workflows/deploy.yml)
const SHELL = "shell-" + VERSION, COVERS = "covers-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "feedback.js", "github.js", "rank.js", "seal.js", "shelf.js", "sources.js", "sync.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon-32.png"];

// Новая версия не включается сама: ждёт, пока в приложении нажмут «Обновить» (сообщение skip-waiting).
self.addEventListener("install", e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))));
self.addEventListener("message", e => { if (e.data === "skip-waiting") self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin === location.origin) {
    e.respondWith(caches.match(req, { cacheName: SHELL, ignoreSearch: true }).then(hit => hit || fetch(req)));
  } else if (req.destination === "image") {
    // Обложки с FantLab без CORS приходят «непрозрачными» — кешируем как есть; не влезло в квоту — не страшно.
    e.respondWith(caches.open(COVERS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") c.put(req, r.clone()).catch(() => {});
      return r;
    }));
  }
});
