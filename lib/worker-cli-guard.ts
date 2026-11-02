import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { steps, type Step } from "./restart-guard";

// A thread may not run the Weft Worker's own command line (docs/architecture/project-hosts.md, H8). `weft-worker enrol
// <wph code>` would make a box trust a Mac key the thread chose (any session of the owner can open and confirm a
// pairing), `forget-macs` would drop the real one, and the daemon's script or install/worker.sh run directly would do the
// same. Those are the user's to run, from a terminal. Only running them is refused: reading or editing the scripts, lint, typecheck, tests and git all stay open.

const CLI = new Set(["weft-worker", "weft-worker.ts", "worker.sh"]);
// Programs that run a script they're handed, or another command line.
const INTERPRETERS = new Set(["node", "tsx", "ts-node", "jiti", "bun", "bunx", "npx", "pnpx", "deno", "python", "python3", "ruby", "perl"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "source", "."]);
const WRAPPERS = new Set(["exec", "env", "sudo", "nohup", "time", "command", "nice", "xargs", "timeout", "setsid", "doas"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn"]);
// Package-manager subcommands that only read or check files, so naming the script as an argument (a path to lint) is no run.
const CHECKS = new Set(["lint", "test", "typecheck", "format", "prettier", "eslint", "tsc"]);
const FETCHERS = new Set(["curl", "wget", "fetch"]);

const isCli = (a: string) => CLI.has(path.basename(a));
const pairing = (a: string) => a.startsWith("wph.");

// `pnpm lint scripts/weft-worker.ts` or `pnpm run test x`: a check, whatever files it is pointed at.
function isCheck(args: string[]): boolean {
  const [sub = "", next = ""] = args;
  return CHECKS.has(sub) || (sub === "run" && CHECKS.has(next));
}

// Whether a step runs the worker's command line, its daemon script or its installer, or hands one a pairing code.
// Only execution counts: cat, grep, git diff, sed -n and the like never match. A shape we can't read is refused.
export function runsWorkerCli({ name, args }: Step): boolean {
  if (CLI.has(name)) return true;
  // A wrapper's own option (`sudo -u root cmd`) left in front: what it runs is unreadable, so look at all of it.
  if (name.startsWith("-")) return args.some((a) => isCli(a) || pairing(a));
  if (SHELLS.has(name)) {
    // `bash -c '<script>'` is read as steps of its own, so its script text isn't an argument here.
    const at = args.indexOf("-c");
    return args.some((a, i) => (at < 0 || i !== at + 1) && (isCli(a) || pairing(a)));
  }
  if (PACKAGE_MANAGERS.has(name)) return !isCheck(args) && args.some((a) => isCli(a) || pairing(a));
  if (INTERPRETERS.has(name) || WRAPPERS.has(name)) return args.some((a) => isCli(a) || pairing(a));
  return false;
}

// `echo scripts/weft-worker.ts | xargs node`: xargs feeds a runner a name it never sees as an argument.
function feedsRunner(all: Step[]): boolean {
  const at = all.findIndex((s) => s.name === "xargs");
  const runner = all[at + 1];
  const runs = runner && (INTERPRETERS.has(runner.name) || SHELLS.has(runner.name) || WRAPPERS.has(runner.name) || PACKAGE_MANAGERS.has(runner.name));
  return at >= 0 && !!runs && all.some((s) => s.args.some(isCli));
}

// `curl https://weft.zip/worker.sh | sh`: a fetch of the installer next to a shell that could run it.
function pipesInstaller(all: Step[]): boolean {
  return all.some((s) => FETCHERS.has(s.name) && s.args.some(isCli)) && all.some((s) => SHELLS.has(s.name));
}

// Why a Bash command is turned away, or null to let it run.
export function workerCliVerdict(command: string, cwd: string): string | null {
  const all = steps(command, cwd);
  if (!all.some(runsWorkerCli) && !pipesInstaller(all) && !feedsRunner(all)) return null;
  return "Refused: a thread can't run weft-worker (enrol, forget-macs and the rest), the daemon's script or the worker installer. They decide which Mac a worker trusts with secrets, so the user runs them from a terminal on the box.";
}

export const workerCliGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return Promise.resolve({});
  const command = (input.tool_input as { command?: unknown } | undefined)?.command;
  const why = typeof command === "string" ? workerCliVerdict(command, input.cwd) : null;
  return Promise.resolve(why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {});
};

// For PreToolUse, beside the check and restart guards (lib/guards/hooks.ts).
export const WORKER_CLI_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Bash", hooks: [workerCliGuard] };
