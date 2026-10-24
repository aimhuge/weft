import os from "node:os";
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { home, steps, type Step } from "./restart-guard";
import { worktreeAt } from "./worktrees";

// Every card in a folder shares one working tree (no worktree per card, on purpose: SOUL.md), so a git
// command that throws away or hides uncommitted changes takes them from every card working there, not just
// the one that ran it (2026-10-12: one card's `git stash` took 112 files of the board's work out of the
// tree). This PreToolUse hook turns away `git stash` (but list and show), `git reset --hard`, checking out
// or restoring paths over the worktree, `git clean -f`, and forced checkouts and switches. It reads command
// lines the way the restart guard does: chained, after `cd`, inside sh -c, and with `git -C dir`. A scratch
// clone under the temp folder is no card's, so it's left alone.

const SCRATCH = [os.tmpdir(), "/tmp", "/private/tmp"].map((d) => path.resolve(d));

// git's own options that take a value (`git -C dir`, `git -c key=value`).
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
// checkout's options whose value isn't a path (`git checkout -b feat origin/feat`).
const CHECKOUT_VALUED = new Set(["-b", "-B", "--orphan"]);

interface GitCall {
  sub: string;
  args: string[];
  dir: string;
}

// A git command's subcommand, its arguments and the folder it acts on, past git's own options.
function gitCall({ name, args, cwd }: Step): GitCall | null {
  if (name !== "git") return null;
  let dir = cwd;
  let i = 0;
  while (args[i]?.startsWith("-")) {
    const opt = args[i] as string;
    if (opt === "-C") dir = path.resolve(dir, home(args[i + 1] ?? "."));
    i += GIT_VALUED.has(opt) ? 2 : 1;
  }
  return { sub: args[i] ?? "", args: args.slice(i + 1), dir };
}

// A short flag cluster or long option: `-fdx` has f, `--force` is force.
const has = (args: string[], short: string, long: string) => args.some((a) => a === long || new RegExp(`^-[a-zA-Z]*${short}[a-zA-Z]*$`).test(a));

// Positional words, past options and the values of the valued ones.
function positionals(args: string[], valued: Set<string>): string[] {
  const out: string[] = [];
  let skip = false;
  for (const a of args) {
    if (skip) skip = false;
    else if (valued.has(a)) skip = true;
    else if (!a.startsWith("-")) out.push(a);
  }
  return out;
}

// `git checkout -- a.ts`, `git checkout .`, `git checkout HEAD a.ts`: paths written over from the index or a
// commit. A lone branch name is a switch, which git refuses when it would lose changes.
function checksOutPaths(args: string[]): boolean {
  const dashes = args.indexOf("--");
  if (dashes >= 0 && dashes < args.length - 1) return true;
  const words = positionals(dashes >= 0 ? args.slice(0, dashes) : args, CHECKOUT_VALUED);
  return words.length > 1 || words.some((w) => w === "." || w === "./" || w.startsWith(":/") || w.includes("*"));
}

// What a git command would do to uncommitted work, or null when it leaves it alone.
const CHECKS: Record<string, (args: string[]) => string | null> = {
  stash: ([sub = ""]) => (sub === "list" || sub === "show" ? null : "`git stash` takes every uncommitted change out of the tree"),
  reset: (args) => (args.includes("--hard") ? "`git reset --hard` throws away every uncommitted change" : null),
  checkout: (args) => {
    if (has(args, "f", "--force")) return "`git checkout --force` throws away uncommitted changes";
    return checksOutPaths(args) ? "`git checkout` over paths throws away their uncommitted changes" : null;
  },
  switch: (args) => (has(args, "f", "--force") || args.includes("--discard-changes") ? "`git switch` with --discard-changes throws away uncommitted changes" : null),
  restore: (args) =>
    has(args, "S", "--staged") && !has(args, "W", "--worktree") ? null : "`git restore` writes over uncommitted changes in the worktree",
  clean: (args) => (has(args, "f", "--force") && !has(args, "n", "--dry-run") ? "`git clean -f` deletes untracked files" : null),
};

// What would let a commit skip the pre-commit hook (scripts/check-staged.sh), or null. On 2026-10-24 the tree's
// core.hooksPath pointed at an empty .git/hooks, the hook never ran, and two commits importing untracked files
// reached Vercel as "Module not found".
const HOOK_CHECKS: Record<string, (args: string[]) => string | null> = {
  commit: (args) => (has(args, "n", "--no-verify") ? "`git commit --no-verify` skips the pre-commit hook" : null),
  config: (args) => {
    const at = args.findIndex((a) => a.toLowerCase() === "core.hookspath");
    if (at < 0 || args.some((a) => a === "--get" || a === "--get-all" || a === "--list" || a === "-l")) return null;
    if (args.some((a) => a.startsWith("--unset"))) return "unsetting core.hooksPath turns off the pre-commit hook";
    const value = args[at + 1];
    return value === undefined || value === ".githooks" ? null : "changing core.hooksPath turns off the pre-commit hook";
  },
};

// `git -c core.hooksPath=…` overrides the hook for one command.
const hookOverride = (command: string) => /(?:^|\s)-c\s+["']?core\.hookspath=/i.test(command);

const scratch = (dir: string) => SCRATCH.some((d) => dir === d || dir.startsWith(d + path.sep));

// An isolated card's worktree is its own (docs/architecture/worktrees.md): discarding changes there, from inside it,
// only throws away its own work. Stash stays refused: refs/stash is shared by every worktree of a repo.
const ownWorktree = (dir: string, cwd: string, sub: string) => {
  const own = worktreeAt(cwd);
  return own !== undefined && own === worktreeAt(dir) && sub !== "stash";
};

// What a command line would do to the shared tree's uncommitted work, or null when it leaves it alone.
export function gitTarget(command: string, cwd: string): string | null {
  for (const s of steps(command, cwd)) {
    const git = gitCall(s);
    const hit = git && !scratch(git.dir) && !ownWorktree(git.dir, cwd, git.sub) ? CHECKS[git.sub]?.(git.args) : null;
    if (hit) return hit;
  }
  return null;
}

// What a command line would do to the shared tree's pre-commit hook, or null when it leaves it alone.
export function hookTarget(command: string, cwd: string): string | null {
  for (const s of steps(command, cwd)) {
    const git = gitCall(s);
    if (!git || scratch(git.dir)) continue;
    if (hookOverride(command)) return "`git -c core.hooksPath=…` skips the pre-commit hook";
    const hit = HOOK_CHECKS[git.sub]?.(git.args);
    if (hit) return hit;
  }
  return null;
}

// Why a Bash command is turned away, or null to let it run.
export function gitVerdict(command: string, cwd: string): string | null {
  const hook = hookTarget(command, cwd);
  if (hook) {
    return (
      `Refused: ${hook}. The hook (scripts/check-staged.sh) is what stops a commit that imports an unstaged file ` +
      "or doesn't type-check; skipped on 2026-10-24, two such commits broke the Vercel build. If it fails, fix what it " +
      "names (usually `git add` the file it lists). If it looks wrong, ask the user."
    );
  }
  const target = gitTarget(command, cwd);
  if (!target) return null;
  return (
    `Refused: ${target}. Other cards' uncommitted work lives in this tree too (one card's \`git stash\` once took 112 ` +
    "files of the board's work), so never stash, reset --hard, checkout or restore paths, or clean here. Commit by path " +
    "instead: `git commit -m '…' -- <your files>`, or build the commit in a temp index (`GIT_INDEX_FILE=/tmp/idx git " +
    "read-tree HEAD`, then `GIT_INDEX_FILE=/tmp/idx git add <your files>` and `GIT_INDEX_FILE=/tmp/idx git commit`, then " +
    "`git reset -q -- <your files>` to bring the real index up to date). To see a clean copy of a file, read it out of " +
    "HEAD: `git show HEAD:path > /tmp/x`. To undo your own change, edit the file back. If the tree really needs " +
    "cleaning, ask the user."
  );
}

export const gitGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return Promise.resolve({});
  const command = (input.tool_input as { command?: unknown } | undefined)?.command;
  const why = typeof command === "string" ? gitVerdict(command, input.cwd) : null;
  return Promise.resolve(why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {});
};

// For PreToolUse, beside the secret and restart guards (lib/env.ts guardedCli).
export const GIT_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Bash", hooks: [gitGuard] };
