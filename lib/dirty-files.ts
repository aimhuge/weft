import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// What git says is uncommitted in a repo, for the Bash claims (lib/bash-claims.ts): which files a command
// wrote, and which claimed files are clean again. Both read `git status` and the file's mtime, nothing else.

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-C", cwd, "--no-optional-locks", ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });

// The repo holding a folder, as its real path (the way claims name files), or undefined outside git.
export function repoRoot(cwd: string): string | undefined {
  try {
    return fs.realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return undefined;
  }
}

// `git status --porcelain -z` entries are "XY path"; a rename or copy carries its old path in the next entry.
export function parsePorcelain(out: string): string[] {
  const parts = out.split("\0");
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] as string;
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return files;
}

// Every file changed, added, deleted or untracked in the repo, absolute; undefined when git can't say,
// so a caller never mistakes a failed read for a clean tree.
export function dirtyFiles(root: string): string[] | undefined {
  try {
    return parsePorcelain(git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])).map((rel) => path.join(root, rel));
  } catch {
    return undefined;
  }
}

// Of these files, the ones written at or after `since` (ms), with when; a deleted one has no mtime and isn't.
export function writtenAt(files: string[], since: number): Map<string, number> {
  const at = new Map<string, number>();
  for (const f of files) {
    try {
      const m = fs.statSync(f).mtimeMs;
      if (m >= since) at.set(f, m);
    } catch {
      // gone
    }
  }
  return at;
}

export const writtenSince = (files: string[], since: number): string[] => [...writtenAt(files, since).keys()];
