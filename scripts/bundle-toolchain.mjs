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
//   whisper/  (Windows) whisper.cpp's whisper-cli and whisper-server for dictation, checksum-pinned
// Every wrapper runs on Weft's own Electron as Node (ELECTRON_RUN_AS_NODE), through Weft Helper so macOS
// shows no second Dock icon, the same way electron/server.cjs runs the Next server. On Windows the wrappers are
// .cmd files running Weft.exe (scripts/toolchain-wrappers.mjs).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dirSize } from "./dir-size.mjs";
import { toolchainWrappers } from "./toolchain-wrappers.mjs";

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
  windows_amd64: "fa2ae5363a2417c576a6a2264ef6cfb9dabb5f732a8377629a4d5cf9f19226e3",
  windows_arm64: "d2a00ae26f2ff3a5797a31f8532c80d27213995ee864c305ca3e289103f09455",
};
// whisper.cpp for dictation on Windows (a Mac gets it from Homebrew): the official CPU build per arch, from a release
// that carries binaries (the vX.Y.Z tags lately carry none), checksum-pinned like gog. Bump with WHISPER_TAG.
export const WHISPER_TAG = "b5454";
const WHISPER_ZIP = {
  x64: { name: "whisper-bin-x64.zip", sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb" },
  arm64: { name: "whisper-bin-win-cpu-arm64.zip", sha256: "28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d" },
};
const WINDOWS = process.platform === "win32";
// Windows' own bsdtar unpacks .tar.gz and .zip alike; a GNU tar earlier on PATH (Git's) reads "C:\…" as a remote host.
const TAR = WINDOWS ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";

const ROOT = path.resolve(import.meta.dirname, "..");
const out = path.resolve(ROOT, process.argv[2] || ".toolchain-dist");
const bin = path.join(out, "bin");

// npm is npm.cmd on Windows, which only a shell runs; every argument here is Weft's own.
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"], shell: WINDOWS && command === "npm" });
}

// npm pack <spec> → <out>/<dir>, the package's own folder (npm ships its deps inside; pnpm is one bundled file).
function unpack(spec, dir) {
  const target = path.join(out, dir);
  fs.mkdirSync(target, { recursive: true });
  const pack = ["pack", spec, "--silent", "--pack-destination", WINDOWS ? `"${out}"` : out];
  const tarball = execFileSync("npm", pack, { encoding: "utf8", shell: WINDOWS }).trim().split(/\r?\n/).pop();
  run(TAR, ["-xzf", path.join(out, tarball), "-C", target, "--strip-components=1"]);
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
  const platform = `${WINDOWS ? "windows" : process.platform}_${process.arch === "x64" ? "amd64" : process.arch}`;
  const expected = GOG_SHA256[platform];
  if (!expected) throw new Error(`No pinned gog build for ${platform}`);
  const name = `gogcli_${GOG_VERSION}_${platform}.${WINDOWS ? "zip" : "tar.gz"}`;
  const res = await fetch(`https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/${name}`);
  if (!res.ok) throw new Error(`Downloading ${name} failed: HTTP ${res.status}`);
  const tarball = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(tarball).digest("hex");
  if (actual !== expected) throw new Error(`${name} has sha256 ${actual}, expected ${expected}`);
  const dir = path.join(out, "gog");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(out, name), tarball);
  run(TAR, ["-xf", path.join(out, name), "-C", dir, WINDOWS ? "gog.exe" : "gog"]);
  fs.rmSync(path.join(out, name));
  console.log(`Unpacked gog ${GOG_VERSION} (${platform}) into ${path.relative(ROOT, dir)}`);
}

// whisper/: whisper-cli.exe and whisper-server.exe with their DLLs (ggml, whisper, OpenMP on arm64), nothing else the
// zip carries (benchmarks, tests, the llama and parakeet tools). electron/main.cjs puts the folder at the end of PATH.
async function installWhisper() {
  const zip = WHISPER_ZIP[process.arch];
  if (!zip) throw new Error(`No pinned whisper.cpp build for win32-${process.arch}`);
  const res = await fetch(`https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/${zip.name}`);
  if (!res.ok) throw new Error(`Downloading ${zip.name} failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== zip.sha256) throw new Error(`${zip.name} has sha256 ${actual}, expected ${zip.sha256}`);
  const staging = path.join(out, "whisper-zip");
  const dir = path.join(out, "whisper");
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(out, zip.name), bytes);
  run(TAR, ["-xf", path.join(out, zip.name), "-C", staging]);
  const release = path.join(staging, "Release");
  const keep = (name) => ["whisper-cli.exe", "whisper-server.exe"].includes(name) || (/\.dll$/i.test(name) && !/^(llama|parakeet|SDL2)/i.test(name));
  for (const name of fs.readdirSync(release).filter(keep)) fs.copyFileSync(path.join(release, name), path.join(dir, name));
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(path.join(out, zip.name));
  console.log(`Unpacked whisper.cpp ${WHISPER_TAG} (${process.arch}) into ${path.relative(ROOT, dir)}: ${fs.readdirSync(dir).join(", ")}`);
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

function writeWrappers() {
  fs.mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(toolchainWrappers(process.platform, process.arch))) {
    fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
unpack(`npm@${NPM_VERSION}`, "npm");
unpack(`pnpm@${PNPM_VERSION}`, "pnpm");
installPuku();
await installGog();
if (WINDOWS) await installWhisper();
writeWrappers();
console.log(`Toolchain ready: ${path.relative(ROOT, out)} (${dirSize(out)}): ${fs.readdirSync(bin).join(", ")}`);
