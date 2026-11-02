// Proves the Weft Worker's engine loads the way the daemon loads it. lib/worker-update.ts trusts a new commit only once
// the worker CLI's `check` loads it (through jiti, as install/worker.sh runs the CLI), so a commit that can't load never
// reaches a worker: it just sits there un-updated. CI runs this on every PR (.github/workflows/ci.yml), so a change
// that breaks worker startup fails there first.
//
// It doesn't run the CLI. It writes a mirror of it beside it: the CLI's own import block and its loadEngine(), copied
// verbatim from scripts/weft-worker.ts, then calls loadEngine(). jiti loads the mirror as jiti-cli.mjs loads the CLI
// (createJiti on the working directory, no options, jiti.import), so the modules load in the same order, through the
// same transform and the same module resolution (jiti's async import takes package.json's "import" condition).
//
//   node scripts/check-worker-engine.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(root, "scripts", "weft-worker.ts");

// A top-level function's text, from its declaration to the closing brace at column 0.
function topFunction(source, name) {
  const start = source.search(new RegExp(`^async function ${name}[(<]`, "m"));
  const end = source.indexOf("\n}\n", start);
  return start < 0 || end < 0 ? undefined : source.slice(start, end + 3);
}

// The mirror's source: the CLI's top-of-file imports, its loadEngine() and the inTurn() it loads with, then a call.
export function engineMirror(source) {
  const imports = source.match(/^import [\s\S]*?;$/gm) ?? [];
  const loadEngine = topFunction(source, "loadEngine");
  if (!loadEngine) throw new Error("Couldn't find loadEngine() in the worker CLI.");
  const modules = (loadEngine.match(/import\("\.\.\/lib\/[^"]+"\)/g) ?? []).length;
  if (!modules) throw new Error("loadEngine() in the worker CLI imports no modules.");
  const helpers = /\binTurn\(/.test(loadEngine) ? [topFunction(source, "inTurn") ?? ""] : [];
  return { modules, text: `${imports.join("\n")}\n\n${[loadEngine, ...helpers].join("\n")}\nexport const loaded = loadEngine();\n` };
}

async function main() {
  const { modules, text } = engineMirror(fs.readFileSync(CLI, "utf8"));
  // The CLI sets these before the engine loads; a throwaway store keeps the check off any real one.
  process.env.WEFT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-engine-check-"));
  process.env.WEFT_WORKER = "1";
  const mirror = path.join(root, "scripts", `.engine-check-${process.pid}.ts`);
  fs.writeFileSync(mirror, text);
  try {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(process.cwd());
    const { loaded } = await jiti.import(mirror);
    await loaded;
  } finally {
    fs.rmSync(mirror, { force: true });
    fs.rmSync(process.env.WEFT_DATA, { recursive: true, force: true });
  }
  console.log(`The worker engine loads (${modules} engine modules).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(root);
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err?.stack ?? err);
      process.exit(1);
    },
  );
}
