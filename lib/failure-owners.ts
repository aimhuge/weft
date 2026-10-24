import fs from "node:fs";
import path from "node:path";
import { splitClaim } from "./claims";
import { busyInFolder } from "./overlap";
import { steps } from "./restart-guard";
import type { Card } from "./types";
import { workDir } from "./work-dir";

// Cards share one working tree, so a thread's typecheck, tests or lint run over every other busy card's
// unfinished edits too, and a thread used to spend turns "fixing" breakage that wasn't its own. After a
// check fails, lib/bash-claims.ts hands the thread this note: which failures sit in files another busy
// card is editing (leave them to it), or, when none do, which files other cards have open, since a
// signature changed there can break a caller here.

// A check is a command that runs one, read from the parsed line: a grep over `*.test.ts` names isn't.
const CHECK_TOOLS = new Set(["tsc", "tsc-once", "vitest", "jest", "eslint"]);
const CHECK_SCRIPTS = new Set([...CHECK_TOOLS, "test", "typecheck", "lint", "build", "check", "coverage"]);
const RUNNERS = new Set(["pnpm", "npm", "yarn", "bun", "npx", "pnpx", "bunx", "next"]);

function runsCheck(command: string, cwd: string) {
  return steps(command, cwd).some(({ name, args }) => {
    if (CHECK_TOOLS.has(name)) return true;
    const [first = "", second = ""] = args.filter((a) => !a.startsWith("-"));
    return RUNNERS.has(name) && CHECK_SCRIPTS.has(["run", "exec", "x", "dlx"].includes(first) ? second : first);
  });
}

const FAILED = /\berror\b|\bfail(ed|ing|s)?\b|✗|×/i;
// `lib/a.ts(3,4): error`, `lib/a.ts:3:4`, ` FAIL  lib/a.test.ts > …`, `/abs/a.tsx`.
const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts|css)$/;
const PATH = /(?:^|[\s("'`])((?:\.{0,2}\/)?[\w@.\-/[\]]+\.(?:tsx?|jsx?|mjs|cjs|mts|cts|css))(?=[(:\s"'`]|$)/gm;
const MAX_PATHS = 200;
const MAX_LINES = 8;

const real = (file: string) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

// The source files a check's output names, absolute: relative ones against the folder it ran in, else the repo's root.
export function failurePaths(output: string, cwd: string, root: string): string[] {
  const found = new Set<string>();
  for (const m of output.matchAll(PATH)) {
    const p = m[1] as string;
    const here = path.resolve(cwd, p);
    found.add(real(path.isAbsolute(p) || fs.existsSync(here) ? here : path.resolve(root, p)));
    if (found.size >= MAX_PATHS) break;
  }
  return [...found];
}

export function failureNote(command: string, output: string, cwd: string, root: string, card: Card, cards: Card[]): string | undefined {
  if (!FAILED.test(output) || !runsCheck(command, cwd)) return undefined;
  const owner = new Map<string, Card>();
  for (const other of busyInFolder(cards, workDir(card), card.id)) {
    for (const key of other.claims ?? []) if (!owner.has(splitClaim(key).file)) owner.set(splitClaim(key).file, other);
  }
  if (!owner.size) return undefined;
  const show = (file: string) => `- ${path.relative(root, file)}: ‘${(owner.get(file) as Card).title}’`;
  const failing = failurePaths(output, cwd, root);
  const theirs = failing.filter((p) => owner.has(p));
  if (theirs.length)
    return [
      "Some of these failures are in files another card is editing right now (cards share this working tree, so you see its unfinished work):",
      ...theirs.slice(0, MAX_LINES).map(show),
      "Leave those to that card: don't fix, revert or reformat them. Fix only what your own edits broke.",
    ].join("\n");
  // Only source files can break a caller, and failures all in this card's own files are its own.
  const mine = new Set((card.claims ?? []).map((k) => splitClaim(k).file));
  const open = [...owner.keys()].filter((f) => SOURCE.test(f));
  if (!open.length || (failing.length && failing.every((p) => mine.has(p)))) return undefined;
  return [
    "Other cards are mid-edit in this tree, so a failure here may be theirs (a signature they changed breaking a caller of yours, say):",
    ...open.slice(0, MAX_LINES).map(show),
    "If a failure traces back to one of those files, leave it to that card and say so, instead of fixing it yourself.",
  ].join("\n");
}
