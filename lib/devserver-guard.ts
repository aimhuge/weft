import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { home, shellScriptIndex } from "./restart-guard";
import { stripPrefixes, unwrapEnv } from "./secret-guard";
import { parseShell } from "./shell-parse";

// A dev server a thread starts from Bash in the background lives outside Weft's tracker: no Services row, no idle stop,
// and it outlives the thread (2026-11-15: three such Next dev servers, one two days old, held 18 GB and pushed a 16 GB
// Mac to 20 GB of swap). DEVSERVERS_PROMPT already asks threads to use mcp__devservers__start; this PreToolUse hook
// makes it a rule. It turns away a long-running dev server sent to the background or detached: Bash run_in_background,
// a lone `&` (a `( … ) &` group too), nohup, setsid, disown, screen -dm, tmux -d, pm2/forever start, and any
// dev server under Monitor (always in the background). A dev server in the foreground is left alone: Bash's timeout
// ends it with the call, so a smoke test (`timeout 20 pnpm dev`) is fine. One-shot commands (next build, pnpm test)
// never match. docs/architecture/thread-guards.md#dev-server-guard.

// package.json scripts that start a server (as lib/dev-commands.ts reads them), with `dev:web` and the like.
const SCRIPT = /^(dev|start|serve|develop|preview|storybook)(:.+)?$/;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const EXEC = new Set(["exec", "dlx", "x"]);
const PM_VALUED = new Set(["-C", "--dir", "--filter", "-F", "--prefix", "--cwd", "-w", "--workspace"]);
const RUNNER_VALUED = new Set(["-p", "--package", "-c", "--call"]);

const sub = (...names: string[]) => (args: string[]) => names.includes(args[0] ?? "");
const always = () => true;
const bareOr = (...names: string[]) => (args: string[]) => !args[0] || args[0].startsWith("-") || names.includes(args[0]);

// Asking a server CLI its version or usage starts nothing.
const HARMLESS = new Set(["-v", "--version", "-V", "-h", "--help"]);

// A server-starting CLI, by name, and whether these args start the server rather than build or test.
const TOOLS: Record<string, (args: string[]) => boolean> = {
  next: sub("dev", "start"),
  vite: bareOr("dev", "serve", "preview"),
  astro: sub("dev", "preview", "start"),
  nuxt: sub("dev", "preview", "start"),
  nuxi: sub("dev", "preview", "start"),
  remix: sub("dev"),
  expo: sub("start"),
  "react-native": sub("start"),
  "react-scripts": sub("start"),
  webpack: sub("serve"),
  "webpack-dev-server": always,
  wrangler: sub("dev"),
  vercel: sub("dev"),
  netlify: sub("dev"),
  ng: sub("serve", "s"),
  storybook: sub("dev", "start"),
  "start-storybook": always,
  gatsby: sub("develop", "serve"),
  parcel: (args) => bareOr("serve")(args) || /\.html?$/.test(args[0] as string),
  "vue-cli-service": sub("serve"),
  docusaurus: sub("start", "serve"),
  nodemon: always,
  "http-server": always,
  "live-server": always,
  rails: sub("server", "s"),
  flask: sub("run"),
  uvicorn: always,
  hugo: sub("server", "serve"),
  jekyll: sub("serve"),
};

// The words after a command's options, past the value each valued option takes.
function afterOptions(args: string[], valued: Set<string>): string[] {
  let i = 0;
  while (args[i]?.startsWith("-")) i += valued.has(args[i] as string) ? 2 : 1;
  return args.slice(i);
}

// `npm run dev`, `pnpm --filter web dev`, `yarn start`, `bun run dev:api`, `pnpm exec vite`.
function packageScript(args: string[]): boolean {
  const rest = afterOptions(args, PM_VALUED);
  const [verb = "", next = ""] = rest;
  if (verb === "run" || verb === "run-script") return SCRIPT.test(next);
  if (EXEC.has(verb)) return startsServer(rest.slice(1));
  return SCRIPT.test(verb);
}

// Whether a command's words (prefixes and env already stripped) start a long-running dev server.
export function startsServer(words: string[]): boolean {
  const [first = "", ...args] = words;
  if (args.some((a) => HARMLESS.has(a))) return false;
  // `node node_modules/vite/bin/vite.js` runs vite.
  const name = path.basename(first).replace(/\.[cm]?js$/, "");
  if (PACKAGE_MANAGERS.has(name)) return packageScript(args);
  if (RUNNERS.has(name)) return startsServer(afterOptions(args, RUNNER_VALUED));
  if (name === "turbo") return (args[0] === "run" ? SCRIPT.test(args[1] ?? "") : SCRIPT.test(args[0] ?? ""));
  if (name === "node") return startsServer(args.filter((a) => !a.startsWith("-")));
  if (/^python[\d.]*$/.test(name)) return args.some((a) => path.basename(a) === "manage.py") && args.includes("runserver");
  return TOOLS[name]?.(args) ?? false;
}

// Past options where a cluster like screen's `-dmS name` takes the next word as its value.
function afterClusters(args: string[], valued: RegExp): string[] {
  let i = 0;
  while (args[i]?.startsWith("-")) i += valued.test(args[i] as string) ? 2 : 1;
  return args.slice(i);
}

// Commands that detach what they run, with how many words of their own (options included) to skip first.
const DETACHERS: Record<string, (args: string[]) => string[] | null> = {
  setsid: (args) => afterOptions(args, new Set()),
  daemonize: (args) => afterOptions(args, new Set(["-a", "-c", "-e", "-o", "-p", "-l", "-u"])),
  screen: (args) => (args.some((a) => /^-[a-zA-Z]*d/.test(a)) ? afterClusters(args, /^-([a-zA-Z]*S|c|t)$/) : null),
  tmux: (args) => (args.includes("-d") ? afterClusters(args.slice(1), /^-[sncxyetF]$/) : null),
  pm2: (args) => (args[0] === "start" ? args.slice(1).filter((a) => a !== "--") : null),
  forever: (args) => (args[0] === "start" ? args.slice(1) : null),
};

// `timeout 30 pnpm dev`, `gtimeout -s INT 20 vite`: the command it bounds.
function unwrapTimeout(words: string[]): string[] {
  const name = path.basename(words[0] ?? "");
  if (name !== "timeout" && name !== "gtimeout") return words;
  return afterOptions(words.slice(1), new Set(["-s", "--signal", "-k", "--kill-after"])).slice(1);
}

export interface Scan {
  // The dev server the line starts, as written, with the folder it would start in.
  server?: { command: string; cwd: string };
  // Whether anything on the line is sent to the background or detached.
  detached: boolean;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);

function scanWords(raw: string[], cwd: string, scan: Scan, depth: number) {
  if (raw.includes("nohup")) scan.detached = true;
  let words = unwrapTimeout(unwrapEnv(stripPrefixes(raw)));
  const name = path.basename(words[0] ?? "");
  if (name === "disown") scan.detached = true;
  const detach = DETACHERS[name];
  const inner = detach?.(words.slice(1));
  if (inner) {
    scan.detached = true;
    // tmux and screen take the command as one string a shell runs.
    if (inner.length === 1) return scanLine(inner.join(" "), cwd, scan, depth + 1);
    words = unwrapTimeout(unwrapEnv(stripPrefixes(inner)));
  }
  if (!scan.server && startsServer(words)) scan.server = { command: words.join(" "), cwd };
  if (SHELLS.has(path.basename(words[0] ?? ""))) {
    const at = shellScriptIndex(words.slice(1));
    if (at >= 0) scanLine(words[at + 1] ?? "", cwd, scan, depth + 1);
  }
}

// Walks a command line the way the shell would: `cd` carries to later commands, `sh -c`, heredocs fed to a shell
// and `$( )` are read too.
export function scanLine(command: string, cwd: string, scan: Scan = { detached: false }, depth = 0): Scan {
  if (depth > 5) return scan;
  const { commands, nested } = parseShell(command);
  let here = cwd;
  for (const c of commands) {
    if (c.background) scan.detached = true;
    const words = stripPrefixes(c.words);
    if (words[0] === "cd") {
      here = path.resolve(here, home(words[1] ?? "~"));
      continue;
    }
    scanWords(c.words, here, scan, depth);
    if (SHELLS.has(path.basename(words[0] ?? ""))) for (const script of c.stdin) scanLine(script, here, scan, depth + 1);
  }
  for (const n of nested) scanLine(n, here, scan, depth + 1);
  return scan;
}

// "--port 4002", "-p 4002", "PORT=4002", "localhost:4002" → the url it would answer on.
export function guessUrl(command: string): string | undefined {
  const port = /(?:--port[= ]|-p\s+|\bPORT=|localhost:)(\d{2,5})\b/.exec(command)?.[1];
  return port ? `http://localhost:${port}` : undefined;
}

// Why a Bash or Monitor call is turned away, or null to let it run.
export function devServerVerdict(tool: string, input: { command?: unknown; run_in_background?: unknown }, cwd: string): string | null {
  if (typeof input.command !== "string") return null;
  const scan = scanLine(input.command, cwd);
  if (!scan.server) return null;
  const detached = tool === "Monitor" || input.run_in_background === true || scan.detached;
  if (!detached) return null;
  const { command, cwd: dir } = scan.server;
  const url = guessUrl(input.command);
  const how = tool === "Monitor" ? "under Monitor" : "in the background";
  return (
    `Refused: \`${command}\` started ${how} would run outside Weft's tracker: no row in the Services drawer, no idle ` +
    `stop, and it outlives this thread (three such dev servers once held 18 GB of a 16 GB Mac). Call ` +
    `mcp__devservers__start instead, with command "${command}", cwd "${dir}"` +
    `${url ? ` and url "${url}"` : " and the url it answers on"}. ` +
    "Weft keeps it running, shows it in Services, stops it after 30 idle minutes and starts it again when a thread or " +
    "the review tour asks. A foreground run bounded by a timeout (a quick smoke test) is still allowed."
  );
}

export const devServerGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse") return Promise.resolve({});
  const why = devServerVerdict(input.tool_name, input.tool_input ?? {}, input.cwd);
  return Promise.resolve(why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {});
};

// For PreToolUse, beside the check and restart guards (lib/guards/hooks.ts).
export const DEVSERVER_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Bash|Monitor", hooks: [devServerGuard] };
