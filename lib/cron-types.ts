// A cron runs a thread again on a schedule (docs/architecture/crons.md). Shared by the server (lib/crons.ts), the
// API (app/api/crons) and the board (the ⏰ popover, the rail's Crons drawer, the stacked source card).
import type { ThreadAgent } from "./agents";
import type { Backend, PermissionMode } from "./types";
import type { Effort } from "./types-settings";

// fork: each run is a new card that continues the source thread from the anchor. fresh: a new card with the prompt only.
export type CronMode = "fork" | "fresh";

export interface CronRun {
  // The card the run made, and its number (1 is the cron's first run).
  cardId: string;
  n: number;
  at: number;
  // Set when the run couldn't start a card at all.
  error?: string;
}

export interface Cron {
  id: string;
  name: string;
  prompt: string;
  // Five-field cron in the Mac's local time (lib/cron-schedule.ts).
  expr: string;
  mode: CronMode;
  // Where and how each run's card works.
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  model?: string;
  effort?: Effort;
  // Who each run's thread is (lib/agents.ts): the source card's agent; none is Builder.
  agent?: ThreadAgent;
  // The card it was made from: a fork's source, and the card whose stack holds the runs on the board.
  sourceId?: string;
  // A fork's starting point: the source's session and the transcript entry each run resumes at (none: the whole session).
  sessionId?: string;
  resumeAt?: string;
  // The browser-pane page a fork run opens on: the one on screen when the anchor message was sent, or the source's latest.
  page?: string;
  enabled: boolean;
  // Made in the popover, or by a thread over MCP (the drawer says so).
  by: "you" | "thread";
  // Runs counted so far, and the latest few (newest last).
  count: number;
  runs: CronRun[];
  // The next run (unix ms); none when it's off or its last run has passed.
  nextAt?: number;
  // No run before startsAt; none after endsAt.
  startsAt?: number;
  endsAt?: number;
  createdAt: number;
  updatedAt: number;
}

// What the popover, the API and the MCP tool send to make one.
export interface CronInput {
  prompt: string;
  expr: string;
  name?: string;
  mode?: CronMode;
  // The card to fork (or to take the folder and model from), and the message to fork it at (its thread item id).
  cardId?: string;
  fromMessage?: string;
  // For a cron with no source card (the New thread window).
  cwd?: string;
  backend?: Backend;
  permissionMode?: PermissionMode;
  model?: string;
  effort?: Effort;
  startsAt?: number;
  endsAt?: number;
  enabled?: boolean;
  by?: Cron["by"];
  // Fire one run as soon as it's made ("Also run now").
  runNow?: boolean;
}

export type CronPatch = Partial<Pick<Cron, "name" | "prompt" | "expr" | "mode" | "enabled" | "startsAt" | "endsAt">>;

// How many runs a cron keeps on file; older run cards stay on the board, the drawer shows these.
export const RUNS_KEPT = 20;

// The board MCP tools lib/cron-tools.ts adds. They skip the permission prompt (lib/board-tools-trust.ts): a cron only makes cards, as create_card does.
export const CRON_TOOL_NAMES = ["create_cron", "list_crons", "update_cron", "delete_cron", "run_cron_now"];
