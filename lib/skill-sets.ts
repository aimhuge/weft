import fs from "node:fs";
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { agentSkillsOff } from "./agent-store";
import { globalSingleton } from "./global-singleton";
import { skillLibrary } from "./skill-library";
import { skillsUsedIn } from "./skill-usage";
import { DATA_DIR } from "./store";
import type { Card } from "./types";

// Which skills a thread gets. Each project keeps an off-list, seeded once from what its threads ran
// (lib/skill-usage.ts): Weft's and the folder's own skills stay on, and a skill of yours or a plugin
// none of its threads ran goes off. A card can turn things on or off for itself (Card.skillsOn/Off).
// An off-list rather than an on-list, so a skill Weft doesn't know of (Claude Code's bundled ones) stays on.
// Its CLI reads the set as it starts (skillSettings below); a running session doesn't pick up a change.

export const SETS_FILE = path.join(DATA_DIR, "skill-sets.json");

export interface ProjectSkillSet {
  // Skill names ("tdac") and plugin ids ("posthog@posthog").
  off: string[];
  seededAt: number;
}

type Sets = Record<string, ProjectSkillSet>;

function readSets(): Sets {
  try {
    return JSON.parse(fs.readFileSync(SETS_FILE, "utf8")) as Sets;
  } catch {
    return {};
  }
}

function writeSets(sets: Sets) {
  fs.mkdirSync(path.dirname(SETS_FILE), { recursive: true });
  fs.writeFileSync(SETS_FILE, JSON.stringify(sets, null, 2));
}

const unique = (names: string[]) => [...new Set(names)].sort();
export const isPluginId = (name: string) => name.includes("@");

export function projectSet(cwd: string): ProjectSkillSet | undefined {
  return readSets()[cwd];
}

export function setProjectOff(cwd: string, off: string[]): ProjectSkillSet {
  const sets = readSets();
  const set = { off: unique(off), seededAt: sets[cwd]?.seededAt ?? Date.now() };
  writeSets({ ...sets, [cwd]: set });
  return set;
}

// What a project starts with: off, every skill of yours and every plugin none of its threads ran.
export async function seedProjectSet(cwd: string): Promise<ProjectSkillSet> {
  const existing = projectSet(cwd);
  if (existing) return existing;
  const used = new Set(await skillsUsedIn(cwd));
  const { skills, plugins } = skillLibrary(cwd);
  const off = [
    ...skills.filter((s) => s.source === "user" && !used.has(s.name)).map((s) => s.name),
    ...plugins.filter((p) => ![...used].some((name) => name.startsWith(`${p.name}:`))).map((p) => p.id),
  ];
  // Another caller may have set it while the scan ran; theirs wins.
  return projectSet(cwd) ?? setProjectOff(cwd, off);
}

const seeding = () => globalSingleton("__weftSkillSeeding", () => new Set<string>());

// Seeds a project's set in the background, once per folder per server. Until it lands, its threads get everything.
export function ensureSeeded(cwd: string): void {
  if (seeding().has(cwd) || projectSet(cwd)) return;
  seeding().add(cwd);
  void seedProjectSet(cwd).catch(() => seeding().delete(cwd));
}

type CardSkills = Pick<Card, "cwd" | "skillsOn" | "skillsOff" | "agent">;

// What a card starts from before its own changes: its project's off-list plus its agent's (lib/agent-store.ts).
export function baseOff(card: Pick<Card, "cwd" | "agent">): string[] {
  return unique([...(projectSet(card.cwd)?.off ?? []), ...agentSkillsOff(card.agent)]);
}

// What's off for a thread in this folder: the project's and its agent's off-lists plus the card's own, less what the card turned on.
export function offFor(card: CardSkills): string[] {
  const on = new Set(card.skillsOn ?? []);
  return unique([...baseOff(card), ...(card.skillsOff ?? [])]).filter((name) => !on.has(name));
}

// A card turning one skill or plugin on or off, as the smallest change from its project's set.
export function toggleCardSkill(card: CardSkills, name: string, on: boolean): Pick<Card, "skillsOn" | "skillsOff"> {
  const offInProject = baseOff(card).includes(name);
  const skillsOn = (card.skillsOn ?? []).filter((n) => n !== name);
  const skillsOff = (card.skillsOff ?? []).filter((n) => n !== name);
  if (on && offInProject) skillsOn.push(name);
  if (!on && !offInProject) skillsOff.push(name);
  return { skillsOn: unique(skillsOn), skillsOff: unique(skillsOff) };
}

export type SkillSettings = Pick<Settings, "skillOverrides" | "enabledPlugins">;

// The off-list as Claude Code settings. A skill goes "user-invocable-only": the model no longer sees it,
// but /name still runs it (an automation's, or one you type). A plugin goes off as a whole.
export function skillSettings(off: string[]): SkillSettings | undefined {
  if (!off.length) return undefined;
  const skills = off.filter((n) => !isPluginId(n));
  const plugins = off.filter(isPluginId);
  return {
    ...(skills.length ? { skillOverrides: Object.fromEntries(skills.map((n) => [n, "user-invocable-only" as const])) } : {}),
    ...(plugins.length ? { enabledPlugins: Object.fromEntries(plugins.map((id) => [id, false as const])) } : {}),
  };
}

// Other --settings (the puku trial's) with a thread's skill set on top.
export function withSkillSettings<T extends object>(settings: T | undefined, off: string[] | undefined): (T & SkillSettings) | T | undefined {
  const skills = skillSettings(off ?? []);
  return skills ? { ...(settings as T), ...skills } : settings;
}

export const sameOff = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((n, i) => n === b[i]);
