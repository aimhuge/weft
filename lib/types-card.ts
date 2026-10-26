// Card, column, project and board-event types used across the app.

import type { Effort, LoginView } from "./types-settings";
import type { PendingElicitation, Question, ThreadItem } from "./types-thread";
import type { Card } from "./types-card-detail";
import type { EditPreview } from "./edit-preview";

export const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "running", label: "Running" },
  { id: "needs_you", label: "Needs you" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
] as const;

// The copilot is one long-lived thread with this fixed id, kept off the board.
export const COPILOT_ID = "copilot";

export type Column = (typeof COLUMNS)[number]["id"];

export type Backend = "claude" | "puku" | "codex" | "goose";
export const BACKEND_LABELS: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli", codex: "Codex", goose: "Goose" };
// The short name, for a label that sits beside something else ("Sonnet 5.5 (Claude)").
export const BACKEND_SHORT: Record<Backend, string> = { claude: "Claude", puku: "Puku", codex: "Codex", goose: "Goose" };
// bypassPermissions is "YOLO": every tool runs without asking.
export type PermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions";
export const MODES: PermissionMode[] = ["default", "acceptEdits", "auto", "bypassPermissions"];

// How the pickers (new thread, thread header, card menu) name each mode, loosest first.
export const MODE_OPTIONS: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "bypassPermissions", label: "YOLO", hint: "Runs every tool without asking" },
  { id: "auto", label: "Auto", hint: "A classifier approves or blocks; Weft asks you about blocks" },
  { id: "acceptEdits", label: "Accept edits", hint: "Edits files freely, asks before commands" },
  { id: "default", label: "Ask me", hint: "Asks before each tool" },
];

export function permissionOptions(backend: Backend) {
  if (backend !== "codex") return MODE_OPTIONS.filter((m) => backend === "claude" || m.id !== "bypassPermissions");
  return [
    { id: "bypassPermissions", label: "Full access", hint: "Runs commands and writes outside the project without approval" },
    { id: "auto", label: "Auto review", hint: "Codex reviews command approvals inside the project" },
    { id: "acceptEdits", label: "Workspace write", hint: "Can edit this project; Codex commands stay sandboxed" },
    { id: "default", label: "Read only", hint: "Can inspect files without changing them" },
  ] satisfies { id: PermissionMode; label: string; hint: string }[];
}

// A mode Claude Code recorded (or a setting) as the closest one Weft runs; undefined if unknown.
// "plan" only reads, so it maps to "default", the mode that asks before anything changes.
export function toPermissionMode(raw: unknown): PermissionMode | undefined {
  if (MODES.includes(raw as PermissionMode)) return raw as PermissionMode;
  if (raw === "plan" || raw === "dontAsk") return "default";
  return undefined;
}

// One plan rate-limit window: how much is used (0-100) and when it resets (unix seconds).
export interface LimitWindow {
  used: number;
  resetsAt?: number;
}

// The prompt cache after the thread's last request: when it went out (unix ms), how long the cache
// lives after it (seconds), the share of it read from cache (0-100), and its size in tokens, which is
// what the next request sends again at full price once the cache has gone cold.
export interface CacheState {
  at: number;
  ttl: number;
  hit: number;
  tokens: number;
}

// What the thread panel's status strip shows (see components/StatusStrip.tsx).
export interface CardStats {
  // The model that cost the most last turn (a subagent's, sometimes).
  model?: string;
  // The thread's own model and effort, from its CLI's init (the header's chip; lib/cli-defaults.ts).
  runsOn?: { model: string; effort?: Effort };
  // The folder's git branch, when it is a repo.
  branch?: string;
  // Share of the model's context window the last turn filled, 0-100.
  contextUsed?: number;
  tokens?: number;
  // Lines added and removed in the folder's working tree (git diff against HEAD).
  added?: number;
  removed?: number;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  cache?: CacheState;
}

// A message written now and sent to the thread later, at `at` (unix ms).
export interface ScheduledMessage {
  id: string;
  text: string;
  at: number;
  // Sent while a restart waited for the running threads (lib/restart-when-idle.ts): it goes out once Weft is back.
  afterRestart?: boolean;
  // Sent while the thread was mid-turn (a page's link, a failed commit's note): it goes out as that turn ends.
  afterTurn?: boolean;
  // Held because the cap on running threads was reached (lib/thread-slots.ts): it goes out when a slot frees, oldest first.
  forSlot?: boolean;
  // A re-run of the last message (a retry or a limit resume): it is already in the thread, so it goes out without an echo.
  quiet?: boolean;
}

// A thread's tour of what it built, for the user to step through in Review (see lib/review.ts).
export interface ReviewStep {
  title: string;
  // What to try and what should happen.
  look?: string;
  // The page for this step: a path on the plan's url, or a full URL.
  path?: string;
}

export interface ReviewPlan {
  // Where the running web app is; without it the steps are read-only.
  url?: string;
  // The shell command that starts that app (run in the card's folder), so Weft can start it and keep it up.
  dev?: string;
  steps: ReviewStep[];
}

export interface DevServerStatus {
  state: "stopped" | "starting" | "running" | "failed";
  command?: string;
  // Whether the plan's url answers right now, whoever started it.
  reachable: boolean;
  // The last lines the server printed.
  log: string;
}

// One dev server (the Services drawer and mcp__devservers__status): a Weft-started run (lib/devserver.ts) or a background
// shell task threads started the old way (lib/tasks.ts isDevServerTask). Newest first.
export interface DevServerEntry {
  cardId: string;
  title?: string;
  cwd: string;
  command: string;
  url?: string;
  state: DevServerStatus["state"];
  startedAt: number;
  source: "weft" | "thread";
  // Set when source is "thread", so the drawer can stop the right one.
  taskId?: string;
}

export interface Project {
  path: string;
  lastUsedAt: number;
  // Pinned from the project's right-click menu: always a chip in the project bar, never dropped from the list.
  pinned?: boolean;
  // Hidden from the bar ("Hide from Bar"): its chip goes until the folder is used again; "More" still lists it.
  hidden?: boolean;
}

// When an automation runs its skill: as a thread starts, when you move a card to Review or Done, or
// when a prompt you send matches the rule's pattern.
export type AutomationTrigger = "start" | "review" | "done" | "prompt-matches";

export const AUTOMATION_TRIGGERS: { id: AutomationTrigger; label: string }[] = [
  { id: "start", label: "a thread starts" },
  { id: "review", label: "you move a card to Review" },
  { id: "done", label: "you move a card to Done" },
  { id: "prompt-matches", label: "a prompt matches" },
];

// "When <on>, run the skill <skill>" (see lib/automations.ts).
export interface Automation {
  id: string;
  on: AutomationTrigger;
  // What follows the slash, e.g. "weft:done" for Weft's own skill or "done" for one in ~/.claude/skills.
  skill: string;
  // Regex source, matched case-insensitively; only the "prompt-matches" trigger reads it.
  pattern?: string;
}

export interface SkillInfo {
  // What follows the slash when running it.
  name: string;
  description: string;
  // weft: ships with Weft (plugin/skills); user: ~/.claude/skills; project: <folder>/.claude/skills.
  source: "weft" | "user" | "project";
}

// A Claude Code plugin (/plugin install) a thread can be given or not, as a whole (lib/skill-library.ts).
export interface PluginInfo {
  // "name@marketplace", the key Claude Code's enabledPlugins setting takes.
  id: string;
  name: string;
  // How many skills it brings.
  skills: number;
  description: string;
}

// One row of the Skills drawer or a card's ✦ menu (lib/skill-set-actions.ts).
export interface SkillSetRow {
  kind: "skill" | "plugin";
  // A skill's name, or a plugin's id ("posthog@posthog").
  name: string;
  // A plugin's short name.
  label?: string;
  description: string;
  source: SkillInfo["source"] | "plugin";
  // A plugin's skill count.
  skills?: number;
  // On in the project's default set.
  inProject: boolean;
  // On for this card (the project's value when there's no card).
  on: boolean;
  // The card differs from its project here.
  changedHere: boolean;
}

export interface SkillSetView {
  rows: SkillSetRow[];
  // False until the project's set has been seeded from its threads' usage; until then every row is on.
  seeded: boolean;
}

export interface PendingPermission {
  id: string;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  // Set when the agent asked questions instead of asking to use a tool.
  questions?: Question[];
  // A folder outside the card's project that a question names, found on the server (lib/read-scope.ts
  // stats the disk, so the client can't run it); the form offers "Read from <token>" for it.
  readScope?: { directory: string; token: string };
  // The page with the options' previews (lib/question-preview.ts); open it at #<question>-<option>.
  previewUrl?: string;
  // What a held Edit/Write would change, readable (lib/edit-preview.ts).
  edit?: EditPreview;
  // Why the prompt came up: a symbol-claim clash (lib/claims.ts clashWhy) or the card's permission mode.
  why?: PromptReason;
  // The user chose Wait: Weft answers it once the holder lets go of the code.
  waiting?: boolean;
  // Set when an MCP server asked instead of a tool (lib/elicitation.ts): Accept / Decline and its form.
  elicitation?: PendingElicitation;
}

// A permission prompt's reason, as a category chip and a short detail (components/PermissionInput.tsx).
// same-code / overlap / whole-file: another busy card's claim (lib/claims.ts); mode: the card's permission mode;
// outside: a folder beyond the card's project (lib/folder-guard.ts); classifier: auto mode's classifier denied
// the call itself, and the prompt offers a one-time retry (lib/classifier-denial.ts).
export interface PromptReason {
  category: "same-code" | "overlap" | "whole-file" | "mode" | "outside" | "classifier";
  detail: string;
  // For a clash: the card holding the claim and its claim key, so Wait can watch for its release (lib/permission-wait.ts).
  // Its emoji and thumbnail show beside the prompt; first: the user put it first, so this card yields (lib/precedence.ts).
  holder?: { id: string; title: string; claim: string; emoji?: string; thumb?: string; first?: true };
}

// Card and CardIssue live in lib/types-card-detail.ts to keep this file under the line limit.
// Re-exported here so `./types` and direct importers keep working.
export type { Card } from "./types-card-detail";
export type { CardBreak, CardIssue, CardWorktree } from "./types-card-detail";

export type BoardEvent =
  | { type: "card"; card: Card }
  | { type: "card_deleted"; id: string }
  // Appends when index === thread length, otherwise replaces the item at index; truncate drops what follows it.
  | { type: "thread"; cardId: string; item: ThreadItem; index: number; truncate?: boolean }
  // The whole thread was emptied (the copilot's New chat, lib/copilot.ts resetCopilot).
  | { type: "thread_cleared"; cardId: string }
  // Streaming text of the assistant message in progress; cleared by the next assistant item.
  | { type: "delta"; cardId: string; text: string }
  | { type: "login"; login: LoginView }
  | { type: "projects"; projects: Project[] }
  // You signed in or out of your Weft account (lib/account.ts).
  | { type: "account" }
  // A cron was made, changed, run or deleted (lib/cron-store.ts): the rail's Crons drawer reloads.
  | { type: "crons" }
  // A restart was armed, cancelled, or the turns it waits on changed (lib/restart-when-idle.ts).
  | { type: "restart"; restart: RestartStatus };

// Restart when idle (lib/restart-when-idle.ts): no new turn starts, and Weft restarts when the last one ends.
export interface RestartStatus {
  armed: boolean;
  // What happens once idle: a plain relaunch, or installing a downloaded update.
  then?: "relaunch" | "update";
  // The turns it waits on: running now, or with queued messages still to run.
  waiting: { id: string; title: string }[];
  // The card that asked for the restart, when a thread did (lib/restart-tool.ts). The board marks that card, so
  // you can see which one is waiting on a restart. A restart asked for from the menu or the palette has no card.
  requestedBy?: { id: string; title: string };
  // Why the restart didn't happen, when it couldn't (it's disarmed then).
  error?: string;
}

// A folder the new-thread picker offers: a recent project, a git repo found on disk, or both.
export interface LocalRepo {
  path: string;
  name: string;
  git: boolean;
  branch?: string;
  // "owner/name" when origin is on GitHub.
  github?: string;
  // When the repo last changed (ms), and when it was last used for a card, if it's a recent project.
  activity: number;
  recentAt?: number;
}

export interface GithubRepo {
  fullName: string;
  description?: string;
  private: boolean;
  pushedAt: number;
  // Set when it's already cloned on this machine.
  localPath?: string;
}