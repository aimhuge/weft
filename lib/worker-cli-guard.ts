import fs from "node:fs";
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { shellScriptIndex, steps, type Step } from "./restart-guard";
import { CLONE_REFUSAL, redirectsIntoClone, workerClone, writesClone } from "./worker-clone-guard";

// A thread may not run the Weft Worker's own command line (docs/architecture/project-hosts.md, H8). `weft-worker enrol
// <wph code>` would make a box trust a Mac key the thread chose (any session of the owner can open and confirm a
// pairing), `forget-macs` would drop the real one, and the daemon's script or install/worker.sh run directly would do the
// same. Those are the user's to run, from a terminal. Only running them is refused: reading or editing the scripts, lint, typecheck, tests and git all stay open.
// The worker's own clone, which those commands run from, is the exception: it's read-only to threads (lib/worker-clone-guard.ts).

const CLI = new Set(["weft-worker", "weft-worker.ts", "worker.sh"]);
// Programs that run a script they're handed, or another command line.
const INTERPRETERS = new Set(["node", "tsx", "ts-node", "jiti", "bun", "bunx", "npx", "pnpx", "deno", "python", "python3", "ruby", "perl"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "source", "."]);
const WRAPPERS = new Set(["exec", "env", "sudo", "nohup", "time", "command", "nice", "xargs", "timeout", "setsid", "doas", "script", "unbuffer", "expect", "caffeinate", "stdbuf", "gtimeout", "watch", "parallel", "tmux", "screen", "at", "osascript"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn"]);
// Package-manager subcommands that only read or check files, so naming the script as an argument (a path to lint) is no run.
const CHECKS = new Set(["lint", "test", "typecheck", "format"]);
const PRINTERS = new Set(["cat", "tac", "head", "tail", "less", "more", "bat", "tee", "dd"]);
const FETCHERS = new Set(["curl", "wget", "fetch"]);

const isCli = (a: string) => CLI.has(path.basename(a));
const pairing = (a: string) => a.startsWith("wph.");
// The command named inside an interpreter's string (`python3 -c 'pty.spawn(["weft-worker", …])'`): the word itself or
// the script's file name, never the home folder `.weft-worker/` a checkout path runs through.
const NAMED = /(?:^|[\s/'"[,(=])(?:weft-worker(?:\.ts)?|worker\.sh)(?=$|[\s'"\],);])|(?:^|[\s'"[,(=])wph\./;

// Flags that load code named by a path (a config, plugin, setup file or preloaded module), which would run the script.
const LOADER_FLAG = /^(-c|-r|--config|--plugin|--setupFiles|--globalSetup|--import|--require|--loader|--experimental-loader)(=|$)/;
const isScriptPath = (a: string) => /(^|\/)(weft-worker\.ts|worker\.sh)$/.test(a);
const pathLike = (a: string) => a.includes("/") || a.includes(".");

// `pnpm lint scripts/weft-worker.ts` or `pnpm run test x`: a check, whatever files it is pointed at, as long as the script
// is only a bare path and nothing loads it or feeds it a command word or a pairing code.
function isCheck(args: string[]): boolean {
  const [sub = "", next = ""] = args;
  const rest = args.slice(sub === "run" ? 2 : 1);
  if (!(CHECKS.has(sub) || (sub === "run" && CHECKS.has(next)))) return false;
  if (rest.some((a) => pairing(a) || LOADER_FLAG.test(a) || (isCli(a) && !isScriptPath(a)))) return false;
  const first = rest.findIndex(isCli);
  return first < 0 || rest.slice(first + 1).every((a) => a.startsWith("-") || pathLike(a));
}

// Whether a step runs the worker's command line, its daemon script or its installer, or hands one a pairing code.
// Only execution counts: cat, grep, git diff, sed -n and the like never match. A shape we can't read is refused.
export function runsWorkerCli({ name, args }: Step): boolean {
  if (CLI.has(name)) return true;
  const named = (a: string) => isCli(a) || pairing(a);
  // A wrapper's own option (`sudo -u root cmd`) left in front: what it runs is unreadable, so look at all of it.
  if (name.startsWith("-")) return args.some(named);
  if (SHELLS.has(name)) {
    // `bash -c '<script>'` is read as steps of its own, so its script text isn't an argument here.
    const at = shellScriptIndex(args);
    return args.some((a, i) => i !== at && named(a));
  }
  if (PACKAGE_MANAGERS.has(name)) return !isCheck(args) && args.some(named);
  if (INTERPRETERS.has(name) || WRAPPERS.has(name)) return args.some((a) => named(a) || NAMED.test(a));
  return false;
}

// `echo scripts/weft-worker.ts | xargs node`: xargs feeds a runner a name it never sees as an argument.
function feedsRunner(all: Step[]): boolean {
  const at = all.findIndex((s) => s.name === "xargs");
  const runner = all[at + 1];
  const runs = runner && (INTERPRETERS.has(runner.name) || SHELLS.has(runner.name) || WRAPPERS.has(runner.name) || PACKAGE_MANAGERS.has(runner.name));
  return at >= 0 && !!runs && all.some((s) => s.args.some(isCli));
}

// A shell or interpreter with no script of its own (`sh`, `sh -s -- x`, `node -`) reads its program from stdin.
const readsStdin = ({ name, args }: Step) =>
  (SHELLS.has(name) || INTERPRETERS.has(name)) && shellScriptIndex(args) < 0 && args.every((a) => a.startsWith("-") || a === "--");

// `curl https://weft.zip/worker.sh | sh`, `cat install/worker.sh | sh`: the installer or script is printed or fetched
// next to a shell or interpreter that could run it.
function pipesInstaller(all: Step[]): boolean {
  const prints = all.some((s) => (FETCHERS.has(s.name) || PRINTERS.has(s.name)) && s.args.some(isCli));
  return prints && all.some(readsStdin);
}

// `sh < install/worker.sh`, `node - < scripts/weft-worker.ts`: a shell or interpreter reading the script on stdin.
const REDIRECTS_CLI = /(<|<<<)\s*["']?[^\s|;&"']*(weft-worker(\.ts)?|worker\.sh)\b/;

// Why a Bash command is turned away, or null to let it run.
export function workerCliVerdict(command: string, cwd: string, clone = workerClone()): string | null {
  const all = steps(command, cwd);
  if (fs.existsSync(clone) && (all.some((s) => writesClone(s, clone)) || redirectsIntoClone(command, cwd, clone, all.map((s) => s.cwd)))) return CLONE_REFUSAL;
  const redirected = REDIRECTS_CLI.test(command) && all.some(readsStdin);
  if (!redirected && !all.some(runsWorkerCli) && !pipesInstaller(all) && !feedsRunner(all)) return null;
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
