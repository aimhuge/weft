// Verify the packaged app's bundled toolchain can actually install dependencies.
// The toolchain ships pnpm + npm so a fresh Mac with no Node can build projects
// (scripts/bundle-toolchain.mjs). This checks the shipped pnpm runs and can install.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const resources = path.resolve(process.argv[2]);
const pnpmCli = path.join(resources, "toolchain", "pnpm", "bin", "pnpm.cjs");
const wrapper = path.join(resources, "toolchain", "bin", "pnpm");

if (!fs.existsSync(pnpmCli)) {
  console.log(`MISS  ${pnpmCli}`);
  process.exit(1);
}
console.log(`ok    bundled pnpm at ${path.relative(process.cwd(), pnpmCli)}`);

// The version must match package.json's packageManager, or a project with a pinned
// pnpm will refuse to run ("This project is configured to use vX").
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
const pinned = String(pkg.packageManager || "").replace(/^pnpm@/, "");
const actual = execFileSync(process.execPath, [pnpmCli, "--version"], { encoding: "utf8" }).trim();
console.log(`${actual === pinned ? "ok   " : "BAD  "} pnpm ${actual} (package.json pins ${pinned})`);

// The wrapper is what threads actually call, via PATH.
if (fs.existsSync(wrapper)) {
  const body = fs.readFileSync(wrapper, "utf8");
  const ok = body.includes("pnpm.cjs");
  console.log(`${ok ? "ok   " : "BAD  "} bin/pnpm wrapper points at the bundled pnpm`);
}

// It must be able to install: a real install, offline, of a package already in the
// store is not a fair test, so install a tiny package from the registry.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-toolchain-"));
fs.writeFileSync(
  path.join(dir, "package.json"),
  JSON.stringify({ name: "toolchain-check", version: "1.0.0", private: true, dependencies: { "is-odd": "3.0.1" } }, null, 2),
);
try {
  const out = execFileSync(process.execPath, [pnpmCli, "install", "--ignore-scripts", "--reporter=silent"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const installed = fs.existsSync(path.join(dir, "node_modules", "is-odd", "package.json"));
  console.log(`${installed ? "ok   " : "BAD  "} pnpm install fetched a dependency into node_modules`);
  if (!installed) console.log(out);
} catch (e) {
  console.log(`BAD   pnpm install failed: ${e.message}`);
  process.exit(1);
}
