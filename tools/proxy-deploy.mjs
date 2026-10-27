// Выкладка посредника proxy/ в Yandex Cloud: функция shumi-proxy в каталоге shumi, публичный вызов.
// Нужен yc с профилем shumi (сервисный аккаунт shumi-deploy, ключ ~/.shumi-yc-key.json, роль editor только на каталог shumi).
//
//   node tools/proxy-deploy.mjs
//
// Не больше двух экземпляров и четырёх запросов одновременно в зоне — потолок по деньгам, если адрес начнут долбить.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const YC = process.env.YC ?? join(homedir(), "yandex-cloud", "bin", process.platform === "win32" ? "yc.exe" : "yc");
const NAME = "shumi-proxy";
const yc = (...args) => execFileSync(YC, [...args, "--profile", "shumi", "--format", "json"], { encoding: "utf8" });
const src = fileURLToPath(new URL("../proxy/", import.meta.url));
if (!existsSync(join(src, "index.js"))) throw new Error("нет proxy/index.js");

let fn;
try { fn = JSON.parse(yc("serverless", "function", "get", "--name", NAME)); }
catch { fn = JSON.parse(yc("serverless", "function", "create", "--name", NAME, "--description", "Посредник поиска книжной полки: LitRes, Douban")); }
const v = JSON.parse(yc("serverless", "function", "version", "create", "--function-id", fn.id, "--runtime", "nodejs22",
  "--entrypoint", "index.handler", "--memory", "128m", "--execution-timeout", "10s", "--source-path", src, "--min-log-level", "info"));
yc("serverless", "function", "set-scaling-policy", "--id", fn.id, "--tag", "$latest", "--zone-instances-limit", "2", "--zone-requests-limit", "4");
// Открыть вызов всем может только роль functions.admin (editor права доступа не меняет).
yc("serverless", "function", "allow-unauthenticated-invoke", "--id", fn.id);

const url = `https://functions.yandexcloud.net/${fn.id}`;
const r = await fetch(`${url}?ping=1`);
console.log(`версия ${v.id} выложена: ${url}`);
console.log(`ping: ${r.status} ${await r.text()}`);
if (!r.ok) process.exit(1);
