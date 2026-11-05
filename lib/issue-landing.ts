import type { Column } from "./types-card";
import type { IssueLanding, IssueWorkflow } from "./types-settings";

// Where a project's GitHub issue cards land when the importer makes them (lib/github-issues.ts).
//
// - "backlog": a cold Backlog card. It waits for you to pick it up, like any card you typed yourself.
// - "needs_you": a card in Needs you, so a fresh import stands out instead of hiding in Backlog.
// - "run": the card's thread starts at once. A validation skill may run first, and the agent that
//   works it is the one the project named.
//
// The choice is per project folder, and "backlog" is the default (what the importer did before).
//
// The types live in lib/types-settings.ts, so the drawer can use them without pulling this module's
// server-side neighbours in.

export type { IssueLanding, IssueWorkflow };

export const ISSUE_LANDINGS: IssueLanding[] = ["backlog", "needs_you", "run"];

export const DEFAULT_LANDING: IssueLanding = "backlog";

// The names the drawer offers, in the order it offers them.
export const LANDING_LABELS: { id: IssueLanding; label: string; hint: string }[] = [
  { id: "backlog", label: "Backlog", hint: "Cards wait there for you to pick them up" },
  { id: "needs_you", label: "Needs you", hint: "Cards land in Needs you, so they stand out" },
  { id: "run", label: "Run", hint: "Each card's thread starts, and parks in Needs you when it asks" },
];

// Whether a value names a landing; a setting read off disk can be anything.
export function isIssueLanding(value: unknown): value is IssueLanding {
  return typeof value === "string" && (ISSUE_LANDINGS as string[]).includes(value);
}

// The workflow a folder reads as: the landing, plus the validation skill and the agent when it has
// them. A folder that chose nothing reads as the default landing and no skill, no agent.
export function workflowOf(value: unknown): IssueWorkflow {
  if (!value || typeof value !== "object") return { landing: DEFAULT_LANDING };
  const w = value as Partial<IssueWorkflow>;
  return {
    landing: isIssueLanding(w.landing) ? w.landing : DEFAULT_LANDING,
    ...(typeof w.skill === "string" && w.skill.trim() ? { skill: w.skill.trim() } : {}),
    ...(typeof w.agent === "string" && w.agent.trim() ? { agent: w.agent.trim() } : {}),
  };
}

// The column a new card is made in. "run" is made in Backlog too: the thread starts at once and the
// runner moves it to Running, so a card that can't start yet (its model is at its limit) waits in
// Backlog rather than being lost.
export function landingColumn(landing: IssueLanding): Column {
  return landing === "needs_you" ? "needs_you" : "backlog";
}

// Whether a card made under this landing starts its thread right away.
export function landingRuns(landing: IssueLanding): boolean {
  return landing === "run";
}

// The skill that validates the card first, as the message that starts it. Empty means the card
// starts on the issue itself.
export function validationMessage(skill: string | undefined): string | undefined {
  const name = skill?.trim();
  return name ? `Start by using the ${name} skill.` : undefined;
}
