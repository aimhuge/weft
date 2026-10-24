import { dirtyIn, git } from "./worktrees";
import type { CardWorktree } from "./types";

// Landing an isolated card's branch on the main tree (docs/architecture/worktrees.md): commit what's left in the
// worktree, rebase the branch on the main tree's branch, then fast-forward the main tree to it. The main tree is only
// ever touched by `git merge --ff-only`, which updates just the files the commits changed and refuses, touching
// nothing, when one of them has uncommitted changes there: other cards' work is never stashed, reset or checked out.

export type Landed =
  | { ok: true; commit: string; onto: string; pushed: boolean; nothing?: boolean }
  | { ok: false; kind: "conflict" | "dirty" | "detached" | "commit" | "error"; files: string[]; message: string; onto?: string };

const errText = (err: unknown) => String((err as { stderr?: unknown }).stderr || (err as Error).message || err).trim();

// "error: Your local changes to the following files would be overwritten by merge:\n\ta.ts\n\tb.ts\nPlease commit…"
export function overwrittenFiles(stderr: string): string[] {
  const block = /would be overwritten by (?:merge|checkout):\n([\s\S]*?)\n(?:Please|Aborting)/.exec(stderr)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function commitLeftovers(wt: CardWorktree, message: string): Promise<Landed | null> {
  const dirty = await dirtyIn(wt.path);
  if (!dirty?.length) return null;
  try {
    await git(wt.path, ["add", "-A"], 60_000);
    // The pre-commit hook runs here too (no --no-verify): it's the same check every commit gets.
    await git(wt.path, ["commit", "--quiet", "-m", message], 600_000);
    return null;
  } catch (err) {
    return { ok: false, kind: "commit", files: dirty, message: `The commit in the worktree failed: ${errText(err)}` };
  }
}

async function rebase(wt: CardWorktree, onto: string): Promise<Landed | null> {
  try {
    await git(wt.path, ["rebase", "--quiet", onto], 300_000);
    return null;
  } catch (err) {
    const files = (await git(wt.path, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").filter(Boolean);
    await git(wt.path, ["rebase", "--abort"]).catch(() => "");
    return { ok: false, kind: "conflict", files, onto, message: `Rebasing ${wt.branch} on ${onto} conflicts${files.length ? ` in ${files.join(", ")}` : ""}: ${errText(err)}` };
  }
}

// One fast-forward try: null when it landed, "moved" when the main tree's branch moved past the rebase, else a refusal.
async function fastForward(wt: CardWorktree): Promise<Landed | "moved" | null> {
  try {
    await git(wt.repo, ["merge", "--ff-only", "--quiet", wt.branch], 120_000);
    return null;
  } catch (err) {
    const text = errText(err);
    const files = overwrittenFiles(text);
    if (files.length) return { ok: false, kind: "dirty", files, message: `The main tree has uncommitted changes to ${files.join(", ")}, which this branch also changes.` };
    if (/not possible to fast-forward|diverging/i.test(text)) return "moved";
    return { ok: false, kind: "error", files: [], message: `Couldn't fast-forward ${wt.repo}: ${text}` };
  }
}

async function push(repo: string): Promise<boolean> {
  try {
    await git(repo, ["rev-parse", "--abbrev-ref", "@{u}"], 10_000);
    await git(repo, ["push", "--quiet"], 300_000);
    return true;
  } catch {
    return false;
  }
}

export async function landWorktree(wt: CardWorktree, message: string, { push: pushAfter = true } = {}): Promise<Landed> {
  const left = await commitLeftovers(wt, message);
  if (left) return left;
  const onto = await git(wt.repo, ["symbolic-ref", "--quiet", "--short", "HEAD"], 10_000).catch(() => "");
  if (!onto) return { ok: false, kind: "detached", files: [], message: `${wt.repo} isn't on a branch (detached HEAD), so there's nothing to land on.` };
  // Three tries at most: another card can land between this rebase and the fast-forward.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ahead = Number(await git(wt.repo, ["rev-list", "--count", `${onto}..${wt.branch}`], 10_000));
    if (ahead === 0) return { ok: true, commit: await git(wt.repo, ["rev-parse", "--short", onto]), onto, pushed: false, nothing: true };
    const conflict = await rebase(wt, onto);
    if (conflict) return conflict;
    const ff = await fastForward(wt);
    if (ff === "moved") continue;
    if (ff) return ff;
    return { ok: true, commit: await git(wt.repo, ["rev-parse", "--short", "HEAD"]), onto, pushed: pushAfter && (await push(wt.repo)) };
  }
  return { ok: false, kind: "error", files: [], message: `${onto} kept moving while landing; try again.` };
}
