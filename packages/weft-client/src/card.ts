// The card basics every view needs to read a card or ask for a change to one: its columns, the CLI that runs it and
// its permission mode. The rest of the Card type is still lib/types-card.ts, which re-exports these.

export const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "running", label: "Running" },
  { id: "needs_you", label: "Needs you" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
] as const;

export type Column = (typeof COLUMNS)[number]["id"];

export type Backend = "claude" | "puku" | "codex" | "goose";

// How hard a thread's model thinks, where its CLI offers the choice.
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// bypassPermissions is "YOLO": every tool runs without asking.
export type PermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions";
export const MODES: PermissionMode[] = ["default", "acceptEdits", "auto", "bypassPermissions"];

// A skill a thread can run with "/": the "/" list, on any board.
export interface SkillInfo {
  // What follows the slash when running it.
  name: string;
  description: string;
  // weft: ships with Weft (plugin/skills); user: ~/.claude/skills; project: <folder>/.claude/skills.
  source: "weft" | "user" | "project";
}
