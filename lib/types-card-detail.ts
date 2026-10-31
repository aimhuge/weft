// The Card interface and its closest dependents (CardIssue). Lives in its own module
// to keep types-card.ts under the line limit; re-exported by it so the public shape
// of ./types is unchanged.

import type { Backend, CardStats, CardYield, Column, PendingPermission, ReviewPlan, ScheduledMessage } from "./types-card";
import type { Effort } from "./types-settings";
import type { CardTask } from "./tasks";
import type { ThreadAgent } from "./agents";
import type { CopilotPersona } from "./copilot-personas";
import type { CardShareMode } from "./share-types";
export type { CardStats, Column };

export interface Card {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  backend: Backend;
  permissionMode: import("./types-card").PermissionMode;
  // Chosen when the thread was made; left out, the CLI's own default.
  model?: string;
  effort?: Effort;
  // The model's and effort's value before a Done move patched them for the /weft:done turn
  // (app/api/cards/[id] moveCard). Cleared by restoreDoneOverride once that turn ends.
  preDoneModel?: string;
  preDoneEffort?: Effort;
  // The CLI before a Done move moved the card to the backup model's CLI (an exhausted model
  // hands the wrap-up to the backup). Cleared by restoreDoneOverride once that turn ends.
  preDoneBackend?: Backend;
  column: Column;
  // When the card last moved to another column; the command palette opens on the latest moves.
  columnAt?: number;
  // Filed away after its Done automations finished; the board hides it until "Show archived".
  archived?: boolean;
  // Manual order inside its column. Backlog uses this so you can drag cards into a chosen
  // order; smaller numbers come first; ties fall back to the column's chosen sort. Set by
  // the reorder route and the backlog's drop-onto-card gesture (lib/store.ts reorderCard,
  // lib/use-board-card-actions.ts reorder). Old cards backfill from createdAt on load.
  order?: number;
  // Running its /done (or Done's automations) and archived when that ends: the board shows it in Done meanwhile.
  wrappingUp?: boolean;
  // Skills a "prompt-matches" automation has already run in this thread, so each runs once.
  promptSkills?: string[];
  // The card whose thread started this one, via the board tools.
  parentId?: string;
  // A cron's run (lib/crons.ts): the cron, its run number, and the card whose stack it folds into on the board
  // (the source thread, or the cron's first run when it has none).
  cronId?: string;
  cronRun?: number;
  cronOf?: string;
  // Start as a copy of another thread's session, resumed at this entry (a cron's fork run). Read only until the
  // card's own first turn gives it a sessionId (lib/runner-state.ts specFor).
  forkOf?: { sessionId: string; at?: string };
  sessionId?: string;
  lastLine?: string;
  costUsd?: number;
  stats?: CardStats;
  turns?: number;
  error?: string;
  // Set when the thread's last turn hit the plan's rate limit, so the card menu and banner can
  // offer a one-click "Run on <other>" escape. Cleared by switchBackend on a successful switch.
  rateLimitHit?: boolean;
  // When lib/limit-resume.ts auto-replayed the last user message because the 15-min poll saw
  // the limit reset (5-hour or weekly). Drives the "Auto-resumed" chip on the card; cleared the
  // next time the user-driven turn starts.
  autoResumedAt?: number;
  // Why the thread auto-resumed: the plan's window reset, or the plan itself changed (the user
  // upgraded, so the models that were capped have room again). The chip says which.
  autoResumedReason?: "reset" | "upgrade";
  pending?: PendingPermission | null;
  // The copilot is a thread too, but it lives in its own window instead of on the board.
  role?: "copilot";
  // Which copilot it is (lib/copilot-personas.ts); none means Wingman. Only on the copilot card.
  persona?: CopilotPersona;
  // Who the thread is (lib/agents.ts): its soul opens the system prompt. None means Builder, Weft's own soul.
  agent?: ThreadAgent;
  // The agent this thread authored (lib/agent-tools.ts): it saved one with create_agent. The link goes the other
  // way from `agent` (who the thread is), so Settings can say which thread built which agent.
  agentId?: string;
  // A CLI process is open for this thread, so a reply starts right away.
  warm?: boolean;
  // From the thread's own BOARD STATUS line (see lib/status.ts).
  stage?: string;
  remaining?: string;
  // The CLI's guess at your next message after a turn (the SDK's prompt suggestions); the reply box
  // shows it as its placeholder and Tab fills it in. Cleared when you send.
  suggestion?: string;
  // From the thread's weft-review block; replaced each time it sends a new one.
  review?: ReviewPlan;
  // Files the thread has edited (Edit, Write, MultiEdit, NotebookEdit), most recent first, capped
  // (lib/overlap.ts), for the warning when busy cards in one folder edit the same files.
  touchedFiles?: string[];
  // Top-level symbols (or whole files) the thread edited and hasn't committed, most recent first, capped:
  // "/abs/Board.tsx#CommandPalette", "/abs/a.css#*" (lib/claims.ts). Dropped at Done, archive and commit.
  claims?: string[];
  // Files this card leaves to another card for now: the user put that card first ("This first", lib/precedence.ts).
  // While it holds a claim on the file, its edits there don't ask this card, and this card's edits there wait on it.
  yields?: CardYield[];
  // Weft crashed, failed to build or reloaded right after this thread did something that does that (lib/crash-blame.ts):
  // the card has a red ring and a "Broke Weft" chip until you dismiss it, and the thread hears why with its next message.
  broke?: CardBreak;
  // Set on cards picked up from existing Claude Code sessions (see lib/import.ts).
  source?: "claude-code";
  // When the session last changed (its last message), and when its transcript was last read into the thread.
  lastActivity?: number;
  transcriptAt?: number;
  // The session is open in another app (the Claude app or a terminal) right now, so Weft won't write to it.
  openElsewhere?: boolean;
  // When a picked-up session looked active in another app, Weft continued it as a copy of this one.
  forkedFrom?: string;
  // When Weft last finished a turn on this card, to tell its own session writes from other apps'.
  lastWeftTurn?: number;
  // The card's thumbnail (lib/card-pictures.ts): its latest picture, and how many images its thread holds.
  thumb?: string;
  pictures?: number;
  // The page its browser pane shows now (an open_url's URL, or Weft's own starter or update page as a file:// URL) and
  // how many pages the pane has opened on it (lib/card-page.ts). The synced row carries both (docs/architecture/cloud-sync.md).
  page?: string;
  pages?: number;
  // Haiku's emoji for the card, shown in place of a thumbnail until it has one.
  emoji?: string;
  // Who last named the card: you (typed or renamed it) or Weft's retitle after its first turn (lib/retitle.ts).
  // Either way, Claude Code's own session title no longer replaces it.
  titleBy?: "user" | "auto";
  // ★: worth keeping. A starred card is never auto-archived.
  starred?: boolean;
  // Directories the user has approved this thread to read from, beyond cwd (the card's project folder).
  // Stored on the card so a resumed session keeps the read scope; passed to the SDK as
  // additionalDirectories. A run-time `/add-dir` slash command isn't enough on its own — the path
  // has to be a subdirectory of cwd or another already-granted directory at session launch.
  readScope?: string[];
  // This card's changes to its project's skill set (lib/skill-sets.ts): skill names or plugin ids
  // ("posthog@posthog") turned on or off here only. Read when its CLI starts.
  skillsOn?: string[];
  skillsOff?: string[];
  // Asked for a git worktree of its own (docs/architecture/worktrees.md), and the one it has once Weft gave it one.
  // cwd stays the project; code runs in workDir(card) (lib/work-dir.ts).
  isolated?: boolean;
  worktree?: CardWorktree;
  // The branch its worktree works on, when you picked one in the New thread dialog: an existing branch is checked
  // out there, a new name is made from HEAD. Left out, its own weft/<slug> (lib/worktrees.ts branchFor).
  worktreeBranch?: string;
  // Short labels (lib/tags.ts), the same rules as GitHub labels so they sync with an issue's. Weft's
  // retitle picks them after a turn (tagsBy "auto") until you edit them (tagsBy "user").
  tags?: string[];
  tagsBy?: "user" | "auto";
  // The GitHub issue this card came from (lib/github-issues.ts).
  issue?: CardIssue;
  // Messages to send at a set time (lib/schedule.ts), soonest first; lib/scheduler.ts sends them.
  scheduled?: ScheduledMessage[];
  // A turn the app closed in the middle of; lib/resume.ts carries it on after the restart. `resumes` counts the
  // carry-on turns in a row (your own message resets it), so a turn that keeps getting cut off stops after a few.
  interrupted?: boolean;
  resumes?: number;
  // Its subagents and background commands, running and recently ended (lib/tasks.ts).
  tasks?: CardTask[];
  // Its share link as last read from Supabase (lib/card-share.ts), so the Share dialog draws at once and refreshes after.
  share?: CardShareMemo;
  createdAt: number;
  updatedAt: number;
}

// An isolated card's worktree (lib/worktrees.ts): ~/.weft/worktrees/<repo>/<id> on branch weft/<slug> (or the card's
// worktreeBranch), made from the main tree's HEAD at `base`, landing back on `repo` (the main tree's root). `sub` is the
// card's folder inside the repo when it isn't the root ("packages/web"), so the thread starts in the same place in its
// worktree.
export interface CardWorktree {
  path: string;
  branch: string;
  base: string;
  repo: string;
  sub?: string;
}

export interface CardShareMemo {
  id: string | null;
  mode: CardShareMode;
  hasPassword: boolean;
  // The address to copy (weft.zip/@<user>/threads/<slug> once it has one), its slug, and whether the chat shows.
  url?: string | null;
  slug?: string | null;
  showChat?: boolean;
}

export interface CardIssue {
  // "owner/name"
  repo: string;
  number: number;
  url: string;
  state: "open" | "closed";
  // The issue's updated_at when Weft last read it, to tell its edits from ours.
  updatedAt: string;
}
// What a card did to Weft (Card.broke): the server stopped, a file stopped building, or the board reloaded.
export interface CardBreak {
  kind: "server" | "build" | "reload";
  // When it happened, the latest time when it happened again.
  at: number;
  // What the thread did and what it hit: "its `pnpm dev` stopped Weft (whatever listens on port 1024, …)".
  why: string;
  // The file it edited, for a build error or reload.
  file?: string;
  // How many times, when it did it more than once before you dismissed it.
  times?: number;
  // Set once the thread has been told, with its next message.
  told?: boolean;
}
