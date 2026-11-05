// Finishes Next's standalone build so electron-builder can ship it as Weft.app/Contents/Resources/server.
// Run after `next build` with output: "standalone":
//   node scripts/prepare-standalone.mjs [distDir]   (default: $WEFT_DIST or .next-dist)
// 0. Removes project files that whole-project tracing copied in.
// 1. Copies <distDir>/static and public/ into the standalone folder (Next leaves them out).
// 2. Makes sure the Agent SDK and its native Claude Code binary are in standalone/node_modules
//    and the binary is executable (the SDK finds it with a runtime require.resolve, which tracing
//    can miss).
// 3. Checks that every symlink in the standalone folder points inside it, and prints its size.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEPS_FILE, writeDepsFile } from "./server-patch-deps.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const distDir = process.argv[2] || process.env.WEFT_DIST || ".next-dist";
const dist = path.join(ROOT, distDir);
const standalone = path.join(dist, "standalone");
const platformPkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;

function fail(message) {
  console.error(`prepare-standalone: ${message}`);
  process.exit(1);
}

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  fail(`${path.relative(ROOT, standalone)}/server.js is missing. Build with WEFT_STANDALONE=1 WEFT_DIST=${distDir} next build first.`);
}

// 0. lib/login.ts makes tracing copy the whole project folder (sources, docs, electron/, build/).
// The server needs none of it, so keep only what Next's standalone layout uses.
const KEEP = new Set(["server.js", "package.json", "node_modules", "public", distDir, DEPS_FILE]);
const pruned = [];
for (const name of fs.readdirSync(standalone)) {
  if (KEEP.has(name)) continue;
  fs.rmSync(path.join(standalone, name), { recursive: true, force: true });
  pruned.push(name);
}
if (pruned.length) console.log(`Pruned from standalone: ${pruned.join(", ")}`);

// 1. Static assets and public files.
copyDir(path.join(dist, "static"), path.join(standalone, distDir, "static"));
if (fs.existsSync(path.join(ROOT, "public"))) copyDir(path.join(ROOT, "public"), path.join(standalone, "public"));
console.log(`Copied ${distDir}/static and public/ into ${path.relative(ROOT, standalone)}`);

// 2. The Agent SDK and its native binary.
for (const pkg of ["@anthropic-ai/claude-agent-sdk", platformPkg]) {
  const target = path.join(standalone, "node_modules", pkg);
  const source = path.join(ROOT, "node_modules", pkg);
  const marker = pkg === platformPkg ? "claude" : "package.json";
  if (!fs.existsSync(path.join(target, marker))) {
    if (!fs.existsSync(source)) fail(`${pkg} isn't installed in node_modules. Run pnpm install.`);
    console.log(`Tracing missed ${pkg}; copying it in`);
    copyDir(source, target);
  }
}
const binary = path.join(standalone, "node_modules", platformPkg, "claude");
fs.chmodSync(binary, 0o755);
const sourceSize = fs.statSync(path.join(ROOT, "node_modules", platformPkg, "claude")).size;
if (fs.statSync(binary).size !== sourceSize) fail(`${binary} is incomplete (size differs from node_modules).`);
try {
  fs.accessSync(binary, fs.constants.X_OK);
} catch {
  fail(`${binary} isn't executable.`);
}
const version = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
console.log(`Native CLI OK: ${path.relative(ROOT, binary)} (${version})`);

// 3. Symlinks must stay inside the folder, or they break once it's copied into the app.
function checkLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(full);
      } catch {
        fail(`broken symlink ${path.relative(ROOT, full)}`);
      }
      if (!real.startsWith(standalone + path.sep)) {
        // Replace a link that points outside the bundle with a copy of what it points to.
        console.log(`Replacing outside symlink ${path.relative(standalone, full)} with a copy`);
        fs.rmSync(full);
        fs.cpSync(real, full, { recursive: true, dereference: true });
      }
    } else if (entry.isDirectory()) {
      checkLinks(full);
    }
  }
}
checkLinks(standalone);

// 4. The packages' fingerprint, which a server patch must match to run on this build (scripts/server-patch-deps.mjs).
const deps = writeDepsFile(standalone);
console.log(`Wrote ${DEPS_FILE}: ${deps.files} files, ${deps.hash.slice(0, 12)}`);

const size = execFileSync("du", ["-sh", standalone], { encoding: "utf8" }).split("\t")[0];
console.log(`Standalone server ready: ${path.relative(ROOT, standalone)} (${size})`);
