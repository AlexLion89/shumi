// Браузер для проверок без зависимостей: headless Edge/Chrome по протоколу отладки (CDP) через встроенный
// в Node 22 WebSocket. Экран как у iPhone, нажатия через JS, снимки экрана.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  process.env.BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ port = 9333, dark = false } = {}) {
  const { existsSync } = await import("node:fs");
  const exe = BROWSERS.find(p => existsSync(p));
  if (!exe) throw new Error("не найден Edge/Chrome; укажи BROWSER=<путь>");
  const profile = mkdtempSync(join(tmpdir(), "shumi-cdp-"));
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()).find(t => t.type === "page"); } catch { /* ещё стартует */ }
  }
  if (!target) { proc.kill(); throw new Error("браузер не поднялся"); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; setTimeout(() => fail(new Error("браузер не открыл соединение отладки")), 10000); });
  let id = 0;
  const waiting = new Map(), errors = [], handlers = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const { ok, fail } = waiting.get(d.id); waiting.delete(d.id); d.error ? fail(new Error(d.error.message)) : ok(d.result); }
    if (d.method && handlers.has(d.method)) handlers.get(d.method)(d.params);
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map(a => a.value ?? a.description).join(" "));
  };
  // Каждая команда браузеру — не дольше 60 с: зависший браузер не должен вешать проверку.
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const n = ++id;
    const t = setTimeout(() => { waiting.delete(n); fail(new Error(`браузер не ответил на ${method}`)); }, 60000);
    waiting.set(n, { ok: v => { clearTimeout(t); ok(v); }, fail: e => { clearTimeout(t); fail(e); } });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });

  const page = {
    errors,
    send,
    on: (method, fn) => handlers.set(method, fn),
    // Только чтение у GitHub API: всё, кроме GET, браузер отклоняет сам — что бы ни делало приложение
    // (страницы книг, синхронизация), в настоящий репозиторий ничего не запишется. Возвращает число отклонённых.
    async readOnlyGitHub() {
      let blocked = 0;
      page.on("Fetch.requestPaused", p => {
        const allow = ["GET", "HEAD", "OPTIONS"].includes(p.request.method);
        if (!allow) blocked++;
        send(allow ? "Fetch.continueRequest" : "Fetch.failRequest", allow ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      });
      await send("Fetch.enable", { patterns: [{ urlPattern: "https://api.github.com/*" }] });
      return () => blocked;
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) { await send("Page.navigate", { url }); await page.until("document.readyState === 'complete'"); },
    // Ждёт, пока выражение станет истинным (до 15 с).
    async until(expression, ms = 15000) {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
        try { if (await page.eval(expression)) return; } catch { /* страница ещё грузится */ }
      }
      throw new Error("не дождались: " + expression);
    },
    // Нажатие на элемент по селектору и тексту (если задан).
    async click(selector, text) {
      const ok = await page.eval(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find(e => ${JSON.stringify(text ?? "")} === "" || e.textContent.includes(${JSON.stringify(text ?? "")}));
        if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
      if (!ok) throw new Error(`нет элемента ${selector} «${text ?? ""}»`);
      await sleep(150);
    },
    async type(selector, value) {
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    },
    async shot(file, { full = false } = {}) {
      let clip;
      if (full) {
        const m = await send("Page.getLayoutMetrics");
        clip = { x: 0, y: 0, width: 390, height: Math.ceil(m.cssContentSize.height), scale: 1 };
      }
      const { data } = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      try { await send("Browser.close"); } catch { /* уже закрыт */ }
      try { ws.close(); } catch {}
      proc.kill();
      await sleep(500);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
  return page;
}
