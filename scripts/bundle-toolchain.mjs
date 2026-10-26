// Stages the tools Weft.app ships in Contents/Resources/toolchain, so a fresh Mac with no Node, pnpm,
// Claude Code or puku can still build Next.js + Supabase projects (docs/architecture/updates.md, "Toolchain"),
// and threads can reach Google Workspace through gog (docs/architecture/connectors.md).
// Run before electron-builder (npm run dist does):
//   node scripts/bundle-toolchain.mjs [outDir]   (default: .toolchain-dist)
// Layout:
//   bin/    node npm npx pnpm pnpx puku-cli claude gog: wrappers that electron/main.cjs appends to the END of PATH,
//           so a Mac's own node, pnpm or CLIs always win and these fill in only what's missing
//   npm/    npm, pnpm/  pnpm (pinned, from the registry)
//   puku/   @puku/puku-cli and its production deps, pruned (see prunePuku)
//   gog/    gog, the Google Workspace CLI (steipete/gogcli), one Go binary from its GitHub release, checksum-pinned
// Every wrapper runs on Weft's own Electron as Node (ELECTRON_RUN_AS_NODE), through Weft Helper so macOS
// shows no second Dock icon, the same way electron/server.cjs runs the Next server.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const NPM_VERSION = "11.11.0";
export const PNPM_VERSION = "10.33.0";
export const PUKU_VERSION = "1.8.56";
export const GOG_VERSION = "0.47.0";
// sha256 of each gogcli_<version>_<os>_<arch>.tar.gz, from the release's checksums.txt. Bump with GOG_VERSION.
const GOG_SHA256 = {
  darwin_arm64: "ee0826a457f3d440e5272e4135a2bfd98a6c79e8734f5789055f6f09523120af",
  darwin_amd64: "2670eb51d116b217f879889b16288867d1894d7128b8d3e5c3087b81424ea28d",
  linux_arm64: "90d236ab91c6dae7139bfe0508eab94a8b4323238b62fa29e6cf479a352576f2",
  linux_amd64: "c3ed94efca90c754cdda300e3c7f8cc2f3d7df86d3fdc5d11f996c7518a09c24",
};

const ROOT = path.resolve(import.meta.dirname, "..");
const out = path.resolve(ROOT, process.argv[2] || ".toolchain-dist");
const bin = path.join(out, "bin");

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

// npm pack <spec> → <out>/<dir>, the package's own folder (npm ships its deps inside; pnpm is one bundled file).
function unpack(spec, dir) {
  const target = path.join(out, dir);
  fs.mkdirSync(target, { recursive: true });
  const tarball = execFileSync("npm", ["pack", spec, "--silent", "--pack-destination", out], { encoding: "utf8" }).trim().split("\n").pop();
  run("tar", ["-xzf", path.join(out, tarball), "-C", target, "--strip-components=1"]);
  fs.rmSync(path.join(out, tarball));
  console.log(`Unpacked ${spec} into ${path.relative(ROOT, target)}`);
}

function installPuku() {
  const app = path.join(out, "puku");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ private: true }) + "\n");
  console.log(`Installing @puku/puku-cli@${PUKU_VERSION} into ${path.relative(ROOT, app)}`);
  run("npm", ["install", `@puku/puku-cli@${PUKU_VERSION}`, "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], app);
  if (!fs.existsSync(path.join(app, "node_modules", "@puku", "puku-cli", "bin", "puku-cli"))) {
    throw new Error("puku-cli's bin is missing after npm install");
  }
  prunePuku(path.join(app, "node_modules"));
}

// gog is a single Go binary: download this platform's tarball, refuse it unless its sha256 matches the pin, unpack gog.
async function installGog() {
  const platform = `${process.platform}_${process.arch === "x64" ? "amd64" : process.arch}`;
  const expected = GOG_SHA256[platform];
  if (!expected) throw new Error(`No pinned gog build for ${platform}`);
  const name = `gogcli_${GOG_VERSION}_${platform}.tar.gz`;
  const res = await fetch(`https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/${name}`);
  if (!res.ok) throw new Error(`Downloading ${name} failed: HTTP ${res.status}`);
  const tarball = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(tarball).digest("hex");
  if (actual !== expected) throw new Error(`${name} has sha256 ${actual}, expected ${expected}`);
  const dir = path.join(out, "gog");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(out, name), tarball);
  run("tar", ["-xzf", path.join(out, name), "-C", dir, "gog"]);
  fs.rmSync(path.join(out, name));
  console.log(`Unpacked gog ${GOG_VERSION} (${platform}) into ${path.relative(ROOT, dir)}`);
}

// What this Mac never loads:
// - ripgrep and sharp builds for other platforms;
// - better-sqlite3: puku uses the built-in node:sqlite, and the prebuilt binding is for Node's ABI, not Electron's;
// - telemetry: the OpenTelemetry exporters load only through import() when telemetry is on, and @sentry/node
//   (static imports; it pulls in most of @opentelemetry) gets a no-op stand-in. Sentry.init() returns undefined,
//   so puku sees error reporting as off. Together ~230 MB.
function prunePuku(nodeModules) {
  const pruned = [];
  const prune = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
    pruned.push(dir);
  };
  const ripgrep = path.join(nodeModules, "@puku", "puku-cli", "dist", "vendor", "ripgrep");
  for (const name of fs.existsSync(ripgrep) ? fs.readdirSync(ripgrep) : []) {
    if (name !== `${process.arch}-${process.platform}`) prune(path.join(ripgrep, name));
  }
  const img = path.join(nodeModules, "@img");
  for (const name of fs.existsSync(img) ? fs.readdirSync(img) : []) {
    if (name.startsWith("sharp-") && !name.includes(`${process.platform}-${process.arch}`)) prune(path.join(img, name));
  }
  for (const name of ["better-sqlite3", "@opentelemetry", "@sentry", "@sentry-internal", "@prisma", "require-in-the-middle", "import-in-the-middle"]) {
    prune(path.join(nodeModules, name));
  }
  writeSentryStub(path.join(nodeModules, "@sentry", "node"));
  console.log(`Pruned ${pruned.length} folders from puku (other platforms, unused native builds, telemetry)`);
}

function writeSentryStub(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@sentry/node", version: "0.0.0-weft-stub", main: "index.cjs", exports: { import: "./index.mjs", require: "./index.cjs" } }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "index.cjs"),
    `// No-op @sentry/node, written by Weft's scripts/bundle-toolchain.mjs: Weft.app ships puku without telemetry.
const span = new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : () => span) });
const done = () => Promise.resolve(true);
const noop = () => {};
module.exports = {
  init: noop, addBreadcrumb: noop, captureException: noop, captureMessage: noop, setUser: noop, setTag: noop,
  setContext: noop, flush: done, close: done, startSpan: (_options, callback) => callback(span),
  startInactiveSpan: () => span, getActiveSpan: () => undefined,
};
`,
  );
  fs.writeFileSync(
    path.join(dir, "index.mjs"),
    `import stub from "./index.cjs";\nexport const { init, addBreadcrumb, captureException, captureMessage, setUser, setTag, setContext, flush, close, startSpan, startInactiveSpan, getActiveSpan } = stub;\nexport default stub;\n`,
  );
}

// bin/<name>: CONTENTS is Weft.app/Contents on a Mac, the unpacked app folder on Linux
// (bin → toolchain → Resources or resources → CONTENTS).
const PRELUDE = `#!/bin/sh
# Written by Weft's scripts/bundle-toolchain.mjs.
TOOLCHAIN="$(cd "$(dirname "$0")/.." && pwd)"
CONTENTS="$(cd "$TOOLCHAIN/../.." && pwd)"
`;
const mac = process.platform === "darwin";
const RESOURCES = mac ? "Resources" : "resources";
const NODE = mac
  ? `NODE="$CONTENTS/Frameworks/Weft Helper.app/Contents/MacOS/Weft Helper"
[ -x "$NODE" ] || NODE="$CONTENTS/MacOS/Weft"
`
  : `NODE="$CONTENTS/weft"
`;
function writeWrapper(name, body) {
  fs.writeFileSync(path.join(bin, name), PRELUDE + body, { mode: 0o755 });
}
function writeWrappers() {
  fs.mkdirSync(bin, { recursive: true });
  const onNode = (script) => `${NODE}ELECTRON_RUN_AS_NODE=1 exec "$NODE" ${script} "$@"\n`;
  writeWrapper("node", onNode(""));
  writeWrapper("npm", onNode(`"$TOOLCHAIN/npm/bin/npm-cli.js"`));
  writeWrapper("npx", onNode(`"$TOOLCHAIN/npm/bin/npx-cli.js"`));
  writeWrapper("pnpm", onNode(`"$TOOLCHAIN/pnpm/bin/pnpm.cjs"`));
  writeWrapper("pnpx", onNode(`"$TOOLCHAIN/pnpm/bin/pnpm.cjs" dlx`));
  writeWrapper("puku-cli", onNode(`"$TOOLCHAIN/puku/node_modules/@puku/puku-cli/bin/puku-cli"`));
  // The Agent SDK's own Claude Code binary, which the Next server already ships for threads.
  writeWrapper("claude", `exec "$CONTENTS/${RESOURCES}/server/node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude" "$@"\n`);
  writeWrapper("gog", `exec "$TOOLCHAIN/gog/gog" "$@"\n`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
unpack(`npm@${NPM_VERSION}`, "npm");
unpack(`pnpm@${PNPM_VERSION}`, "pnpm");
installPuku();
await installGog();
writeWrappers();
const size = execFileSync("du", ["-sh", out], { encoding: "utf8" }).split("\t")[0];
console.log(`Toolchain ready: ${path.relative(ROOT, out)} (${size}): ${fs.readdirSync(bin).join(", ")}`);
