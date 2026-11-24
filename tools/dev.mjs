import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorker } from "../server/index.mjs";
import { createLocalD1 } from "./sqlite-d1.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const localDirectory = join(root, ".local");
const knownHosts = new Set(["127.0.0.1", "localhost"]);

async function localSecret(providedSecret) {
  if (providedSecret) return providedSecret;
  const file = join(localDirectory, "admin-bootstrap.txt");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  try {
    await writeFile(file, `${secret}\n`, { flag: "wx", mode: 0o600 });
    return secret;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return (await readFile(file, "utf8")).trim();
  }
}

function localUrl(incoming) {
  const origin = new URL(`http://${incoming.headers.host}`);
  if (!knownHosts.has(origin.hostname) || origin.username || origin.password) {
    throw new Error("Unsupported preview host.");
  }
  const url = new URL(incoming.url, origin);
  if (url.origin !== origin.origin) throw new Error("Unsupported preview origin.");
  return url;
}

async function respond(incoming, outgoing, worker, env, context) {
  try {
    const url = localUrl(incoming);
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
    });
    const response = await worker.fetch(request, env, context);
    for (const [header, value] of response.headers) {
      if (header !== "set-cookie") outgoing.setHeader(header, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
    outgoing.writeHead(response.status);
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body), outgoing);
    } else {
      outgoing.end();
    }
  } catch (error) {
    if (outgoing.headersSent) {
      outgoing.destroy();
      return;
    }
    outgoing.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("Invalid local preview request.");
    console.error("Preview request failed", error instanceof Error ? error.name : "UnknownError");
  }
}

export async function startPreview({
  port = 4173,
  databasePath,
  adminBootstrapSecret,
  demo = true,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid preview port.");
  const persistent = databasePath !== ":memory:";
  if (persistent) await mkdir(localDirectory, { recursive: true });
  const chosenDatabase = databasePath ?? join(localDirectory, "store-preview.sqlite");
  const secret = persistent
    ? await localSecret(adminBootstrapSecret)
    : adminBootstrapSecret ?? randomBytes(32).toString("base64url");
  const publicDirectory = await realpath(join(root, "public"));
  const database = createLocalD1(chosenDatabase, join(root, "migrations"));
  const pending = new Set();
  const context = {
    waitUntil(promise) {
      const task = Promise.resolve(promise);
      pending.add(task);
      task.catch(() => console.error("A preview background task failed.")).finally(() => pending.delete(task));
    },
  };
  const env = {
    DB: database,
    DEMO_MODE: String(demo),
    ADMIN_BOOTSTRAP_SECRET: secret,
  };
  const worker = createWorker(async path => {
    try {
      const file = await realpath(join(publicDirectory, path.slice(1)));
      const localPath = relative(publicDirectory, file);
      if (localPath === ".." || localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
        return null;
      }
      return await readFile(file);
    } catch (error) {
      if (["ENOENT", "EISDIR", "ENOTDIR"].includes(error.code)) return null;
      throw error;
    }
  }, { preview: true });
  const server = createServer({ requestTimeout: 30_000 }, (incoming, outgoing) => {
    void respond(incoming, outgoing, worker, env, context);
  });

  server.listen(port, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    port: server.address().port,
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await Promise.allSettled(pending);
      database.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portFlag = process.argv.indexOf("--port");
  const port = Number(portFlag === -1 ? process.env.ROUTEROS_PREVIEW_PORT ?? 4173 : process.argv[portFlag + 1]);
  const preview = await startPreview({
    port,
    adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET,
  });
  console.log(`RouterOS bookstore preview · ${preview.origin}`);
  if (!process.env.ADMIN_BOOTSTRAP_SECRET) {
    console.log("Preview admin bootstrap secret is stored in .local/admin-bootstrap.txt.");
  }
  const close = () => void preview.close().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, close);
}
