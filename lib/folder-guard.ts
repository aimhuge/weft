import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editedPath } from "./overlap";
import { allowedFolders } from "./settings";
import { DATA_DIR, getCard } from "./store";
import { worktreesRoot } from "./worktrees";
import type { PromptReason } from "./types";

// The folder gate in every board thread: a thread works in its card's project folder, and the PreToolUse hook
// below asks before a file tool or a Bash command touches anywhere else, whether or not macOS would have
// refused it. Allow once, for this card (Card.readScope, also the CLI's own additionalDirectories) or always
// (settings allowedFolders). It answers "ask", so the user sees a permission prompt with an "Outside project"
// chip (components/PermissionInput.tsx); once allowed, read-only tools in that folder skip the CLI's own
// working-directory prompt too (grantedRead, used by canUseTool in lib/runner-session.ts).

// Where a thread may go with no question: Weft's own folder (pages, attachments), the CLI's settings, temp dirs,
// devices and the system's tool and library paths. home is a parameter so tests can use their own.
const SYSTEM = ["/dev", "/usr", "/bin", "/sbin", "/opt", "/etc", "/private/etc", "/System", "/Library", "/Applications", "/tmp", "/private/tmp"];

export interface Ground {
  home: string;
  free: string[];
  // Inside a free folder but not free: other isolated cards' worktrees (~/.weft/worktrees), outside your project like any other.
  fenced?: string[];
}

const ground = (): Ground => {
  const home = os.homedir();
  // ~/.claude is not free: the CLI's own transcripts hold every secret value a thread ever saw, in
  // plaintext, and the secret guard turns them away (2026-10-28).
  return { home, free: [DATA_DIR, os.tmpdir(), ...SYSTEM], fenced: [worktreesRoot()] };
};

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);
const GATED = "Read|Edit|MultiEdit|Write|NotebookEdit|Glob|Grep|LS|Bash";
// A path in a Bash command. Quoted, it runs to its closing quote, spaces and all ("/Users/me/My Drive/app": a
// project in Google Drive used to read as /Users/me/My, outside, so every command asked); bare, it ends at a
// space, quote or operator, and a backslash escapes one (~/My\ Drive).
const HEAD = String.raw`(?:~|\$HOME|\$\{HOME\})(?=\/|$)|\.{1,2}\/|\/`;
const BARE = String.raw`(?:\\.|[^\s"'\`;|&<>()\\])`;
const BASH_PATH = new RegExp(
  String.raw`(?:^|[\s=(<>|;&])"((?:${HEAD})[^"]*)"|(?:^|[\s=(<>|;&])'((?:${HEAD})[^']*)'|(?:^|[\s"'=(<>|;&])((?:~|\$HOME|\$\{HOME\})(?:\/${BARE}*)?|\.{1,2}\/${BARE}*|\/${BARE}+)`,
  "g",
);
const bashPaths = (command: string) =>
  [...command.matchAll(BASH_PATH)].map((m) => m[1] ?? m[2] ?? (m[3] as string).replace(/\\(.)/g, "$1"));
const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"];

// The real path of a path that may not exist yet: its nearest existing ancestor, resolved, plus the rest.
function realish(p: string): string {
  let dir = p;
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(dir), ...rest.reverse());
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return p;
      rest.push(path.basename(dir));
      dir = parent;
    }
  }
}

function inside(child: string, dir: string) {
  const rel = path.relative(dir, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function expand(token: string, cwd: string, home: string) {
  return path.resolve(cwd, token.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home));
}

export const tilde = (p: string, home = os.homedir()) => (inside(p, home) ? path.join("~", path.relative(home, p)) : p);

// The paths a tool call names: its file or folder argument, or for Bash every absolute, ~/ and ../ token in
// the command (a heuristic: a path a script builds at run time isn't visible).
export function pathsOf(toolName: string, input: Record<string, unknown>): string[] {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  if (toolName === "Bash") return bashPaths(str(input.command) ?? "");
  if (toolName === "Glob") {
    const pattern = str(input.pattern);
    const fixed = pattern && /^[/~]/.test(pattern) ? path.dirname((pattern.split(/[*?[{]/)[0] ?? "") + "x") : undefined;
    return [str(input.path), fixed].filter((p): p is string => Boolean(p));
  }
  if (toolName === "Grep" || toolName === "LS") return [str(input.path)].filter((p): p is string => Boolean(p));
  const edited = editedPath(toolName, input) ?? str(input.file_path);
  return edited ? [edited] : [];
}

// The folder to grant for a path: its project (nearest ancestor with a .git or package.json, below home),
// else the folder itself, else the file's folder.
function grantRoot(abs: string, home: string): string {
  let start = abs;
  try {
    if (!fs.statSync(abs).isDirectory()) start = path.dirname(abs);
  } catch {
    start = path.dirname(abs);
  }
  // A folder that isn't there yet, straight under home or /Users, is the folder itself, never home.
  if (start === home || ["/", "/Users", "/Volumes"].includes(start)) start = abs;
  for (let dir = start; dir !== home && dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
  }
  return start;
}

export interface Outside {
  directory: string;
  token: string;
  verb: string;
}

const verbOf = (toolName: string) => (READ_TOOLS.has(toolName) ? "read" : toolName === "Bash" ? "use" : "change");

// The first folder a tool call reaches that's neither the project, one the user granted, nor a system path.
export function outsideFolder(toolName: string, input: Record<string, unknown>, cwd: string, granted: string[], at: Ground = ground()): Outside | undefined {
  const mine = [cwd, ...granted].map(realish);
  const free = at.free.map(realish);
  const fenced = (at.fenced ?? []).map(realish);
  // A Bash command's paths only count under the user's own files; /\d+/ in a script isn't a folder.
  const userAreas = [at.home, "/Users", "/Volumes"].map(realish);
  for (const token of pathsOf(toolName, input)) {
    const abs = realish(expand(token, cwd, at.home));
    if (mine.some((r) => inside(abs, r))) continue;
    if (free.some((r) => inside(abs, r)) && !fenced.some((f) => inside(abs, f))) continue;
    if (toolName === "Bash" && !userAreas.some((a) => inside(abs, a))) continue;
    return { directory: grantRoot(abs, at.home), token, verb: verbOf(toolName) };
  }
  return undefined;
}

// What the user has granted a card: its read scope and the folders allowed for every card.
const grantedFor = (cardId: string | undefined) => [...(getCard(cardId ?? "")?.readScope ?? []), ...allowedFolders()];

// A read-only tool call whose every path lies in a folder the user granted: allowed with no CLI prompt.
export function grantedRead(toolName: string, input: Record<string, unknown>, cwd: string, cardId: string | undefined): boolean {
  if (!READ_TOOLS.has(toolName)) return false;
  const granted = grantedFor(cardId).map(realish);
  const home = os.homedir();
  const paths = pathsOf(toolName, input).map((t) => realish(expand(t, cwd, home)));
  return paths.length > 0 && paths.every((p) => granted.some((g) => inside(p, g)) || inside(p, realish(cwd)));
}

// What each pending call asked, by tool use id, from PreToolUse to canUseTool, which words the prompt with it.
const PENDING_CAP = 200;
const pending = new Map<string, { question: string; why: PromptReason; folder: { directory: string; token: string } }>();

// The prompt for a tool call the hook asked about: its title, why, and the folder the buttons grant; undefined otherwise.
export function folderAsk(toolUseId: string | undefined) {
  return toolUseId ? pending.get(toolUseId) : undefined;
}

export function folderGuard(cardId: () => string | undefined): HookCallback {
  return (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse" || !toolUseId) return Promise.resolve({});
    const card = getCard(cardId() ?? "");
    if (!card || card.role === "copilot") return Promise.resolve({});
    const out = outsideFolder(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, input.cwd, grantedFor(card.id));
    if (!out) return Promise.resolve({});
    const where = tilde(out.directory);
    const question = `Outside the project: ${out.verb} ${where}`;
    pending.set(toolUseId, { question, why: { category: "outside", detail: `${where} isn't in this card's project folder` }, folder: { directory: out.directory, token: where } });
    if (pending.size > PENDING_CAP) pending.delete(pending.keys().next().value as string);
    return Promise.resolve({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: question } });
  };
}

// For lib/env.ts guardedCli: the session's card id, read at each call, since a warm spare gets its card later.
export function folderGuardMatcher(cardId: () => string | undefined): HookCallbackMatcher {
  return { matcher: GATED, hooks: [folderGuard(cardId)] };
}
