// Your teammates' cards on your desktop board (docs/architecture/cloud-sync.md#team-projects-on-the-desktop-board): a
// project you've checked out here whose GitHub repo a team you're in has linked syncs to that team
// (lib/cloud-sync-route.ts), and so do your teammates' checkouts of it. This reads their rows back, by repo
// (cloud_cards.repo), since `folder` is a path on their Mac, and files each card under your own folder for that repo,
// marked with whose it is (Card.team). Signed in as you (lib/account.ts), so RLS decides; nothing here writes, and no
// teammate's card is ever copied into the local store. Their threads read through lib/cloud-thread-read.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { teamOrgsFor } from "./cloud-sync-route";
import { threadPageIn, toolOutputIn } from "./cloud-thread-read";
import { githubRepoOf } from "./repos";
import { listProjects } from "./settings";
import type { TeamBoard } from "./team-board-types";
import type { ThreadPage } from "./thread-page";
import type { Card } from "./types";
import { openCardRows } from "./worker-board-open";

// The cards one read takes per workspace, newest first.
export const TEAM_CARD_LIMIT = 300;
// A changed-cards read starts this far before its `since`, so a row committed a moment late isn't missed.
const SINCE_OVERLAP_MS = 2_000;
// How long this Mac's repo → folder table is kept: reading every project's git config each poll is wasted work.
export const FOLDERS_TTL_MS = 60_000;

interface TeamRow {
  card_id: string;
  owner_user: string;
  owner_device: string;
  repo: string;
  card: Card;
  updated_at?: string;
  deleted?: boolean;
}

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

let folders: { at: number; map: Map<string, string> } | null = null;

// Each GitHub repo this Mac has a project for (lowercased) → that project's folder; the most recently used wins when
// two folders share a repo.
export function repoFolders(now = Date.now(), projects = listProjects): Map<string, string> {
  if (folders && now - folders.at < FOLDERS_TTL_MS) return folders.map;
  const map = new Map<string, string>();
  for (const project of projects()) {
    const repo = githubRepoOf(project.path)?.toLowerCase();
    if (repo && !map.has(repo)) map.set(repo, project.path);
  }
  folders = { at: now, map };
  return map;
}

// For tests: read the projects again.
export function forgetRepoFolders(): void {
  folders = null;
}

// A database without cloud_cards.repo yet (the app ships ahead of its migration) has no team cards to show.
const missingColumn = (error: { code?: string }) => error.code === "42703" || error.code === "PGRST204";

// One team's cards for these repos, not yours, newest first. A changed read (`from`) takes the deleted rows too.
async function teamRows(client: SupabaseClient, org: string, repos: string[], uid: string, from: string | null): Promise<TeamRow[]> {
  const query = client.from("cloud_cards").select("card_id, owner_user, owner_device, repo, card, updated_at, deleted").eq("org_id", org).in("repo", repos).neq("owner_user", uid);
  const { data, error } = await (from ? query.gt("updated_at", from) : query.eq("deleted", false)).order("updated_at", { ascending: false }).limit(TEAM_CARD_LIMIT);
  if (error && missingColumn(error)) return [];
  if (error) throw new Error(`Couldn't read your team's threads: ${error.message}`);
  return openCardRows(org, data as TeamRow[]);
}

// The owners' names and pictures, read as you ("profiles: read teammates").
async function profiles(client: SupabaseClient, ids: string[]): Promise<Map<string, Profile>> {
  if (!ids.length) return new Map();
  const { data } = (await client.from("profiles").select("id, display_name, avatar_url").in("id", ids)) as { data: Profile[] | null };
  return new Map((data ?? []).map((p) => [p.id, p]));
}

// A row as the board draws it: under your folder for its repo, marked with its team, owner and Mac.
export function teamCard(row: TeamRow, org: string, folder: string, who: Profile | undefined): Card {
  return { ...row.card, cwd: folder, team: { org, owner: row.owner_user, name: who?.display_name?.trim() || "A teammate", avatar: who?.avatar_url ?? null, device: row.owner_device } };
}

// Whether a row is drawn: a live card that isn't its owner's copilot.
const drawn = (row: TeamRow) => !row.deleted && row.card.role !== "copilot";

// Repos grouped by the team that linked them.
function byTeam(teams: Map<string, string | null>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [repo, org] of teams) if (org) out.set(org, [...(out.get(org) ?? []), repo]);
  return out;
}

// Your teammates' cards for your projects. With `since` (the last read's `asOf`) only the cards changed after it come
// back, marked `delta`, with the ones gone in `removed`; the board merges them (lib/team-board-types.ts mergeTeamBoard).
export async function readTeamBoard(client: SupabaseClient = accountClient(), since?: string, now = Date.now(), local = repoFolders): Promise<TeamBoard> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return { signedIn: false, cards: [] };
  const mine = local(now);
  if (!mine.size) return { signedIn: true, cards: [] };
  const teams = byTeam(await teamOrgsFor(client, [...mine.keys()], now));
  const from = since && Number.isFinite(Date.parse(since)) ? new Date(Date.parse(since) - SINCE_OVERLAP_MS).toISOString() : null;
  const reads = await Promise.all([...teams].map(async ([org, repos]) => ({ org, rows: await teamRows(client, org, repos, uid, from) })));
  const all = reads.flatMap(({ org, rows }) => rows.map((row) => ({ org, row })));
  const who = await profiles(client, [...new Set(all.map((r) => r.row.owner_user))]);
  const cards = all.filter((r) => drawn(r.row) && mine.has(r.row.repo)).map((r) => teamCard(r.row, r.org, mine.get(r.row.repo) as string, who.get(r.row.owner_user)));
  const stamps = all.flatMap((r) => (r.row.updated_at ? [Date.parse(r.row.updated_at)] : [])).filter(Number.isFinite);
  const asOf = stamps.length ? new Date(Math.max(...stamps)).toISOString() : from ? since : undefined;
  // A changed read that filled a team's limit is sent whole, like the worker board's.
  const delta = from !== null && reads.every((r) => r.rows.length < TEAM_CARD_LIMIT);
  const removed = delta ? all.filter((r) => !drawn(r.row)).map((r) => r.row.card_id) : [];
  return { signedIn: true, cards, ...(asOf ? { asOf } : {}), ...(delta ? { delta: true, removed } : {}) };
}

// A teammate's card's thread and cut tool outputs, read in the team's workspace the card names.
export const teamThreadPage = (org: string, cardId: string, before?: number, after?: number, client: SupabaseClient = accountClient()): Promise<ThreadPage | null> =>
  threadPageIn(client, org, cardId, before, after);

export const teamToolOutput = (org: string, cardId: string, toolId: string, client: SupabaseClient = accountClient()): Promise<string> => toolOutputIn(client, org, cardId, toolId);
