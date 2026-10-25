// The file-system helpers behind the code quality header: walking a project, reading sources,
// and the regexes that pick source files out of a list. lib/quality.ts turns their results into
// the per-section score.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|mts|cts|py|go|rs|rb|java|kt|swift|vue|svelte)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "venv", "__pycache__", "target"]);
const GENERATED = /\.d\.ts$|\.min\.js$/;
export const TEST = /[._](test|spec)\.[a-z]+$|(^|\/)(__tests__|tests?)\//;
const MAX_FILES = 5000;
const MAX_BYTES = 1_000_000;

export type Source = { path: string; lines: number; text: string; test: boolean };
export type Pkg = { scripts?: Record<string, string>; [key: string]: unknown };

// The project a folder belongs to: its git root, else the folder itself.
export function projectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

function skipped(rel: string) {
  return rel.split("/").slice(0, -1).some((d) => SKIP_DIRS.has(d) || d.startsWith("."));
}

// Without git: every file under root, skipping dependency, build and dot folders.
function walk(root: string, rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(root, p, out);
    } else out.push(p);
  }
  return out;
}

// Every file, relative to root: git's tracked and untracked-but-not-ignored files, else a walk.
export function listFiles(root: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return walk(root);
  }
}

// Source files, relative to root.
export function listSources(files: string[]): string[] {
  return files.filter((f) => SOURCE.test(f) && !GENERATED.test(f) && !skipped(f)).slice(0, MAX_FILES);
}

export function readSources(root: string, files: string[]): Source[] {
  const out: Source[] = [];
  for (const rel of listSources(files)) {
    try {
      const file = path.join(root, rel);
      if (fs.statSync(file).size > MAX_BYTES) continue;
      const text = fs.readFileSync(file, "utf8");
      const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
      out.push({ path: rel, lines, text, test: TEST.test(rel) });
    } catch {
      // Listed by git but deleted from the tree.
    }
  }
  return out;
}

export function read(root: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}
