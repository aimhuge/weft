import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Card } from "./types";

// Git worktrees for isolated cards (docs/architecture/worktrees.md): made, listed, moved and removed under
// ~/.weft/worktrees/<repo>/<name>, never inside the project folder, so no stray folders land in it. Plain git over
// execFile (no shell), each call with a timeout. Nothing here runs unless a card asked for isolation.

const run = promisify(execFile);

export async function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout, maxBuffer: 16 << 20 });
  return stdout.trimEnd();
}

// ~/.weft/worktrees, moved with the rest of Weft's data by WEFT_DATA (tests use their own).
export function worktreesRoot(): string {
  return path.join(process.env.WEFT_DATA || path.join(os.homedir(), ".weft"), "worktrees");
}

// The isolated card's worktree a folder is in (~/.weft/worktrees/<repo>/<name>), or undefined outside one.
export function worktreeAt(dir: string, root = worktreesRoot()): string | undefined {
  const rel = path.relative(root, path.resolve(dir));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const [repo, name] = rel.split(path.sep);
  return repo && name ? path.join(root, repo, name) : undefined;
}

// The folder name for a repo's worktrees: its own name plus 6 hex of its path, so two repos called `app` don't share one.
export function repoKey(root: string): string {
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
  return `${name}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;
}

export function repoDir(root: string): string {
  return path.join(worktreesRoot(), repoKey(root));
}

// "Fix the login page!" -> "fix-the-login-page", at most 40 characters on a word boundary.
export function cardSlug(title: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length <= 40) return slug;
  const cut = slug.slice(0, 40);
  return cut.slice(0, cut.lastIndexOf("-") > 20 ? cut.lastIndexOf("-") : 40);
}

// weft/<slug>-<first 6 of the id>: readable in `git branch`, unique per card.
export function branchFor(card: Pick<Card, "id" | "title">): string {
  return `weft/${cardSlug(card.title) || "card"}-${card.id.replace(/-/g, "").slice(0, 6)}`;
}

// The card's worktree folder: ~/.weft/worktrees/<repo>/<first 8 of its id>.
export function cardWorktreePath(root: string, cardId: string): string {
  return path.join(repoDir(root), cardId.replace(/-/g, "").slice(0, 8));
}

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// The repo a folder is in, as its real path; undefined outside git.
export async function repoRootOf(folder: string): Promise<string | undefined> {
  try {
    return real(await git(folder, ["rev-parse", "--show-toplevel"], 10_000));
  } catch {
    return undefined;
  }
}

export const headOf = (root: string) => git(root, ["rev-parse", "HEAD"], 10_000);

// Whether a path is one of Weft's worktrees of this repo (and not the repo itself or anything else).
export function isOurs(root: string, p: string): boolean {
  const rel = path.relative(real(repoDir(root)), real(p));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.includes(path.sep);
}

function mustBeOurs(root: string, p: string) {
  if (!isOurs(root, p)) throw new Error(`${p} isn't one of Weft's worktrees of ${root}.`);
}

// A new worktree at `dest` (inside the repo's worktree folder), detached at `base`.
export async function createWorktree(root: string, dest: string, base = "HEAD"): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  mustBeOurs(root, dest);
  await git(root, ["worktree", "add", "--detach", "--quiet", dest, base], 120_000);
  return dest;
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
}

// `git worktree list --porcelain`: blocks of "worktree <path>", "HEAD <sha>", "branch refs/heads/<name>" or "detached".
export function parseWorktreeList(out: string): WorktreeInfo[] {
  return out
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      const field = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
      const p = field("worktree");
      const branch = field("branch")?.replace(/^refs\/heads\//, "");
      return p ? { path: p, head: field("HEAD") ?? "", ...(branch ? { branch } : {}) } : null;
    })
    .filter((w): w is WorktreeInfo => w !== null);
}

// Weft's worktrees of this repo (the main tree and other people's worktrees left out).
export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const out = await git(root, ["worktree", "list", "--porcelain"], 10_000);
  return parseWorktreeList(out).filter((w) => isOurs(root, w.path) && fs.existsSync(w.path));
}

export async function moveWorktree(root: string, from: string, to: string): Promise<void> {
  mustBeOurs(root, from);
  mustBeOurs(root, to);
  await git(root, ["worktree", "move", from, to], 30_000);
}

// Removes one of Weft's worktrees and, when given, its weft/* branch. `force` deletes a branch that hasn't landed
// (git branch -D); without it an unlanded branch is kept (git branch -d refuses), so a deleted card's commits survive.
export async function removeWorktree(root: string, p: string, branch?: string, { force = false } = {}): Promise<void> {
  mustBeOurs(root, p);
  try {
    await git(root, ["worktree", "remove", "--force", p], 60_000);
  } catch {
    fs.rmSync(p, { recursive: true, force: true });
  }
  await git(root, ["worktree", "prune"], 10_000).catch(() => "");
  if (branch?.startsWith("weft/")) await git(root, ["branch", force ? "-D" : "-d", branch], 10_000).catch(() => "");
}

// Uncommitted files in a tree (relative paths), or undefined when git can't say.
export async function dirtyIn(dir: string): Promise<string[] | undefined> {
  try {
    const out = await git(dir, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"], 15_000);
    return out ? out.split("\n").map((l) => l.slice(3)) : [];
  } catch {
    return undefined;
  }
}
