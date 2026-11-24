import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import worker from "./server/index.js";
import { createLocalD1 } from "./tools/sqlite-d1.mjs";

const origin = new URL(process.env.APP_ORIGIN || "https://educatit.ro");
if (origin.protocol !== "https:" || origin.href !== origin.origin + "/") {
  throw new Error("APP_ORIGIN must be an HTTPS origin.");
}
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");
const dataDir = process.env.STORE_DATA_DIR || join(homedir(), ".local", "share", "rosshop");
if (!isAbsolute(dataDir)) throw new Error("STORE_DATA_DIR must be absolute.");
process.umask(0o077);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
const db = createLocalD1(join(dataDir, "store.sqlite"), migrations);
const env = { ...process.env, DB: db, APP_ORIGIN: origin.origin, TRUST_SITES_IDENTITY: "false",
  STRIPE_MODE: process.env.STRIPE_MODE || "test", DEMO_MODE: process.env.DEMO_MODE || "true" };
const tasks = new Set();
const context = {
  waitUntil(promise) {
    const task = Promise.resolve(promise).catch(() => console.error("Store background task failed."));
    tasks.add(task);
    task.finally(() => tasks.delete(task));
  }
};

const server = createServer({ requestTimeout: 30000 }, async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (!incoming.url.startsWith("/") || url.origin !== origin.origin) {
      outgoing.writeHead(400).end("Invalid URL");
      return;
    }
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const init = { method: incoming.method, headers: incoming.headers };
    if (hasBody) Object.assign(init, { body: Readable.toWeb(incoming), duplex: "half" });
    const response = await worker.fetch(new Request(url, init), env, context);
    for (const [name, value] of response.headers) {
      if (name !== "set-cookie") outgoing.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie", cookies);
    outgoing.writeHead(response.status);
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch (error) {
    console.error("Store HTTP request failed.", error.name);
    if (outgoing.headersSent) outgoing.destroy();
    else outgoing.writeHead(500).end("Internal server error");
  }
});
server.listen(port, "0.0.0.0", () => console.log("RouterOS store listening on port", port));
const shutdown = () => server.close(async () => {
  await Promise.allSettled(tasks);
  db.close();
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, shutdown);
