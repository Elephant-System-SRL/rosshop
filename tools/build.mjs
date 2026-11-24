import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationFiles } from "./sqlite-d1.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = join(root, "server");
const output = join(root, "dist");
const workerPath = join(output, "server", "index.js");
const hostingPath = join(root, ".openai", "hosting.json");
const assetRoot = join(root, "public");

function assetContents(directory, current = "") {
  const assets = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const location = join(directory, entry.name);
    const key = `${current}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(assets, assetContents(location, key));
    } else if (entry.isFile()) {
      assets[key] = readFileSync(location).toString("base64");
    } else {
      throw new Error(`Unsupported public asset ${key}.`);
    }
  }
  return assets;
}

function bindings(text) {
  return text.split(",").map(name => name.trim()).filter(Boolean).map(name => {
    const parsed = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(name);
    if (!parsed) throw new Error(`Unsupported module binding ${name}.`);
    return [parsed[1], parsed[2] ?? parsed[1]];
  });
}

function moduleIdentifier(filename) {
  const id = relative(sourceDirectory, filename);
  if (id === ".." || id.startsWith(`..${sep}`) || isAbsolute(id) || !id.endsWith(".mjs")) {
    throw new Error("Worker imports must refer to local server/*.mjs files.");
  }
  return id.split(sep).join("/");
}

function bundleWorker(entrypoint, assets) {
  const compiled = new Map();
  const compiling = new Set();

  function compile(filename) {
    const id = moduleIdentifier(filename);
    if (compiled.has(id)) return;
    if (compiling.has(id)) throw new Error(`Worker module dependency cycle at ${id}.`);
    if (!lstatSync(filename).isFile()) throw new Error(`Worker source ${id} must be a regular file.`);
    compiling.add(id);
    const names = [];
    let code = readFileSync(filename, "utf8");
    code = code.replace(
      /^[ \t]*import\s+\{([^}]*)\}\s+from\s+(["'])([^"'\r\n]+)\2;?[ \t]*$/gm,
      (_, imported, _quote, specifier) => {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          throw new Error(`Worker import ${specifier} in ${id} must be relative.`);
        }
        const dependency = resolve(dirname(filename), specifier);
        compile(dependency);
        const mapped = bindings(imported)
          .map(([source, local]) => source === local ? source : `${source}: ${local}`);
        return `const { ${mapped.join(", ")} } = storeModules[${JSON.stringify(moduleIdentifier(dependency))}];`;
      },
    );
    code = code.replace(
      /^([ \t]*)export\s+((?:async\s+)?function|class|const|let|var)\s+([\w$]+)/gm,
      (_, indent, declaration, name) => {
        names.push([name, name]);
        return `${indent}${declaration} ${name}`;
      },
    );
    code = code.replace(/^[ \t]*export\s+\{([^}]*)\};?[ \t]*$/gm, (_, exported) => {
      for (const [local, external] of bindings(exported)) names.push([external, local]);
      return "";
    });
    if (/^[ \t]*(?:import|export)\b(?!\s*[.(])/m.test(code)) {
      throw new Error(`Unsupported module syntax in ${id}. Use static named imports and named exports.`);
    }
    const exports = names.map(([external, local]) => `${JSON.stringify(external)}: ${local}`).join(", ");
    compiled.set(id, `{\n${code}\nstoreModules[${JSON.stringify(id)}] = { ${exports} };\n}`);
    compiling.delete(id);
  }

  compile(entrypoint);
  return [
    "// Generated from the RouterOS storefront server and public files.",
    "const storeModules = Object.create(null);",
    ...compiled.values(),
    `const storeAssets = ${JSON.stringify(assets)};`,
    "function readBundledAsset(path) {",
    "  if (!Object.hasOwn(storeAssets, path)) return null;",
    "  const binary = atob(storeAssets[path]);",
    "  const bytes = new Uint8Array(binary.length);",
    "  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);",
    "  return bytes;",
    "}",
    `export default storeModules[${JSON.stringify(moduleIdentifier(entrypoint))}].createWorker(readBundledAsset);`,
    "",
  ].join("\n");
}

function writeHostingFiles(migrations) {
  const config = JSON.parse(readFileSync(hostingPath, "utf8"));
  if (!config || config.d1 !== "DB" || config.static != null) {
    throw new Error('The Worker hosting manifest must declare "d1": "DB" and omit static hosting.');
  }
  const metadata = join(output, ".openai");
  const drizzle = join(metadata, "drizzle");
  mkdirSync(join(drizzle, "meta"), { recursive: true });
  writeFileSync(join(metadata, "hosting.json"), `${JSON.stringify(config, null, 2)}\n`);
  const entries = migrations.map((file, idx) => {
    const sql = readFileSync(file, "utf8");
    const name = basename(file);
    writeFileSync(join(drizzle, name), sql);
    return {
      idx,
      version: "6",
      when: 1_795_536_000_000 + Number.parseInt(name, 10),
      tag: basename(file, ".sql"),
      breakpoints: true,
    };
  });
  const journal = { version: "7", dialect: "sqlite", entries };
  writeFileSync(join(drizzle, "meta", "_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
}

const migrations = migrationFiles(join(root, "migrations"));
if (!migrations.length) throw new Error("Add the store's SQL migrations before building.");
const assets = assetContents(assetRoot);
if (!Object.hasOwn(assets, "/index.html")) throw new Error("The store homepage public/index.html is missing.");
const worker = bundleWorker(join(sourceDirectory, "index.mjs"), assets);
mkdirSync(dirname(workerPath), { recursive: true });
writeFileSync(workerPath, worker);
execFileSync(process.execPath, ["--check", workerPath], { stdio: "inherit" });
writeHostingFiles(migrations);
// cPanel may run the start command from the repository or from its output directory.
copyFileSync(join(sourceDirectory, "node.mjs"), join(output, "app.js"));
mkdirSync(join(output, "tools"), { recursive: true });
copyFileSync(join(root, "tools", "sqlite-d1.mjs"), join(output, "tools", "sqlite-d1.mjs"));
mkdirSync(join(output, "migrations"), { recursive: true });
for (const file of migrations) copyFileSync(file, join(output, "migrations", basename(file)));
writeFileSync(join(output, "package.json"), JSON.stringify({
  name: "educat-it-routeros-store", private: true, type: "module", scripts: { start: "node app.js" }
}) + "\n");
console.log(`Built dist/server/index.js with ${Object.keys(assets).length} assets and ${migrations.length} migration(s).`);
