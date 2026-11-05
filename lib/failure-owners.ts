import fs from "node:fs";
import path from "node:path";
import { claimFiles, claimFilesOf } from "./claims";
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

// Files a Bash command wrote while other cards ran one too (lib/bash-writers.ts) are named "unknown", never
// as another card's: the writer may well be this card, and telling it to leave its own breakage is worse.
const UNKNOWN = [
  "Weft can't tell which card wrote these (a Bash command or a process it started, like a subagent, wrote them while other cards ran commands too):",
  "If your own commands or subagents wrote them, they're yours to fix.",
];

// The failing files whose writer is unknown and that no card claims, as the note's lines; none when there are none.
function unknownLines(failing: string[], unknown: ReadonlySet<string>, claimed: (file: string) => boolean, root: string): string[] {
  const files = failing.filter((p) => unknown.has(p) && !claimed(p));
  if (!files.length) return [];
  return [UNKNOWN[0] as string, ...files.slice(0, MAX_LINES).map((f) => `- ${path.relative(root, f)}: unknown`), UNKNOWN[1] as string];
}

export function failureNote(
  command: string,
  output: string,
  cwd: string,
  root: string,
  card: Card,
  cards: Card[],
  unknown: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!FAILED.test(output) || !runsCheck(command, cwd)) return undefined;
  const owner = claimFilesOf(busyInFolder(cards, workDir(card), card.id));
  const mine = claimFiles(card);
  const failing = failurePaths(output, cwd, root);
  const unsureLines = unknownLines(failing, unknown, (f) => owner.has(f) || mine.has(f), root);
  const unsure = unsureLines.length ? unsureLines.join("\n") : undefined;
  if (!owner.size) return unsure;
  const show = (file: string) => `- ${path.relative(root, file)}: ‘${(owner.get(file) as Card).title}’`;
  const theirs = failing.filter((p) => owner.has(p));
  if (theirs.length)
    return [
      "Some of these failures are in files another card is editing right now (cards share this working tree, so you see its unfinished work):",
      ...theirs.slice(0, MAX_LINES).map(show),
      "Leave those to that card: don't fix, revert or reformat them. Fix only what your own edits broke.",
      ...unsureLines,
    ].join("\n");
  // Only source files can break a caller, and failures all in this card's own files are its own.
  const open = [...owner.keys()].filter((f) => SOURCE.test(f));
  if (!open.length || (failing.length && failing.every((p) => mine.has(p)))) return unsure;
  return [
    ...unsureLines,
    "Other cards are mid-edit in this tree, so a failure here may be theirs (a signature they changed breaking a caller of yours, say):",
    ...open.slice(0, MAX_LINES).map(show),
    "If a failure traces back to one of those files, leave it to that card and say so, instead of fixing it yourself.",
  ].join("\n");
}
