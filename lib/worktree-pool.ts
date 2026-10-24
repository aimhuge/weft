import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cliEnv } from "./env";
import { globalSingleton } from "./global-singleton";
import { worktreePoolSize } from "./settings";
import { installDeps, lockHash } from "./worktree-deps";
import { branchFor, cardWorktreePath, createWorktree, dirtyIn, git, headOf, listWorktrees, moveWorktree, removeWorktree, repoDir, repoRootOf, worktreesRoot } from "./worktrees";
import type { Card, CardWorktree } from "./types";

// The warm pool (docs/architecture/worktrees.md), like the runner's warm spare CLIs: per repo an isolated card used
// lately, `worktreePoolSize()` worktrees made ahead of time at the main tree's HEAD with their dependencies in, so
// taking one is a `git worktree move` and a branch (~20 ms) instead of ~15 s. Entries are `pool-<hex>` folders with a
// `pool-<hex>.ready.json` beside them once they're done; one without it is still filling (or left by a crash).

const RECENT_DAYS = 7;
const MAX_REPOS = 3;

interface Ready {
  base: string;
  lock: string;
  at: number;
}

const state = () => globalSingleton("__weftWorktreePool", () => ({ fills: new Map<string, Promise<void>>(), busy: new Set<string>() }));
const log = (line: string) => console.log(`[worktrees] ${line}`);

const reposFile = () => path.join(worktreesRoot(), "repos.json");
const markerOf = (entry: string) => `${entry}.ready.json`;

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Repos isolated cards used in the last week, newest first, three at most: the ones the pool keeps entries for.
export function recentRepos(now = Date.now()): string[] {
  const all = readJson<{ root: string; at: number }[]>(reposFile(), []);
  return all.filter((r) => now - r.at < RECENT_DAYS * 86_400_000).slice(0, MAX_REPOS).map((r) => r.root);
}

export function noteRepo(root: string, now = Date.now()) {
  const rest = readJson<{ root: string; at: number }[]>(reposFile(), []).filter((r) => r.root !== root);
  fs.mkdirSync(worktreesRoot(), { recursive: true });
  fs.writeFileSync(reposFile(), JSON.stringify([{ root, at: now }, ...rest].slice(0, MAX_REPOS * 2)));
}

// The repo's ready entries, newest first.
export function readyEntries(root: string): { path: string; ready: Ready }[] {
  const dir = repoDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /^pool-[0-9a-f]+$/.test(n))
    .map((n) => path.join(dir, n))
    .filter((p) => !state().busy.has(p) && fs.existsSync(markerOf(p)))
    .map((p) => ({ path: p, ready: readJson<Ready>(markerOf(p), { base: "", lock: "", at: 0 }) }))
    .sort((a, b) => b.ready.at - a.ready.at);
}

async function makeEntry(root: string) {
  const entry = path.join(repoDir(root), `pool-${randomBytes(4).toString("hex")}`);
  state().busy.add(entry);
  try {
    const started = Date.now();
    const base = await headOf(root);
    await createWorktree(root, entry, base);
    const did = await installDeps(root, entry, cliEnv());
    fs.writeFileSync(markerOf(entry), JSON.stringify({ base, lock: lockHash(entry), at: Date.now() } satisfies Ready));
    log(`pool entry for ${path.basename(root)} ready in ${((Date.now() - started) / 1000).toFixed(1)}s (${did})`);
  } finally {
    state().busy.delete(entry);
  }
}

// pool-* worktrees with no marker that nothing is filling: a fill a restart cut off.
async function clearLeftovers(root: string) {
  for (const w of await listWorktrees(root)) {
    if (/^pool-/.test(path.basename(w.path)) && !state().busy.has(w.path) && !fs.existsSync(markerOf(w.path))) await removeWorktree(root, w.path);
  }
}

// Tops the repo's pool up to the setting, one entry at a time, in the background. One fill per repo at once.
export function fillPool(root: string): Promise<void> {
  const fills = state().fills;
  const running = fills.get(root);
  if (running) return running;
  const fill = (async () => {
    await clearLeftovers(root);
    while (readyEntries(root).length < worktreePoolSize()) await makeEntry(root);
  })()
    .catch((err: unknown) => log(`couldn't fill the pool for ${root}: ${String(err)}`))
    .finally(() => fills.delete(root));
  fills.set(root, fill);
  return fill;
}

// Brings an idle entry up to the main tree's HEAD: a checkout on a clean tree (milliseconds), plus a reinstall only
// when the lockfile changed. A dirty entry (someone wrote in it) is thrown away instead.
async function freshen(root: string, entry: string, ready: Ready, head: string) {
  if (ready.base === head) return;
  if ((await dirtyIn(entry))?.length !== 0) return removeWorktree(root, entry).then(() => fs.rmSync(markerOf(entry), { force: true }));
  await git(entry, ["checkout", "--quiet", "--detach", head], 60_000);
  const lock = lockHash(entry);
  if (lock !== ready.lock) await installDeps(root, entry, cliEnv());
  fs.writeFileSync(markerOf(entry), JSON.stringify({ base: head, lock, at: ready.at } satisfies Ready));
}

// The scheduler's tick: every recent repo's entries brought to HEAD and its pool topped up.
export async function freshenPools(): Promise<void> {
  if (worktreePoolSize() === 0) return;
  for (const root of recentRepos()) {
    if (!fs.existsSync(root) || state().fills.has(root)) continue;
    try {
      const head = await headOf(root);
      for (const e of readyEntries(root)) await freshen(root, e.path, e.ready, head);
    } catch (err) {
      log(`couldn't freshen ${root}: ${String(err)}`);
    }
    void fillPool(root);
  }
}

// The New thread dialog's Isolated switch went on for this folder: have an entry ready by the time you press Start.
export async function warmPool(folder: string): Promise<void> {
  const root = await repoRootOf(folder);
  if (!root || worktreePoolSize() === 0) return;
  noteRepo(root);
  void fillPool(root);
}

// The card's own worktree: a ready entry moved into place (or, with none ready, one made now: the slow path), at the
// main tree's current HEAD, on the card's weft/* branch. Refills the pool behind it.
export async function takeWorktree(card: Pick<Card, "id" | "title" | "cwd">): Promise<CardWorktree> {
  const root = await repoRootOf(card.cwd);
  if (!root) throw new Error(`${card.cwd} isn't in a git repo, so this card can't have a worktree of its own.`);
  noteRepo(root);
  const dest = cardWorktreePath(root, card.id);
  const branch = branchFor(card);
  const head = await headOf(root);
  const entry = fs.existsSync(dest) ? undefined : readyEntries(root)[0];
  if (fs.existsSync(dest)) {
    // Taken before (a restart between take and save): reuse it as it is.
  } else if (entry) {
    state().busy.add(entry.path);
    fs.rmSync(markerOf(entry.path), { force: true });
    try {
      await moveWorktree(root, entry.path, dest);
    } finally {
      state().busy.delete(entry.path);
    }
    if (entry.ready.base !== head) await git(dest, ["checkout", "--quiet", "--detach", head], 60_000);
    if (lockHash(dest) !== entry.ready.lock) await installDeps(root, dest, cliEnv());
  } else {
    log(`no pool entry ready for ${path.basename(root)}; making one now`);
    await createWorktree(root, dest, head);
    await installDeps(root, dest, cliEnv());
  }
  await git(dest, ["checkout", "--quiet", "-B", branch], 30_000);
  void fillPool(root);
  const sub = path.relative(root, fs.realpathSync(card.cwd));
  return { path: dest, branch, base: head, repo: root, ...(sub && !sub.startsWith("..") ? { sub } : {}) };
}

// After a card lands: its worktree, clean at the landed commit, goes back to the pool (or away when the pool is full).
export async function returnWorktree(wt: CardWorktree): Promise<void> {
  const { repo: root } = wt;
  const full = readyEntries(root).length >= worktreePoolSize();
  if (full || (await dirtyIn(wt.path))?.length !== 0) return removeWorktree(root, wt.path, wt.branch, { force: true });
  await git(wt.path, ["checkout", "--quiet", "--detach"], 30_000);
  await git(root, ["branch", "-D", wt.branch], 10_000).catch(() => "");
  const entry = path.join(repoDir(root), `pool-${randomBytes(4).toString("hex")}`);
  await moveWorktree(root, wt.path, entry);
  fs.writeFileSync(markerOf(entry), JSON.stringify({ base: await headOf(entry), lock: lockHash(entry), at: Date.now() } satisfies Ready));
}

// A deleted card's worktree goes; its branch stays when it has commits that never landed (git branch -d refuses).
export async function dropWorktree(wt: CardWorktree): Promise<void> {
  await removeWorktree(wt.repo, wt.path, wt.branch);
}

// Once per server: freshen and top up the pools of recent repos every 5 minutes (none until an isolated card has run).
export function startWorktreePool(every = 5 * 60_000): void {
  const s = state() as ReturnType<typeof state> & { timer?: ReturnType<typeof setInterval> };
  if (s.timer) return;
  s.timer = setInterval(() => void freshenPools().catch(() => {}), every);
  s.timer.unref();
}
