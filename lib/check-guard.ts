import fs from "node:fs";
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { steps, type Step } from "./restart-guard";

// A dozen cards each running a whole-repo `tsc` or `eslint` at once pinned every core of the Mac
// (2026-10-13: load 27, five tsc and four eslint side by side, some 35 minutes in). A project whose
// `lint` and `typecheck` scripts go through scripts/one-at-a-time.mjs makes them take turns, but only
// when a card runs them that way. This PreToolUse hook turns away tsc and eslint run directly (bare,
// through npx, `pnpm exec`, node_modules/.bin, `sh -c`) in such a project and points at the pnpm
// scripts. Projects without the lock are left alone, as are version and help flags.

const LOCK = "one-at-a-time.mjs";
const TOOLS = new Set(["tsc", "eslint"]);
const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const NPX_VALUED = new Set(["-p", "--package", "-c", "--call"]);
const HARMLESS = new Set(["-v", "--version", "-h", "--help", "--showConfig", "--init", "--print-config", "--env-info"]);

// The tool a step runs and its args: `tsc`, `npx --no-install tsc`, `pnpm exec eslint`, `pnpm tsc`,
// `node node_modules/typescript/bin/tsc`.
export function checkTool({ name, args }: Step): { tool: string; args: string[] } | null {
  if (TOOLS.has(name)) return { tool: name, args };
  let rest = args;
  if (name === "node") rest = args.filter((a) => !a.startsWith("-"));
  else if (RUNNERS.has(name)) {
    let i = 0;
    while (rest[i]?.startsWith("-")) i += NPX_VALUED.has(rest[i] as string) ? 2 : 1;
    rest = rest.slice(i);
  } else if (PACKAGE_MANAGERS.has(name)) rest = ["exec", "dlx", "x", "run"].includes(rest[0] ?? "") ? rest.slice(1) : rest;
  else return null;
  const tool = path.basename(rest[0] ?? "");
  return TOOLS.has(tool) ? { tool, args: rest.slice(1) } : null;
}

// The scripts of the nearest package.json at or above dir, or null.
export function scriptsAbove(dir: string): Record<string, string> | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return path.dirname(dir) === dir ? null : scriptsAbove(path.dirname(dir));
  }
}

// Whether the project at dir runs its checks through the lock.
export function takesTurns(dir: string): boolean {
  const scripts = scriptsAbove(dir);
  return !!scripts && [scripts.lint, scripts.typecheck].some((s) => s?.includes(LOCK));
}

// The direct tsc or eslint a command line would run in a project that takes turns, or null.
export function checkTarget(command: string, cwd: string, turns: (dir: string) => boolean = takesTurns): string | null {
  for (const s of steps(command, cwd)) {
    const hit = checkTool(s);
    if (hit && !hit.args.some((a) => HARMLESS.has(a)) && turns(s.cwd)) return hit.tool;
  }
  return null;
}

// Why a Bash command is turned away, or null to let it run.
export function checkVerdict(command: string, cwd: string, turns?: (dir: string) => boolean): string | null {
  const tool = checkTarget(command, cwd, turns);
  if (!tool) return null;
  const instead = tool === "tsc" ? "`pnpm typecheck`" : "`pnpm lint` (or `pnpm lint <your files>` for just yours)";
  return (
    `Refused: run ${instead} instead of ${tool} directly. Other cards check this repo too, and a dozen whole-repo ` +
    `checks at once pin every core of the Mac; the pnpm script waits its turn (scripts/${LOCK}) and shares the ` +
    "incremental cache. Its output is the same."
  );
}

export const checkGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return Promise.resolve({});
  const command = (input.tool_input as { command?: unknown } | undefined)?.command;
  const why = typeof command === "string" ? checkVerdict(command, input.cwd) : null;
  return Promise.resolve(why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {});
};

// For PreToolUse, beside the git and restart guards (lib/env.ts guardedCli).
export const CHECK_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Bash", hooks: [checkGuard] };
