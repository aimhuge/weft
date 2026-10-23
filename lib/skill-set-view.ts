import type { SkillSetRow } from "./types";
import { matchesQuery } from "./text-filter";

// How the Skills drawer and a card's ✦ menu lay out a skill set (lib/skill-set-actions.ts skillSetView).

export interface SkillGroup {
  title: string;
  rows: SkillSetRow[];
  // How many of its rows are on.
  on: number;
}

const GROUPS: [SkillSetRow["source"], string][] = [
  ["weft", "Weft"],
  ["project", "This project"],
  ["user", "Yours · ~/.claude/skills"],
  ["plugin", "Plugins"],
];

const matches = (row: SkillSetRow, query: string) => matchesQuery([row.name, row.label, row.description], query);

// The rows a filter leaves, in the four groups (an empty group is left out).
export function groupRows(rows: SkillSetRow[], query = ""): SkillGroup[] {
  return GROUPS.flatMap(([source, title]) => {
    const shown = rows.filter((r) => r.source === source && matches(r, query));
    return shown.length ? [{ title, rows: shown, on: shown.filter((r) => r.on).length }] : [];
  });
}

// What the thread's model sees: its skills that are on, a plugin counting as each skill it brings.
export function skillsOnCount(rows: SkillSetRow[]): number {
  return rows.reduce((n, r) => (r.on ? n + (r.kind === "plugin" ? (r.skills ?? 0) : 1) : n), 0);
}

// How many skills the set keeps out of the thread, plugins counted by their skills.
export function skillsOffCount(rows: SkillSetRow[]): number {
  return rows.reduce((n, r) => (r.on ? n : n + (r.kind === "plugin" ? (r.skills ?? 0) : 1)), 0);
}

// One row switched, as the server will have it, so the switch moves before the reply.
export function withToggled(rows: SkillSetRow[], name: string, on: boolean, forCard: boolean): SkillSetRow[] {
  return rows.map((r) => {
    if (r.name !== name) return r;
    const inProject = forCard ? r.inProject : on;
    return { ...r, on, inProject, changedHere: forCard && on !== inProject };
  });
}
