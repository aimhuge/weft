import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { isBuiltIn, type TeamRef } from "./agents";
import { listAgents, onAgentsSaved, savedAgents } from "./agent-store";
import { myShares, readTeamCache, writeTeamCache, type TeamAgentRow } from "./team-agent-cache";

// Team agents (docs/architecture/agents.md): an agent you made, shared with a Weft team through Supabase's team_agents,
// so every member's Weft offers it. This Mac reads and writes as you (lib/account.ts accountClient), and RLS decides:
// members read, the sharer writes their own rows. The last pull is kept in ~/.weft/team-agents.json
// (lib/team-agent-cache.ts), so the pickers and the prompt keep working offline.

const PULL_EVERY_MS = 10 * 60_000;
// GET /api/agents pulls again at most this often (Settings → Agents opening, the board loading).
const SOON_MS = 60_000;
// Edits come in bursts (each skill switch is a save), so your shared copies are pushed once they settle.
const PUSH_AFTER_MS = 1500;

const COLUMNS = "org_id, agent_id, name, emoji, tagline, soul, skills_off, created_by";

interface Row {
  org_id: string;
  agent_id: string;
  name: string;
  emoji: string;
  tagline: string;
  soul: string;
  skills_off: string[] | null;
  created_by: string;
}

async function session(): Promise<{ client: SupabaseClient; me: string } | null> {
  let client: SupabaseClient;
  try {
    client = accountClient();
  } catch {
    return null; // accounts aren't set up in this build
  }
  const { data } = await client.auth.getSession();
  const me = data.session?.user.id;
  return me ? { client, me } : null;
}

// A database the migration hasn't reached yet (or an older one) has no team_agents: no team agents, nothing broken.
const missingTable = (code: string | undefined) => code === "PGRST205" || code === "42P01";

// Your teams and their agents, into the cache. Signed out clears it; offline (or any other failure) keeps the last copy.
// A sign-in that can't be read (a refresh that failed on the network) counts as offline, so a share that went through
// never reports an error because the pull after it couldn't run.
export async function pullTeamAgents(): Promise<boolean> {
  let s: Awaited<ReturnType<typeof session>>;
  try {
    s = await session();
  } catch {
    return false;
  }
  if (!s) {
    if (readTeamCache().me) writeTeamCache({ me: null, teams: [], rows: [] });
    return false;
  }
  const [teamsRes, rowsRes] = await Promise.all([
    s.client.from("org_memberships").select("org_id, orgs(id, name, org_memberships(count))").eq("user_id", s.me),
    s.client.from("team_agents").select(COLUMNS),
  ]);
  if (teamsRes.error) return false;
  const teams = sharingTeams(teamsRes.data as unknown as Membership[], rowsRes.error ? [] : rowsRes.data, s.me);
  let rows: TeamAgentRow[];
  if (rowsRes.error) {
    if (!missingTable(rowsRes.error.code)) return false;
    rows = [];
  } else {
    const names = new Map(teams.map((t) => [t.id, t.name]));
    rows = (rowsRes.data as Row[]).map((r) => ({
      orgId: r.org_id,
      orgName: names.get(r.org_id) ?? "Your team",
      agentId: r.agent_id,
      name: r.name,
      emoji: r.emoji,
      tagline: r.tagline,
      soul: r.soul,
      skillsOff: r.skills_off ?? [],
      createdBy: r.created_by,
    }));
  }
  writeTeamCache({ me: s.me, teams, rows });
  return true;
}

type Membership = { orgs: (TeamRef & { org_memberships?: { count: number }[] }) | null };

// The teams an agent can go to: ones with someone else in them. A workspace of one (your personal one, say) has no
// one to share with, so Share with… leaves it out, unless something of yours is already there to take down. A count
// that didn't come back keeps the team.
function sharingTeams(memberships: Membership[], rows: Row[], me: string): TeamRef[] {
  const mineIn = new Set(rows.filter((r) => r.created_by === me).map((r) => r.org_id));
  const teams: TeamRef[] = [];
  for (const { orgs } of memberships) {
    if (!orgs) continue;
    const members = orgs.org_memberships?.[0]?.count ?? 2;
    if (members > 1 || mineIn.has(orgs.id)) teams.push({ id: orgs.id, name: orgs.name });
  }
  return teams;
}

let lastPull = 0;

// A pull now unless one ran in the last minute; never throws.
export function syncTeamAgentsSoon(now = Date.now()) {
  if (now - lastPull < SOON_MS) return;
  lastPull = now;
  void pullTeamAgents().catch(() => {});
}

// For tests.
export function forgetTeamPull() {
  lastPull = 0;
  pushOwed = false;
}

// One of yours that can go to a team: made by you (a built-in shares as a duplicate; a team's agent is its sharer's).
function shareable(agentId: string) {
  const agent = listAgents().find((a) => a.id === agentId);
  if (!agent) throw new Error("No such agent.");
  if (agent.team) throw new Error(`${agent.name} is already ${agent.team.name}'s.`);
  if (isBuiltIn(agent.id)) throw new Error(`${agent.name} is built in, so every Weft has it. Duplicate it to share your version.`);
  return agent;
}

async function signedInOrThrow() {
  const s = await session();
  if (!s) throw new Error("Sign in to Weft to share agents with a team.");
  return s;
}

const rowOf = (orgId: string, a: ReturnType<typeof shareable>) => ({
  org_id: orgId,
  agent_id: a.id,
  name: a.name,
  emoji: a.emoji,
  tagline: a.tagline,
  soul: a.soul,
  skills_off: a.skillsOff ?? [],
});

type WriteError = { code?: string; message: string } | null;

// team_agents grants update on the words alone, and an upsert's DO UPDATE sets every column it was sent, org_id and
// agent_id too, so Postgres refuses the whole statement, even a first share (docs/bug-fixes/020). A team's copy that's
// already there is updated; with none, it's inserted.
async function writeShare(client: SupabaseClient, row: ReturnType<typeof rowOf>): Promise<WriteError> {
  const { org_id, agent_id, ...words } = row;
  const updated = await client.from("team_agents").update(words).eq("org_id", org_id).eq("agent_id", agent_id).select("agent_id");
  if (updated.error) return updated.error;
  if (updated.data.length) return null;
  return (await client.from("team_agents").insert(row)).error;
}

export async function shareAgent(agentId: string, orgId: string): Promise<void> {
  const agent = shareable(agentId);
  const { client } = await signedInOrThrow();
  const error = await writeShare(client, rowOf(orgId, agent));
  if (error) throw new Error(missingTable(error.code) ? "Team agents aren't set up on Weft's server yet." : `Couldn't share ${agent.name}: ${error.message}`);
  await pullTeamAgents();
}

export async function unshareAgent(agentId: string, orgId: string): Promise<void> {
  const { client } = await signedInOrThrow();
  const { error } = await client.from("team_agents").delete().eq("org_id", orgId).eq("agent_id", agentId);
  if (error) throw new Error(`Couldn't stop sharing: ${error.message}`);
  await pullTeamAgents();
}

// Each team's copy of one agent, one at a time; the first failure is the one reported.
async function pushCopies(client: SupabaseClient, agent: ReturnType<typeof shareable>, orgIds: string[]): Promise<WriteError> {
  let first: WriteError = null;
  for (const org of orgIds) {
    const error = await writeShare(client, rowOf(org, agent));
    first ??= error;
  }
  return first;
}

// Set when a push left a team's copy behind, so the ten-minute timer pushes again rather than waiting for your next save.
let pushOwed = false;

// After you edit or delete one you share: its team copies follow (or go). A failure is pushed again on the next save or
// the next ten-minute tick, whichever comes first.
export async function pushMyShares(): Promise<void> {
  const shares = Object.entries(myShares());
  if (!shares.length) return;
  const s = await session();
  if (!s) return;
  const mine = new Map(savedAgents().map((a) => [a.id, a]));
  let failed = false;
  for (const [agentId, orgIds] of shares) {
    const agent = mine.get(agentId);
    const error = agent ? await pushCopies(s.client, agent, orgIds) : (await s.client.from("team_agents").delete().eq("agent_id", agentId).in("org_id", orgIds)).error;
    if (error) console.warn(`Team agents: couldn't update ${agent?.name ?? agentId}: ${error.message}`);
    failed ||= !!error;
  }
  pushOwed = failed;
  await pullTeamAgents();
}

// The ten-minute tick: a push when one is owed (it pulls after), else a pull.
export function teamAgentsTick(): Promise<unknown> {
  return pushOwed ? pushMyShares() : pullTeamAgents();
}

// Server start (lib/cloud-sync-start.ts): a pull now and every ten minutes, and your shared copies after each save.
export function startTeamAgentsSync(): () => void {
  syncTeamAgentsSoon();
  const timer = setInterval(() => void teamAgentsTick().catch(() => {}), PULL_EVERY_MS);
  timer.unref();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const stopListening = onAgentsSaved(() => {
    clearTimeout(pending);
    pending = setTimeout(() => void pushMyShares().catch(() => {}), PUSH_AFTER_MS);
  });
  return () => {
    clearInterval(timer);
    clearTimeout(pending);
    stopListening();
  };
}
