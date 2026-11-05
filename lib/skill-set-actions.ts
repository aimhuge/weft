import { endSession, isBusy } from "./runner";
import { skillLibrary } from "./skill-library";
import os from "node:os";
import { agentSkillsOff } from "./agent-store";
import { baseOff, ensureSeeded, isPluginId, offFor, projectSet, setProjectOff, toggleCardSkill } from "./skill-sets";
import { getCard, updateCard } from "./store";
import type { Card, SkillSetRow, SkillSetView } from "./types";

// What the Skills drawer and a card's ✦ menu draw: every skill and plugin, whether the project's set
// has it on, and (for a card) whether the card has it on and whether that differs from the project.
// A card's rows compare with what it starts from: its project's set and its agent's (lib/skill-sets.ts baseOff).
export function skillSetView(cwd: string, card?: Pick<Card, "cwd" | "skillsOn" | "skillsOff" | "agent">): SkillSetView {
  ensureSeeded(cwd);
  const projectOff = new Set(card ? baseOff(card) : (projectSet(cwd)?.off ?? []));
  const cardOff = card ? new Set(offFor(card)) : projectOff;
  return { seeded: Boolean(projectSet(cwd)), rows: rowsOf(cwd, projectOff, cardOff) };
}

// An agent's skills (Settings → Agents): Weft's, yours and your plugins, on unless the agent turned them off. A
// project's own skills aren't listed: they belong to its folder, and the project's set decides them.
export function agentSkillView(id: string): SkillSetView {
  const off = new Set(agentSkillsOff(id));
  return { seeded: true, rows: rowsOf(os.homedir(), new Set(), off) };
}

// Every skill and plugin in the folder's library, with whether the base set and this set have it on.
function rowsOf(cwd: string, projectOff: Set<string>, cardOff: Set<string>): SkillSetRow[] {
  const { skills, plugins } = skillLibrary(cwd);
  const row = (name: string): Pick<SkillSetRow, "inProject" | "on" | "changedHere"> => ({
    inProject: !projectOff.has(name),
    on: !cardOff.has(name),
    changedHere: projectOff.has(name) !== cardOff.has(name),
  });
  return [
    ...skills.map((s) => ({ kind: "skill" as const, name: s.name, description: s.description, source: s.source, ...row(s.name) })),
    ...plugins.map((p) => ({ kind: "plugin" as const, name: p.id, label: p.name, description: p.description, source: "plugin" as const, skills: p.skills, ...row(p.id) })),
  ];
}

// The project's default set: one skill or plugin on or off for every thread that starts there from now on.
export function setProjectSkill(cwd: string, name: string, on: boolean): string[] {
  const off = new Set(projectSet(cwd)?.off ?? []);
  if (on) off.delete(name);
  else off.add(name);
  return setProjectOff(cwd, [...off]).off;
}

// One card's set. Its CLI read its skills as it started, so an idle one closes and the next message
// resumes the session with the new set; a busy one picks it up the next time it starts.
export async function setCardSkill(cardId: string, name: string, on: boolean): Promise<Card | undefined> {
  const card = getCard(cardId);
  if (!card) return undefined;
  const next = updateCard(cardId, toggleCardSkill(card, name, on));
  if (!isBusy(cardId)) await endSession(cardId);
  return next;
}

export const isSkillName = (name: unknown): name is string =>
  typeof name === "string" && (/^[\w.-]+(:[\w.-]+)?$/.test(name) || (isPluginId(name) && /^[\w.-]+@[\w.-]+$/.test(name)));
