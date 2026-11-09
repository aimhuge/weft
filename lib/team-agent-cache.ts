import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentInfo, TeamRef } from "./agents";
import { DATA_DIR } from "./store";

// The last copy of your teams' agents (docs/architecture/agents.md "Team agents"), in ~/.weft/team-agents.json: what
// lib/team-agents.ts last pulled from Supabase's team_agents, kept so the pickers and the prompt work offline. Only the
// file lives here; the pull and the writes are in lib/team-agents.ts, so lib/agent-store.ts can read this without
// loading the network side.

// A team_agents row as the pull keeps it, with its team's name.
export interface TeamAgentRow {
  orgId: string;
  orgName: string;
  agentId: string;
  name: string;
  emoji: string;
  tagline: string;
  soul: string;
  skillsOff: string[];
  createdBy: string;
}

export interface TeamAgentCache {
  // Who pulled it: rows you shared are yours (shown as shares), everyone else's are team agents.
  me: string | null;
  teams: TeamRef[];
  rows: TeamAgentRow[];
}

const EMPTY: TeamAgentCache = { me: null, teams: [], rows: [] };
const file = () => path.join(DATA_DIR, "team-agents.json");
let cache: TeamAgentCache | null = null;

export function readTeamCache(): TeamAgentCache {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<TeamAgentCache>;
    cache = { me: typeof raw.me === "string" ? raw.me : null, teams: Array.isArray(raw.teams) ? raw.teams : [], rows: Array.isArray(raw.rows) ? raw.rows : [] };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function writeTeamCache(next: TeamAgentCache) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  cache = next;
}

// For tests: forget what was read.
export function forgetTeamCache() {
  cache = null;
}

// A team agent's id on this Mac: its team and the id it has on the sharer's Mac, so two teams' agents never meet.
export const teamAgentId = (orgId: string, agentId: string) => `t-${orgId.slice(0, 8)}-${agentId}`;

// Your teams' agents, as agents: everyone's but your own (yours are already in your list, shared or not).
export function teamAgents(): AgentInfo[] {
  const { me, rows } = readTeamCache();
  return rows
    .filter((r) => r.createdBy !== me)
    .map((r) => ({
      id: teamAgentId(r.orgId, r.agentId),
      name: r.name,
      emoji: r.emoji,
      tagline: r.tagline,
      soul: r.soul,
      ...(r.skillsOff.length ? { skillsOff: r.skillsOff } : {}),
      team: { id: r.orgId, name: r.orgName },
    }));
}

// Which teams each of your agents is shared with, by your agent's id.
export function myShares(): Record<string, string[]> {
  const { me, rows } = readTeamCache();
  const shares: Record<string, string[]> = {};
  for (const r of rows) if (me && r.createdBy === me) (shares[r.agentId] ??= []).push(r.orgId);
  return shares;
}

// Changes whenever a team agent does, so an edit a teammate shares reaches idle threads (lib/weft-prompts.ts).
export function teamCacheHash(): string {
  const { rows } = readTeamCache();
  return rows.length ? createHash("sha1").update(JSON.stringify(rows)).digest("hex").slice(0, 12) : "";
}
