import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { scriptsAbove } from "./check-guard";
import { SERVER_RE } from "./dev-commands";
import { steps, type Step } from "./restart-guard";

// A card testing a React Native app booted its simulator with `xcrun simctl boot` and ran Metro with Bash in the
// background (2026-11-16): Metro hit the background limit and stopped, the app's switches stopped answering
// (127.0.0.1:8081 refused), and the user couldn't watch the device in the pane. SIMULATOR_PROMPT and
// DEVSERVERS_PROMPT already said how; this PreToolUse hook makes it so. It turns away, from Bash:
// - booting a device from the shell (`xcrun simctl boot`, `open -a Simulator`, `emulator -avd`): mcp__simulator__boot;
// - starting Metro (`expo start`, `react-native start`, `metro serve`), foreground or background: mcp__devservers__start;
// - `expo run:ios|android` / `react-native run-ios|android` that would start their own Metro in the call;
// - any dev server sent to the background (`run_in_background`): mcp__devservers__start.
// Package scripts are read through (`pnpm dev` runs its `dev` script), so a script can't hide one.

export type SimulatorMisuse = "boot" | "metro" | "run" | "background";

const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const RUNNER_VALUED = new Set(["-p", "--package", "-c", "--call"]);
const DIR_OPTIONS = new Set(["-C", "--dir", "--prefix", "--cwd"]);
const HARMLESS = new Set(["-h", "--help", "-v", "--version", "-list-avds", "-help", "-version"]);
const XCRUN_VALUED = new Set(["--sdk", "-sdk", "--toolchain", "-toolchain"]);

interface Tool {
  tool: string;
  args: string[];
}

// A package manager's own options before its command word, with the folder `-C dir` moves it to.
function managerArgs(args: string[], cwd: string): { rest: string[]; dir: string } {
  let i = 0;
  let dir = cwd;
  while (args[i]?.startsWith("-")) {
    const a = args[i] as string;
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (DIR_OPTIONS.has(flag)) {
      dir = path.resolve(cwd, eq > 0 ? a.slice(eq + 1) : (args[i + 1] ?? "."));
      i += eq > 0 ? 1 : 2;
    } else i++;
  }
  return { rest: args.slice(i), dir };
}

// `npx --yes expo start`: the binary past the runner's own options.
function runnerLeaf(args: string[]): Tool {
  let i = 0;
  while (args[i]?.startsWith("-")) i += RUNNER_VALUED.has(args[i] as string) ? 2 : 1;
  const [tool = "", ...rest] = args.slice(i);
  return { tool: path.basename(tool), args: rest };
}

// `pnpm exec expo start`, `pnpm dev` (its script, read through), `yarn expo start` (the package's own binary).
function managerLeaves(s: Step, depth: number): Tool[] {
  const { rest, dir } = managerArgs(s.args, s.cwd);
  const [word = "", ...after] = rest;
  if (["exec", "dlx", "x"].includes(word)) return leaves({ name: after[0] ?? "", args: after.slice(1), cwd: dir }, depth);
  const run = word === "run" || word === "run-script";
  const body = scriptsAbove(dir)?.[run ? (after[0] ?? "") : word];
  if (body !== undefined) return depth < 3 ? steps(body, dir).flatMap((inner) => leaves(inner, depth + 1)) : [];
  return run ? [] : [{ tool: path.basename(word), args: after }];
}

// What a step really runs: past npx and `pnpm exec`, and through the package script `pnpm dev` names.
export function leaves(s: Step, depth = 0): Tool[] {
  const base = path.basename(s.name);
  if (RUNNERS.has(base)) return [runnerLeaf(s.args)];
  if (PACKAGE_MANAGERS.has(base)) return managerLeaves(s, depth);
  if (base === "node") {
    const [script = "", ...args] = s.args.filter((a) => !a.startsWith("-"));
    return [{ tool: path.basename(script).replace(/\.(c|m)?js$/, ""), args }];
  }
  return [{ tool: base, args: s.args }];
}

function boots({ tool, args }: Tool): boolean {
  if (tool === "xcrun") {
    let i = 0;
    while (args[i]?.startsWith("-")) i += XCRUN_VALUED.has(args[i] as string) ? 2 : 1;
    return args[i] === "simctl" && args[i + 1] === "boot";
  }
  if (tool === "simctl") return args[0] === "boot";
  if (tool === "open") {
    return args.some(
      (a, i) =>
        /(^|\/)Simulator(\.app)?\/?$/.test(a) && (args[i - 1] === "-a" || a.endsWith(".app") || a.endsWith(".app/")) ||
        (args[i - 1] === "-b" && a === "com.apple.iphonesimulator"),
    );
  }
  if (tool === "emulator") return args.some((a) => a === "-avd" || a.startsWith("@"));
  return false;
}

const startsMetro = ({ tool, args }: Tool) =>
  (["expo", "expo-cli", "react-native"].includes(tool) && args[0] === "start") || (tool === "metro" && ["serve", "start"].includes(args[0] ?? ""));

const runsWithBundler = ({ tool, args }: Tool) =>
  (tool === "expo" && /^run:(ios|android)$/.test(args[0] ?? "") && !args.includes("--no-bundler")) ||
  (tool === "react-native" && /^run-(ios|android)$/.test(args[0] ?? "") && !args.includes("--no-packager"));

const servesInBackground = ({ tool, args }: Tool) => SERVER_RE.test([tool, ...args].join(" "));

// What a Bash command does wrong with a simulator or a dev server, or null to let it run.
export function simulatorMisuse(command: string, cwd: string, background = false): SimulatorMisuse | null {
  const all = steps(command, cwd).flatMap((s) => leaves(s));
  const tools = all.filter((t) => !t.args.some((a) => HARMLESS.has(a)));
  if (tools.some(boots)) return "boot";
  if (tools.some(startsMetro)) return "metro";
  if (tools.some(runsWithBundler)) return "run";
  if (background && tools.some(servesInBackground)) return "background";
  return null;
}

const KEEPS_IT =
  "Weft keeps it running after this thread's CLI closes, lists it in the Services drawer, and the user can stop it there. " +
  "A Bash call holds the turn until it times out, and one sent to the background stops when its time limit runs out " +
  "(2026-11-16: Metro stopped after 2 hours and the app on the simulator stopped answering).";

export const SIMULATOR_GUARD_WHY: Record<SimulatorMisuse, string> = {
  boot:
    "Refused: boot simulators and emulators with mcp__simulator__boot, not from the shell (`xcrun simctl boot`, " +
    "`open -a Simulator`, `emulator -avd`). mcp__simulator__list_devices names them; boot waits until the device is " +
    "ready and opens Simulator.app on it. Then mcp__simulator__install and launch the app, and call " +
    "mcp__simulator__watch so the user sees the device live in the browser pane and can tap it too.",
  metro:
    "Refused: start Metro with mcp__devservers__start (command `npx expo start` or `npx react-native start`, url " +
    `http://localhost:8081), not Bash. ${KEEPS_IT}`,
  run:
    "Refused: `expo run:ios|android` and `react-native run-ios|android` start their own Metro inside this Bash call and " +
    "may boot a device Weft didn't. Boot with mcp__simulator__boot, start Metro with mcp__devservers__start, then build " +
    'and install with `npx expo run:ios --no-bundler --device "<device name>"` (plain React Native: ' +
    "`npx react-native run-ios --no-packager --udid <id>`).",
  background: `Refused: start the dev server with mcp__devservers__start, not Bash run_in_background. ${KEEPS_IT}`,
};

export const simulatorGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return Promise.resolve({});
  const call = (input.tool_input ?? {}) as { command?: unknown; run_in_background?: unknown };
  const misuse = typeof call.command === "string" ? simulatorMisuse(call.command, input.cwd, call.run_in_background === true) : null;
  if (!misuse) return Promise.resolve({});
  return Promise.resolve({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: SIMULATOR_GUARD_WHY[misuse] },
  });
};

// For PreToolUse, beside the check and restart guards (lib/guards/hooks.ts).
export const SIMULATOR_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Bash", hooks: [simulatorGuard] };
