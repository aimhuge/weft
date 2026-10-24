import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { stripPrefixes, unwrapEnv } from "./secret-guard";
import { parseShell } from "./shell-parse";

// Every board thread's CLI is a child of Weft's own Next server, so a thread that restarts Weft cuts off
// every running turn on the board, its own included (2026-10-11: `kill -9 <server pid>` from one card
// dropped every running card). This PreToolUse hook turns away Bash commands that would kill or restart
// Weft itself while other turns run, and says how many: kill/pkill/killall aimed at its server or app,
// freeing its port, or a second `npm run dev` / `electron .` in its folder (whose free-port step kills the
// first). With nothing else running it allows them. A project's own dev server is never Weft's.

export const RESTART_PROMPT =
  "Never restart Weft or kill its server yourself (its `next dev`, Electron, Weft.app or its port): a restart cuts off every running card's turn. When Weft needs one (say its Electron side changed), call mcp__board__restart_weft_when_idle: nothing new starts and Weft restarts once every running turn, yours included, has ended. Your project's own dev server is fine to restart.";

// What a command would have to hit to take Weft down.
export interface WeftProcess {
  pids: number[];
  port: string;
  dir: string;
  // Process names, for pkill and killall; command lines, for pkill -f.
  names: string[];
  lines: string[];
}

// This server's own pid, the `next dev` that started it, and the Electron app (main.cjs passes its pid).
export function weftProcess(): WeftProcess {
  const port = process.env.PORT ?? "";
  const dir = process.cwd();
  const app = Number(process.env.WEFT_APP_PID);
  return {
    pids: [process.pid, process.ppid, app].filter((p) => Number.isInteger(p) && p > 1),
    port,
    dir,
    names: ["node", "next-server", "Electron", "Electron Helper", "Weft", "Weft Helper"],
    lines: [
      process.argv.join(" "),
      `node ${dir}/node_modules/.bin/next dev -H 127.0.0.1 -p ${port}`,
      "next-server",
      `${dir}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`,
      "/Applications/Weft.app/Contents/MacOS/Weft",
    ],
  };
}

// One command as it would run, with the folder it would run in.
export interface Step {
  name: string;
  args: string[];
  cwd: string;
}

const SHELLS = new Set("sh bash zsh dash ksh fish eval".split(" "));
const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "-J", "-R"]);

export const home = (p: string) => (p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p);

// The words after a command's options, past the value each valued option takes.
function afterOptions(args: string[], valued: Set<string>): string[] {
  let i = 0;
  while (args[i]?.startsWith("-")) i += valued.has(args[i] as string) ? 2 : 1;
  return args.slice(i);
}

function step(words: string[], cwd: string): Step {
  const [first = "", ...args] = unwrapEnv(stripPrefixes(words));
  return { name: path.basename(first), args, cwd };
}

// Every command a line would run: piped, nested in $( ), inside sh -c or a heredoc fed to bash, and what
// xargs runs. `cd` carries to the commands after it. The git guard (lib/git-guard.ts) walks commands this way too.
export function steps(command: string, cwd: string, depth = 0): Step[] {
  if (depth > 5) return [];
  const { commands, nested } = parseShell(command);
  const out: Step[] = [];
  let here = cwd;
  for (const c of commands) {
    const s = step(c.words, here);
    if (s.name === "cd") {
      here = path.resolve(here, home(s.args[0] ?? "~"));
      continue;
    }
    out.push(s);
    if (SHELLS.has(s.name)) {
      const at = s.args.indexOf("-c");
      const scripts = s.name === "eval" ? [s.args.join(" ")] : [...c.stdin, ...(at >= 0 ? [s.args[at + 1] ?? ""] : [])];
      out.push(...scripts.flatMap((script) => steps(script, here, depth + 1)));
    }
    if (s.name === "xargs") out.push(step(afterOptions(s.args, XARGS_VALUED), here));
  }
  return [...out, ...nested.flatMap((n) => steps(n, here, depth + 1))];
}

const flags = (args: string[]) => args.filter((a) => a.startsWith("-"));

// `kill -9 123`, `kill -s KILL 123`, `kill -- -123` (a process group led by 123).
function killedPids(args: string[]): number[] {
  const out: number[] = [];
  let skip = false;
  args.forEach((a, i) => {
    if (skip) skip = false;
    else if (a === "-s" || a === "-n") skip = true;
    else if (/^\d+$/.test(a)) out.push(Number(a));
    else if (/^-\d+$/.test(a) && args.slice(0, i).includes("--")) out.push(-Number(a));
  });
  return out;
}

function pattern(source: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(source, ignoreCase ? "i" : "");
  } catch {
    return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ignoreCase ? "i" : "");
  }
}

const PKILL_VALUED = new Set(["-u", "-U", "-g", "-G", "-P", "-s", "-t", "-F", "-J"]);

// pkill's pattern against process names, or with -f against whole command lines.
function pkillHits(args: string[], weft: WeftProcess): boolean {
  const [source] = afterOptions(args, PKILL_VALUED);
  if (!source) return false;
  const re = pattern(source, flags(args).some((f) => /^-[a-zA-Z]*i/.test(f)));
  const full = flags(args).some((f) => /^-[a-zA-Z]*f/.test(f));
  return (full ? weft.lines : weft.names).some((n) => re.test(n));
}

const KILLALL_VALUED = new Set(["-u", "-t", "-c", "-s"]);

// killall's exact names, or with -m regexes.
function killallHits(args: string[], weft: WeftProcess): boolean {
  const names: string[] = [];
  let skip = false;
  for (const a of args) {
    if (skip) skip = false;
    else if (KILLALL_VALUED.has(a)) skip = true;
    else if (!a.startsWith("-")) names.push(a);
  }
  const regex = args.includes("-m");
  return names.some((n) => weft.names.some((w) => (regex ? pattern(n, false).test(w) : n === w)));
}

// `:1000`, `-i:1000`, `-iTCP:1000`, `tcp:1000`, `1000/tcp`, or a bare 1000 for kill-port and fuser.
function namesPort(args: string[], port: string): boolean {
  if (!port) return false;
  const re = new RegExp(`^(.*[:=])?${port}(/tcp|/udp)?$`, "i");
  return args.some((a) => re.test(a));
}

const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const LAUNCHERS = new Set(["npx", "pnpx", "bunx"]);
const SCRIPTS = ["dev", "desktop", "start"];
// What a script runs to start a second Weft: free-port.cjs (frees Weft's port), `next dev` or `electron .`.
const LAUNCHES = /free-port\.cjs|\bnext dev\b|\belectron \./;

// The package scripts in Weft's folder that start a second Weft, read from its package.json so a new one is caught
// too: a fixed list missed `pnpm dev:web`, which a card's devservers tool ran and killed the server (2026-10-23).
export function launcherScripts(dir: string): Set<string> {
  try {
    const { scripts = {} } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    return new Set([...SCRIPTS, ...Object.keys(scripts).filter((name) => LAUNCHES.test(String(scripts[name])))]);
  } catch {
    return new Set(SCRIPTS);
  }
}

// A second Weft started in Weft's folder: its dev script frees Weft's port first, killing the server.
function startsWeft({ name, args, cwd }: Step, weft: WeftProcess): boolean {
  if (path.resolve(cwd) !== path.resolve(weft.dir)) return false;
  const [sub = "", script = ""] = args;
  // pnpm, yarn and bun run a script without `run` (`pnpm dev`); npm only `start` that way.
  if (RUNNERS.has(name)) {
    const scripts = launcherScripts(weft.dir);
    return sub === "start" || (sub === "run" ? scripts.has(script) : name !== "npm" && scripts.has(sub));
  }
  const tool = LAUNCHERS.has(name) ? path.basename(sub) : name;
  const rest = LAUNCHERS.has(name) ? args.slice(1) : args;
  return (tool === "next" && rest[0] === "dev") || (tool === "electron" && rest.includes("."));
}

const QUITS_WEFT = /quit\s+(app(lication)?\s+)?"?(Weft|Electron)\b/i;

// What one command would hit in Weft, or null; killsAnything says whether the line kills what lsof finds.
type Check = (s: Step, weft: WeftProcess, killsAnything: boolean) => string | null;

const CHECKS: Check[] = [
  (s, weft) => {
    const pid = s.name === "kill" ? killedPids(s.args).find((p) => weft.pids.includes(p)) : undefined;
    return pid ? `Weft's own process, pid ${pid}` : null;
  },
  (s, weft) => (s.name === "pkill" && pkillHits(s.args, weft) ? `\`pkill ${s.args.join(" ")}\` matches Weft's own processes` : null),
  (s, weft) => (s.name === "killall" && killallHits(s.args, weft) ? `\`killall ${s.args.join(" ")}\` matches Weft's own processes` : null),
  (s, weft, killsAnything) => {
    const portTool = ["fuser", "lsof", "kill-port"].includes(s.name) || s.args[0] === "kill-port" || s.args.some((a) => a.endsWith("free-port.cjs"));
    const kills = s.name !== "lsof" || killsAnything;
    return portTool && kills && namesPort(s.args, weft.port) ? `whatever listens on port ${weft.port}, which is Weft's server` : null;
  },
  (s, weft) => (startsWeft(s, weft) ? `a second Weft in ${weft.dir}, whose dev script frees port ${weft.port} first` : null),
  (s) => (s.name === "osascript" && QUITS_WEFT.test(s.args.join(" ")) ? "the Weft app" : null),
];

// What in Weft a command line would kill or restart, or null when it leaves Weft alone.
export function restartTarget(command: string, cwd: string, weft: WeftProcess): string | null {
  const all = steps(command, cwd);
  const killsAnything = all.some((s) => ["kill", "pkill", "killall"].includes(s.name));
  for (const s of all) {
    const hit = CHECKS.map((check) => check(s, weft, killsAnything)).find(Boolean);
    if (hit) return hit;
  }
  return null;
}

// Why a Bash command is turned away, or null to let it run.
export function restartVerdict(command: string, cwd: string, weft: WeftProcess, otherTurns: number): string | null {
  if (otherTurns < 1) return null;
  const target = restartTarget(command, cwd, weft);
  if (!target) return null;
  const turns = otherTurns === 1 ? "1 other turn is" : `${otherTurns} other turns are`;
  return (
    `This would stop or restart Weft itself (${target}). ${turns} running on the board right now, and a restart ` +
    "cuts every one of them off mid-work. Don't do it yourself: call mcp__board__restart_weft_when_idle, which restarts " +
    `Weft once those turns and yours have finished, and tell the user why it needs one. Your own project's dev server is fine to kill: target its port or pid, not Weft's${weft.port ? ` (port ${weft.port})` : ""}.`
  );
}

// The hook, given a count of the turns running on other cards.
export function restartGuard(otherTurns: () => number, weft: () => WeftProcess = weftProcess): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return Promise.resolve({});
    const command = (input.tool_input as { command?: unknown } | undefined)?.command;
    const why = typeof command === "string" ? restartVerdict(command, input.cwd, weft(), otherTurns()) : null;
    return Promise.resolve(
      why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {},
    );
  };
}

// For PreToolUse, beside the secret guard (lib/env.ts guardedCli).
export function restartGuardMatcher(otherTurns: () => number): HookCallbackMatcher {
  return { matcher: "Bash", hooks: [restartGuard(otherTurns)] };
}
