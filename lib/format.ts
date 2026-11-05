import { clip, shortToolName, timeAgo } from "@weft/client";
import type { CacheState, Card } from "./types";

// Display helpers shared by the server and the board UI.

// A thread is live while a turn runs or a permission request waits; a card in Needs you
// with a question (not a permission request) can be replied to and moved like any other.
export function isLive(card: Card) {
  return card.column === "running" || Boolean(card.pending);
}

// The display helpers with no app types behind them are @weft/client's, so the phone words things the same.
export { clip, shortToolName, timeAgo };

export function folderName(cwd: string) {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

// A steady hue (0-359) for a project name, so the same project always gets the same color.
export function projectHue(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

// "/me/app/.claude/worktrees/eager-x/src" -> "/me/app": the repo a Claude Code worktree folder belongs to,
// read off the path alone, so it works for worktrees that have since been deleted.
export function worktreeParent(cwd: string) {
  const match = /^(.+?)\/\.claude\/worktrees\/[^/]+(?:\/|$)/.exec(cwd);
  return match ? match[1] : undefined;
}

// What a tool call did, as a kind ("command", "read", "click"...), for the one-line summary of a run
// of tool calls. Browser tools from every source (Weft's pane, Claude's browser, Chrome, computer
// use) share one vocabulary, read from the tool name or its `action` input.
export function toolAction(name: string, input: Record<string, unknown> = {}): string {
  switch (name) {
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "command";
    case "Read":
      return "read";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Write":
      return "write";
    case "Grep":
    case "Glob":
    case "LS":
      return "search";
    case "WebSearch":
      return "web";
    case "WebFetch":
      return "fetch";
    case "Task":
    case "Agent":
      return "agent";
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "plan";
    case "AskUserQuestion":
      return "question";
    case "Skill":
      return "skill";
    case "ToolSearch":
      return "tools";
    case "SendMessage":
      return "message";
  }
  if (!name.startsWith("mcp__")) return `use:${name}`;
  const [, server = "", tool = ""] = name.split("__");
  if (/browser|chrome|computer|playwright|puppeteer|preview/i.test(server)) {
    const action = typeof input.action === "string" ? input.action : tool;
    if (/navigate|open_url|preview_start|tabs_create/.test(action)) return "open";
    if (/screenshot|zoom/.test(action)) return "screenshot";
    if (/click/.test(action)) return "click";
    if (/^(type|type_text|form_input)$/.test(action)) return "type";
    if (action === "key") return "key";
    if (/scroll/.test(action)) return "scroll";
    if (/resize/.test(action)) return "resize";
    if (/read_page|get_page_text|find/.test(action)) return "look";
    return "browser";
  }
  return `mcp:${server}__${tool}`;
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));

const PHRASES: Record<string, (n: number) => string> = {
  command: (n) => count(n, "ran a command", "ran # commands"),
  read: (n) => count(n, "read a file", "read # files"),
  edit: (n) => count(n, "edited a file", "edited # files"),
  write: (n) => count(n, "wrote a file", "wrote # files"),
  search: (n) => count(n, "searched the code", "searched # times"),
  web: (n) => count(n, "searched the web", "searched the web # times"),
  fetch: (n) => count(n, "fetched a page", "fetched # pages"),
  agent: (n) => count(n, "ran an agent", "ran # agents"),
  plan: () => "updated the plan",
  question: () => "asked you",
  skill: (n) => count(n, "loaded a skill", "loaded # skills"),
  tools: () => "loaded tools",
  message: (n) => count(n, "sent a message", "sent # messages"),
  open: (n) => count(n, "opened a page", "opened # pages"),
  screenshot: (n) => count(n, "took a screenshot", "took # screenshots"),
  click: (n) => count(n, "clicked", "clicked # times"),
  type: (n) => count(n, "typed", "typed # times"),
  key: (n) => count(n, "pressed a key", "pressed # keys"),
  scroll: (n) => count(n, "scrolled", "scrolled # times"),
  resize: () => "resized the browser",
  look: (n) => count(n, "read the page", "read the page # times"),
  browser: (n) => count(n, "used the browser", "used the browser # times"),
};

// File tools count the files they touched, not their calls: three edits to one file "edited a file".
const BY_TARGET = new Set(["read", "edit", "write"]);

// A server name readable enough to show, or undefined for the ids claude.ai connectors get.
function serverLabel(server: string) {
  return /^[0-9a-f]{8}-/.test(server) ? undefined : server.replace(/^plugin_[^_]+_/, "").replace(/_/g, " ");
}

function phrase(kind: string, n: number) {
  if (PHRASES[kind]) return PHRASES[kind](n);
  const [scope, rest = ""] = kind.split(":");
  const [server = "", tool] = rest.split("__");
  const label = scope === "mcp" ? (serverLabel(server) ?? tool ?? server) : rest;
  return count(n, `used ${label}`, `used ${label} # times`);
}

// "Pressed a key, resized the browser, opened 2 pages +2": what a run of tool calls did, in order of
// first appearance, with how many other kinds of thing it did.
export function describeToolRun(calls: { action: string; target?: string }[], show = 3) {
  const kinds = new Map<string, Set<string>>();
  calls.forEach((call, i) => {
    const targets = kinds.get(call.action) ?? new Set<string>();
    targets.add(BY_TARGET.has(call.action) && call.target ? call.target : String(i));
    kinds.set(call.action, targets);
  });
  const phrases = [...kinds].map(([kind, targets]) => phrase(kind, targets.size));
  const text = phrases.slice(0, show).join(", ");
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    more: Math.max(0, phrases.length - show),
  };
}

// How many words a card title should be. Titles aren't cut to it: one longer than this that you didn't
// type is rewritten by Haiku after the card's next turn (lib/retitle.ts), so it still reads as a sentence.
export const TITLE_WORDS = 6;
// The most characters a title keeps, so a pasted paragraph can't become one.
const MAX_TITLE_CHARS = 80;
const LEADING_EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u;

// Control and bidi-override characters: invisible in a title or a tag, and a name off the network (card.create's
// title and tags) could use them to garble a terminal log or read as another card.
export const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

// A card title as given, trimmed and on one line with no control characters, clipped only at MAX_TITLE_CHARS.
export function cleanTitle(input: string): string {
  const line = input.replace(CONTROL_CHARS, "").trim().replace(/\s+/g, " ");
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}

// The words in a title after its leading emoji.
export function titleWords(title: string): number {
  const trimmed = title.trim();
  const emoji = LEADING_EMOJI.exec(trimmed)?.[0] ?? "";
  return trimmed.slice(emoji.length).split(/\s+/).filter(Boolean).length;
}

// A card title from its prompt: the first line with words in it, without Markdown markup or pasted
// media. A prompt that's only media is named after its first file.
export function titleFromPrompt(prompt: string, max = 60) {
  const clean = (line: string) =>
    line
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "")
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/(\*\*|__|~~|`)/g, "")
      .replace(/(^|\s)[*_](\S)/g, "$1$2")
      .replace(/(\S)[*_](?=\s|$)/g, "$1")
      .trim();
  const line = prompt
    .split("\n")
    .filter((l) => !/^\s*(```|~~~|---+\s*$)/.test(l))
    .map(clean)
    .find(Boolean);
  if (line) {
    const short = cleanTitle(line);
    return short.length > max ? `${short.slice(0, max - 1).trimEnd()}…` : short;
  }
  const media = /!\[([^\]\n]*)\]/.exec(prompt)?.[1]?.trim();
  const named = media ? `Look at ${media}` : "New thread";
  return cleanTitle(named);
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// Whole minutes the prompt cache stays warm at `now` (unix ms), rounded up; 0 once it has gone cold.
export function cacheMinutesLeft(cache: CacheState, now: number) {
  return Math.max(0, Math.ceil((cache.at + cache.ttl * 1000 - now) / 60_000));
}

// "6:00am" or "fri 2:06pm", from unix seconds.
export function formatReset(resetsAt: number, now = Date.now()) {
  const d = new Date(resetsAt * 1000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  const sameDay = d.getTime() - now < 20 * 3600_000;
  return sameDay ? time : `${d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase()} ${time}`;
}

// Untyped JSON as text: strings as they are, numbers and booleans spelled out, anything else the fallback.
export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

// The first non-blank line, trimmed and clipped: what a card shows as its last line.
export function firstLine(text: string, max = 140) {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return clip(line, max);
}

// One short line for a tool call: its most telling argument, else the arguments as JSON.
export function summarizeInput(input: Record<string, unknown>) {
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "selector", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && value) return clip(value, 100);
  }
  const json = JSON.stringify(input);
  return json === "{}" ? "" : clip(json, 100);
}

// The BOARD STATUS stages in order (lib/settings.ts); a card shows how far along it is as a segmented bar.
export const STAGES = [
  "Planning",
  "Pre-build refactoring",
  "First shot",
  "Going deeper",
  "Polishing",
  "Post-build refactoring",
  "Cleaning up",
  "Done",
] as const;

// "First shot" -> 3 (of 8); unknown stages -> 0, so the bar stays empty instead of guessing.
export function stageStep(stage?: string) {
  if (!stage) return 0;
  const i = STAGES.findIndex((s) => s.toLowerCase() === stage.trim().toLowerCase());
  return i + 1;
}
