// Your agents on a Weft Worker (docs/architecture/agents.md#on-a-weft-worker). A thread's agent travels by its id only
// (lib/create-widen.ts signedAgent), so an agent you made in Settings → Agents has to exist on the worker too: the
// agents you made and edited, and the default agent of each worker project, go with your account settings ("agents" in
// ACCOUNT_SETTINGS, lib/host-settings.ts), signed by this Mac's device key like the thread instructions they sit beside,
// and a worker mirrors them only from the Mac it was paired with (lib/account-settings-sig.ts). A soul is a system
// prompt, so it's taken from nowhere else: every field is checked again here, and a worker's own edits are replaced.
import type { AgentInfo } from "./agents";
import { LIMITS, mirrorAgents, savedAgents, workerProjectAgents } from "./agent-store";
import { parseWorkerProject } from "./worker-project";

export interface AgentsSnapshot {
  saved: AgentInfo[];
  // worker://<id>/<folder> → the agent a new thread there starts as.
  projects: Record<string, string>;
}

// How much soul text a snapshot carries, so a long list never pushes the account row over its cap: the agents past it
// stay on this Mac (lib/account-settings.ts drops the field when the row is refused anyway).
export const SNAPSHOT_MAX_CHARS = 300_000;
const MAX_AGENTS = 200;
const MAX_PROJECTS = 500;

const ID = /^[\w-]{1,60}$/;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

// Whether an agent's words fit what Settings → Agents saves: an id, a name, a soul, and an emoji and line if any.
function wordsFit({ id, name, emoji, tagline, soul }: Record<string, unknown>): boolean {
  if (typeof id !== "string" || !ID.test(id) || !short(name, LIMITS.name) || !name) return false;
  return short(soul, LIMITS.soul) && Boolean(soul.trim()) && short(emoji ?? "", LIMITS.emoji) && short(tagline ?? "", LIMITS.tagline);
}

// One agent as a worker takes it, its fields in one order, or null when any is off.
function agentOf(raw: unknown): AgentInfo | null {
  if (!isObject(raw) || !wordsFit(raw)) return null;
  const { id, name, emoji, tagline, soul, skillsOff, changed } = raw as Record<string, string | undefined> & { skillsOff?: unknown };
  const skills = Array.isArray(skillsOff) && skillsOff.every((n) => short(n, 120)) ? skillsOff : [];
  return {
    id: id as string,
    name: name as string,
    emoji: emoji ?? "",
    tagline: tagline ?? "",
    soul: soul as string,
    ...(skills.length ? { skillsOff: skills } : {}),
    ...(changed === "you" || changed === "github" ? { changed } : {}),
  };
}

// What this host has, as it goes to a worker: its saved agents (each in agentOf's shape) up to the size cap, and its
// worker-project defaults.
export function agentsSnapshot(): AgentsSnapshot {
  let chars = 0;
  const saved: AgentInfo[] = [];
  for (const agent of savedAgents().map(agentOf)) {
    if (!agent) continue;
    chars += JSON.stringify(agent).length;
    if (chars > SNAPSHOT_MAX_CHARS) break;
    saved.push(agent);
  }
  return { saved, projects: workerProjectAgents() };
}

// A synced snapshot as a worker takes it, or undefined when it isn't one. An agent or default that doesn't check out is
// dropped on its own.
export function readAgentsSnapshot(raw: unknown): AgentsSnapshot | undefined {
  if (!isObject(raw) || !Array.isArray(raw.saved) || !isObject(raw.projects)) return undefined;
  const saved = raw.saved.slice(0, MAX_AGENTS).map(agentOf).filter((a): a is AgentInfo => a !== null);
  const projects = Object.fromEntries(
    Object.entries(raw.projects)
      .slice(0, MAX_PROJECTS)
      .filter((entry): entry is [string, string] => parseWorkerProject(entry[0]) !== null && typeof entry[1] === "string" && ID.test(entry[1])),
  );
  return { saved, projects };
}

export const applyAgentsSnapshot = (snapshot: AgentsSnapshot) => mirrorAgents(snapshot.saved, snapshot.projects);
