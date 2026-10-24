import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// A pooled worktree's dependencies (docs/architecture/worktrees.md): an APFS clone of the main tree's node_modules
// (`cp -c`, copy-on-write, so 1.5 GB costs no disk and ~13 s), then the lockfile's own offline install on top (~1 s)
// to fix up anything the clone got wrong. Background work only: the pool runs it ahead of time, never a card start.

const run = promisify(execFile);

export type Installer = { bin: string; args: string[]; fallback: string[] };

const LOCKS: [string, Installer][] = [
  ["pnpm-lock.yaml", { bin: "pnpm", args: ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], fallback: ["install", "--prefer-offline", "--frozen-lockfile", "--ignore-scripts"] }],
  // npm ci deletes node_modules first, which would throw the clone away.
  ["package-lock.json", { bin: "npm", args: ["install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts"], fallback: ["install", "--prefer-offline", "--no-audit", "--no-fund", "--ignore-scripts"] }],
  ["yarn.lock", { bin: "yarn", args: ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], fallback: ["install", "--prefer-offline", "--frozen-lockfile", "--ignore-scripts"] }],
];

// The lockfile a folder installs from and the command for it; undefined when it has none (nothing to install).
export function installerFor(dir: string): (Installer & { lock: string }) | undefined {
  const hit = LOCKS.find(([lock]) => fs.existsSync(path.join(dir, lock)));
  return hit ? { lock: hit[0], ...hit[1] } : undefined;
}

// A hash of the folder's lockfile, so the pool knows when an entry's deps went stale; "" with no lockfile.
export function lockHash(dir: string): string {
  const inst = installerFor(dir);
  if (!inst) return "";
  return createHash("sha1").update(fs.readFileSync(path.join(dir, inst.lock))).digest("hex").slice(0, 12);
}

// Clones `from/node_modules` into `to/node_modules` copy-on-write. False when there's nothing to clone or the volume
// can't clone (`cp -c` fails instead of copying), so the caller falls back to a plain install.
export async function cloneModules(from: string, to: string): Promise<boolean> {
  const src = path.join(from, "node_modules");
  const dest = path.join(to, "node_modules");
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  try {
    await run("/bin/cp", ["-c", "-R", src, dest], { timeout: 10 * 60_000 });
    return true;
  } catch {
    fs.rmSync(dest, { recursive: true, force: true });
    return false;
  }
}

// Clone, then install from the lockfile (offline first, then prefer-offline). Returns what it did, for the log.
export async function installDeps(from: string, to: string, env: NodeJS.ProcessEnv): Promise<string> {
  const cloned = await cloneModules(from, to);
  const inst = installerFor(to);
  if (!inst) return cloned ? "cloned node_modules" : "no dependencies";
  for (const args of [inst.args, inst.fallback]) {
    try {
      await run(inst.bin, args, { cwd: to, env, timeout: 10 * 60_000, maxBuffer: 16 << 20 });
      return `${cloned ? "cloned node_modules, " : ""}${inst.bin} ${args.join(" ")}`;
    } catch {}
  }
  return cloned ? "cloned node_modules (install failed)" : "install failed";
}
