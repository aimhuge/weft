import fs from "node:fs";
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { steps, type Step } from "./restart-guard";
import { CLONE_REFUSAL, redirectsIntoClone, workerClone, writesClone } from "./worker-clone-guard";

// A thread may not run the Weft Worker's own command line (docs/architecture/project-hosts.md, H8). `weft-worker enrol
// <wph code>` would make a box trust a Mac key the thread chose (any session of the owner can open and confirm a
// pairing), `forget-macs` would drop the real one, and the daemon's script or install/worker.sh run directly would do the
// same. Those are the user's to run, from a terminal. Reading the scripts (cat, git diff, tests) stays open; changing the
// worker's own clone, which those commands run from, doesn't (lib/worker-clone-guard.ts).

const CLI = new Set(["weft-worker", "weft-worker.ts", "worker.sh"]);
// Programs that run a script or a command line they're handed, including the ones that give it a terminal (script,
// expect, unbuffer) or wrap it (timeout, stdbuf, caffeinate) and interpreters handed one in a string (python -c).
const RUNNERS = new Set(
  ("node tsx ts-node jiti bun bunx npx pnpx pnpm npm yarn deno sh bash zsh dash ksh fish exec env sudo doas su nohup time command " +
    "script expect unbuffer timeout gtimeout stdbuf caffeinate nice ionice setsid flock watch xargs parallel screen tmux " +
    "python python3 perl ruby php osascript tclsh lua").split(" "),
);
// The command named inside a string (`script -c "weft-worker enrol …"`, `pty.spawn(["weft-worker", …])`): the word
// itself or the script's file name, never the home folder `.weft-worker/` a checkout path runs through.
const NAMED = /(?:^|[\s/'"[,(=])(?:weft-worker(?:\.ts)?|worker\.sh)(?=$|[\s'"\],);])|(?:^|[\s'"[,(=])wph\./;

// Whether a step runs the worker's command line, its daemon script or its installer, or hands one a pairing code.
export function runsWorkerCli({ name, args }: Step): boolean {
  if (CLI.has(name)) return true;
  if (!RUNNERS.has(name)) return false;
  return args.some((a) => CLI.has(path.basename(a)) || NAMED.test(a));
}

// Why a Bash command is turned away, or null to let it run.
export function workerCliVerdict(command: string, cwd: string, clone = workerClone()): string | null {
  const all = steps(command, cwd);
  if (fs.existsSync(clone) && (all.some((s) => writesClone(s, clone)) || redirectsIntoClone(command, cwd, clone, all.map((s) => s.cwd)))) return CLONE_REFUSAL;
  if (!all.some(runsWorkerCli)) return null;
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
