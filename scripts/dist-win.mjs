// Builds Weft's Windows installer: `pnpm dist:win`, on Windows (the release's windows-latest job runs it).
// The same steps as dist:linux, in Node rather than one sh line, since a package.json script runs in cmd.exe there:
// the standalone Next build, prepare-standalone, the toolchain, the main process's package list, then
// electron-builder's NSIS target. Out come dist/Weft-Setup-X.Y.Z-<arch>.exe, its .blockmap and the feed
// electron/updater-win.cjs reads: latest.yml on x64, latest-arm64.yml on arm64. Unsigned (docs/architecture/windows.md).
// It builds this machine's arch only: the server's claude.exe, node-pty and the toolchain are native, so arm64 builds
// on an arm64 runner (windows-11-arm).
import { execSync } from "node:child_process";
import fs from "node:fs";

const env = { ...process.env, WEFT_DIST: ".next-dist", WEFT_STANDALONE: "1" };
const steps = [
  "pnpm exec next build",
  "node scripts/prepare-standalone.mjs .next-dist",
  "node scripts/bundle-toolchain.mjs",
  "node scripts/electron-runtime-deps.mjs --write",
  `pnpm exec electron-builder --win --${process.arch} --publish never`,
];
for (const step of steps) {
  console.log(`\n== ${step}`);
  execSync(step, { stdio: "inherit", env });
}
// electron-builder names the feed latest.yml for every arch; arm64's gets its own name so the two can share a release.
if (process.arch === "arm64") fs.renameSync("dist/latest.yml", "dist/latest-arm64.yml");
