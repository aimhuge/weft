import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { agentOf, isBuiltIn, mergeAgents, shippedAgent, type AgentInfo } from "./agents";
import { DATA_DIR, listCards, updateCard } from "./store";

// The agents you made and the built-ins you edited (Settings → Agents), kept in ~/.weft/agents.json. lib/agents.ts merges
// them over the built-ins; every reader on the server goes through listAgents(). docs/architecture/agents.md.

// The built-ins on GitHub, newest first: what Reset pulls.
export const BUILT_IN_URL = "https://raw.githubusercontent.com/aimhuge/weft/main/lib/agents-built-in.json";
const RESET_TIMEOUT_MS = 5000;

export const LIMITS = { name: 40, emoji: 8, tagline: 140, soul: 20000 };

const file = () => path.join(DATA_DIR, "agents.json");

// The file: your agents and built-in edits, and each project's default agent by folder.
interface Saved {
  agents: AgentInfo[];
  projects: Record<string, string>;
}

// An agent as the file or GitHub holds it: at least an id, a name and a soul.
function isSaved(a: unknown): a is AgentInfo {
  const o = a as Partial<AgentInfo> | null;
  return typeof o?.id === "string" && typeof o.name === "string" && typeof o.soul === "string";
}

// Read once, then kept: every write goes through this module, and the prompt reads it on every new CLI.
let cache: Saved | null = null;

function readFile(): Saved {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as { agents?: unknown; projects?: unknown };
    const agents = Array.isArray(raw.agents) ? (raw.agents as unknown[]).filter(isSaved) : [];
    const projects = raw.projects && typeof raw.projects === "object" ? (raw.projects as Record<string, string>) : {};
    cache = { agents, projects };
  } catch {
    cache = { agents: [], projects: {} };
  }
  return cache;
}

const readSaved = () => readFile().agents;

function writeFile(next: Partial<Saved>) {
  const saved = { ...readFile(), ...next };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(saved, null, 2));
  cache = saved;
}

const writeSaved = (agents: AgentInfo[]) => writeFile({ agents });

// For tests: forget what was read, so the next read sees the file.
export function forgetAgents() {
  cache = null;
}

export function listAgents(): AgentInfo[] {
  return mergeAgents(readSaved());
}

// Changes whenever a saved agent does, so the prompt fingerprint (lib/weft-prompts.ts promptsBuild) replaces idle CLIs.
export function savedAgentsHash(): string {
  const saved = readSaved();
  return saved.length ? createHash("sha1").update(JSON.stringify(saved)).digest("hex").slice(0, 12) : "";
}

// The agent a new thread in this folder starts as, when it names none (Settings → Agents); none means Builder.
export function projectAgent(cwd: string): string | undefined {
  const id = readFile().projects[cwd];
  return id && listAgents().some((a) => a.id === id) ? id : undefined;
}

export const projectAgents = (): Record<string, string> => readFile().projects;

// Builder (or null) clears the folder's default.
export function setProjectAgent(cwd: string, id: string | null) {
  if (!cwd) throw new Error("Which project?");
  if (id !== null && !listAgents().some((a) => a.id === id)) throw new Error("No such agent.");
  const projects = Object.fromEntries(Object.entries(readFile().projects).filter(([folder]) => folder !== cwd));
  writeFile({ projects: id && id !== "builder" ? { ...projects, [cwd]: id } : projects });
}

// What a thread with this agent doesn't get, on top of its project's off-list (lib/skill-sets.ts offFor).
export const agentSkillsOff = (id: string | undefined): string[] => agentOf(id, listAgents()).skillsOff ?? [];

// One skill or plugin on or off for every thread with this agent; a built-in's change is saved over it.
export function setAgentSkill(id: string, name: string, on: boolean): AgentInfo {
  const agent = requireAgent(id);
  const off = new Set(agent.skillsOff ?? []);
  if (on) off.delete(name);
  else off.add(name);
  return updateAgent(id, { ...agent, skillsOff: [...off] });
}

const text = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().slice(0, max) : "");

// Skill names and plugin ids (lib/skill-set-actions.ts isSkillName), each once.
function cleanSkills(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((n): n is string => typeof n === "string" && /^[\w.@:-]{1,120}$/.test(n)))].slice(0, 500);
}

// What an agent may be saved as: a name no other agent has, an emoji (🤖 when left out), one line and a soul.
function clean(input: Record<string, unknown>, id: string): Omit<AgentInfo, "builtIn" | "changed"> {
  const name = text(input.name, LIMITS.name);
  if (!name) throw new Error("An agent needs a name.");
  const soul = typeof input.soul === "string" ? input.soul.trim() : "";
  if (!soul) throw new Error("An agent needs a soul: who it is and how it works.");
  if (soul.length > LIMITS.soul) throw new Error(`A soul is at most ${LIMITS.soul.toLocaleString("en-US")} characters.`);
  const taken = listAgents().find((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase());
  if (taken) throw new Error(`There's already an agent called ${taken.name}.`);
  const tagline = text(input.tagline, LIMITS.tagline).replace(/\s+/g, " ");
  const skillsOff = cleanSkills(input.skillsOff);
  return { id, name, emoji: text(input.emoji, LIMITS.emoji) || "🤖", tagline, soul, ...(skillsOff.length ? { skillsOff } : {}) };
}

export function createAgent(input: Record<string, unknown>): AgentInfo {
  const agent = clean(input, `a-${randomUUID().slice(0, 8)}`);
  writeSaved([...readSaved(), agent]);
  return requireAgent(agent.id);
}

function requireAgent(id: string): AgentInfo {
  const agent = listAgents().find((a) => a.id === id);
  if (!agent) throw new Error("No such agent.");
  return agent;
}

// A built-in's edit is saved over it; one you made is changed in place.
// Its skills stay as they were unless the edit names them (the form sends words; the skill list sends skills).
export function updateAgent(id: string, input: Record<string, unknown>): AgentInfo {
  const before = requireAgent(id);
  const agent = clean({ skillsOff: before.skillsOff, ...input }, id);
  const saved = readSaved();
  const at = saved.findIndex((a) => a.id === id);
  writeSaved(at < 0 ? [...saved, agent] : saved.map((a, i) => (i === at ? agent : a)));
  return requireAgent(id);
}

// Only the ones you made: a built-in resets instead. Cards that had it go back to Builder.
export function deleteAgent(id: string) {
  const agent = requireAgent(id);
  if (agent.builtIn) throw new Error(`${agent.name} is built in: reset it instead.`);
  const projects = Object.fromEntries(Object.entries(readFile().projects).filter(([, a]) => a !== id));
  writeFile({ agents: readSaved().filter((a) => a.id !== id), projects });
  for (const card of listCards()) if (card.agent === id) updateCard(card.id, { agent: undefined });
}

// The built-in as it is on GitHub now, or as it shipped when GitHub can't be reached.
async function latest(id: string): Promise<{ agent: AgentInfo; from: "github" | "shipped" }> {
  const shipped = shippedAgent(id);
  try {
    const res = await fetch(BUILT_IN_URL, { signal: AbortSignal.timeout(RESET_TIMEOUT_MS), headers: { "user-agent": "Weft" } });
    if (!res.ok) throw new Error(String(res.status));
    const all = (await res.json()) as unknown;
    const found = Array.isArray(all) ? (all as unknown[]).filter(isSaved).find((a) => a.id === id) : undefined;
    if (!found) throw new Error("not there");
    return { agent: found, from: "github" };
  } catch {
    return { agent: shipped, from: "shipped" };
  }
}

// A built-in back to its latest text: GitHub's when it differs from the one that shipped, else the shipped one.
export async function resetAgent(id: string): Promise<{ agent: AgentInfo; from: "github" | "shipped" }> {
  if (!isBuiltIn(id)) throw new Error("Only a built-in agent resets. Edit this one, or delete it.");
  const { agent, from } = await latest(id);
  const shipped = shippedAgent(id);
  // GitHub's copy may leave the emoji or the line out.
  const { emoji, tagline } = agent as Partial<AgentInfo>;
  const words = { name: agent.name, emoji: emoji || shipped.emoji, tagline: tagline ?? "", soul: agent.soul };
  const same = (["name", "emoji", "tagline", "soul"] as const).every((k) => words[k] === shipped[k]);
  // The skills you picked for it stay: Reset is about its words.
  const skillsOff = readSaved().find((a) => a.id === id)?.skillsOff ?? [];
  const keep = skillsOff.length ? { skillsOff } : {};
  const rest = readSaved().filter((a) => a.id !== id);
  // The shipped words need saving only to carry skills; GitHub's newer ones are saved, marked as GitHub's.
  if (!same) writeSaved([...rest, { id, ...words, ...keep, changed: "github" }]);
  else writeSaved(skillsOff.length ? [...rest, { id, ...words, ...keep }] : rest);
  return { agent: requireAgent(id), from };
}
