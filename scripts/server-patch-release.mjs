// Ships a server patch: the board's UI and the Next.js server's own code, without a new version of the app.
//   node scripts/server-patch-release.mjs [--skip-build] [--publish] [--allow-dirty] [--notes "…"]
// Builds the standalone server (unless --skip-build), tars what changes between builds (server.js, the dist folder,
// public/, Weft's skills) without the packages, which it borrows from the installed app, and writes dist/patch/
// with the tarball and patch.json, signed with WEFT_PATCH_SIGNING_KEY. --publish uploads both to the rolling
// `patch-latest` GitHub release that installed apps poll (electron/patcher.cjs). Run it with the key through the
// vault: mcp__secrets__run("pnpm patch:release --publish", ["WEFT_PATCH_SIGNING_KEY"]).
// docs/architecture/updates.md#server-patches
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import feed from "../electron/server-patch-feed.cjs";
import { depsFingerprint } from "./server-patch-deps.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = ".next-dist";
const REPO = "aimhuge/weft";
export const TAG = "patch-latest";
// What a patch can't carry: Electron main lives in the signed app.asar, and the packages come from the app itself.
export const APP_ONLY = ["electron/", "pnpm-lock.yaml", "build/"];

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

// Why this tree can't ship as a patch on top of version's release, or [] when it can.
export function blockers({ version, tags, changedSinceTag, dirty }) {
  const out = [];
  if (!tags.includes(`v${version}`)) out.push(`no v${version} tag: release the app version first, then patch it`);
  else if (changedSinceTag.length) {
    out.push(`changed since v${version}, which only a full release ships:\n  ${changedSinceTag.join("\n  ")}`);
  }
  if (dirty.length) out.push(`uncommitted changes (commit first, or --allow-dirty to try a build):\n  ${dirty.slice(0, 10).join("\n  ")}`);
  return out;
}

export function assetFor(build) {
  return `weft-server-${build.replace(/[^\w.-]/g, "-")}.tar.gz`;
}

export function detailsFor({ version, commit, seq, deps, sha256, size, notes = "" }) {
  const build = `${version}+${commit}`;
  const url = `https://github.com/${REPO}/releases/download/${TAG}/${assetFor(build)}`;
  return { version, build, seq, deps, url, sha256, size, notes, commit };
}

function tarball(standalone, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const files = ["server.js", "package.json", "public", DIST].filter((f) => fs.existsSync(path.join(standalone, f)));
  // COPYFILE_DISABLE keeps macOS's ._ metadata files out of the tarball.
  const env = { ...process.env, COPYFILE_DISABLE: "1" };
  execFileSync("tar", ["-czf", out, "-C", standalone, ...files, "-C", ROOT, "plugin"], { env });
  const bytes = fs.readFileSync(out);
  return { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function publish(dir, asset) {
  const gh = (...args) => execFileSync("gh", args, { cwd: ROOT, encoding: "utf8" });
  try {
    gh("release", "view", TAG, "--repo", REPO);
  } catch {
    // A prerelease, so GitHub's "latest" (and the app's full-update feed) stays the newest app version.
    gh("release", "create", TAG, "--repo", REPO, "--prerelease", "--title", "Server patch", "--notes", "The newest server patch (electron/patcher.cjs).");
  }
  // The tarball first, so the feed never points at an asset that isn't there yet.
  gh("release", "upload", TAG, path.join(dir, asset), "--repo", REPO, "--clobber");
  gh("release", "upload", TAG, path.join(dir, "patch.json"), "--repo", REPO, "--clobber");
  const assets = JSON.parse(gh("release", "view", TAG, "--repo", REPO, "--json", "assets")).assets.map((a) => a.name);
  for (const old of assets.filter((name) => name.startsWith("weft-server-") && name !== asset)) {
    gh("release", "delete-asset", TAG, old, "--repo", REPO, "--yes");
  }
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] || "" : "";
  const key = process.env.WEFT_PATCH_SIGNING_KEY;
  if (!key) fail("WEFT_PATCH_SIGNING_KEY isn't set: run it through the vault (mcp__secrets__run).");
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const tags = git("tag", "--list", "v*").split("\n");
  const changedSinceTag = tags.includes(`v${version}`) ? git("diff", "--name-only", `v${version}`, "HEAD", "--", ...APP_ONLY).split("\n").filter(Boolean) : [];
  const dirty = flag("--allow-dirty") ? [] : git("status", "--porcelain").split("\n").filter(Boolean);
  const blocked = blockers({ version, tags, changedSinceTag, dirty });
  if (blocked.length) fail(blocked.join("\n"));

  if (!flag("--skip-build")) {
    const env = { ...process.env, WEFT_DIST: DIST, WEFT_STANDALONE: "1" };
    execFileSync("pnpm", ["exec", "next", "build"], { cwd: ROOT, env, stdio: "inherit" });
    execFileSync("node", ["scripts/prepare-standalone.mjs", DIST], { cwd: ROOT, stdio: "inherit" });
  }
  const standalone = path.join(ROOT, DIST, "standalone");
  const commit = git("rev-parse", "--short", "HEAD") + (flag("--allow-dirty") && git("status", "--porcelain") ? "-dirty" : "");
  const outDir = path.join(ROOT, "dist", "patch");
  fs.rmSync(outDir, { recursive: true, force: true });
  const draft = detailsFor({ version, commit, seq: Math.floor(Date.now() / 1000), deps: depsFingerprint(standalone).hash, sha256: "", size: 0, notes });
  const asset = assetFor(draft.build);
  const details = { ...draft, ...tarball(standalone, path.join(outDir, asset)) };
  fs.writeFileSync(path.join(outDir, "patch.json"), `${JSON.stringify(feed.signPatch(details, key), null, 2)}\n`);
  console.log(`Wrote dist/patch/${asset} (${(details.size / 1e6).toFixed(1)} MB) and patch.json for ${details.build}`);
  if (flag("--publish")) {
    publish(outDir, asset);
    console.log(`Published ${details.build} to the ${TAG} release; installed Weft ${version} apps take it within the hour.`);
  }
}

function fail(message) {
  console.error(`server-patch-release: ${message}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
