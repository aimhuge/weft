import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { steps, type Step } from "./restart-guard";

// A thread may not run the Weft Worker's own command line (docs/architecture/project-hosts.md, H8). `weft-worker enrol
// <wph code>` would make a box trust a Mac key the thread chose (any session of the owner can open and confirm a
// pairing), `forget-macs` would drop the real one, and the daemon's script or install/worker.sh run directly would do the
// same. Those are the user's to run, from a terminal. Reading or editing the scripts (cat, git diff, tests) stays open.

const CLI = new Set(["weft-worker", "weft-worker.ts", "worker.sh"]);
// Programs that run a script or a command line they're handed.
const RUNNERS = new Set(["node", "tsx", "ts-node", "jiti", "bun", "bunx", "npx", "pnpx", "pnpm", "npm", "yarn", "deno", "sh", "bash", "zsh", "dash", "ksh", "fish", "exec", "env", "sudo", "nohup", "time", "command"]);

// Whether a step runs the worker's command line, its daemon script or its installer, or hands one a pairing code.
export function runsWorkerCli({ name, args }: Step): boolean {
  if (CLI.has(name)) return true;
  if (!RUNNERS.has(name)) return false;
  return args.some((a) => CLI.has(path.basename(a)) || a.startsWith("wph."));
}

// Why a Bash command is turned away, or null to let it run.
export function workerCliVerdict(command: string, cwd: string): string | null {
  if (!steps(command, cwd).some(runsWorkerCli)) return null;
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
