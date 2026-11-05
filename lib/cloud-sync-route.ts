// Which workspace each synced card goes to. A folder whose GitHub repo a team you're in has linked (public.org_projects,
// Settings → Teams → Projects) syncs to that team, so every member reads it on the team's board; any other folder
// syncs to your personal workspace, as before (docs/architecture/cloud-sync.md#team-projects). The answer comes from
// public.team_orgs_for_repos (supabase/migrations/20261105065328_team_orgs_for_repos.sql), which only says which of
// the asked repos your teams linked, never a team's other projects.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboxEntry } from "./cloud-sync-types";
import { globalSingleton } from "./global-singleton";
import { githubRepoOf } from "./repos";
import { getCard } from "./store";

// How long a repo's answer is kept: a project linked on weft.zip reaches the Macs within a minute.
export const ROUTE_TTL_MS = 60_000;

// Where a flush sends each card: `home` is the personal workspace, `orgOf` a card's own, and `all` every workspace
// this Mac has sent cards to, which is where a delete has to look (the card, and so its folder, is gone).
export interface SyncRoute {
  home: string;
  orgOf(cardId: string): string;
  all(): string[];
}

interface Answer {
  org: string | null;
  at: number;
}

// repo (lowercased) → the team that linked it, or null for none; and each card's last workspace, for its delete.
const state = () => globalSingleton("__weftSyncRoutes", () => ({ repos: new Map<string, Answer>(), cards: new Map<string, string>() }));

// Ask again on the next flush: a team was joined, left or deleted (lib/cloud-sync.ts forgetSyncOrg).
export function forgetRoutes(): void {
  state().repos.clear();
}

// A database without the function yet (the app ships ahead of its migration) routes everything home.
const missingFunction = (error: { code?: string; message?: string }) => error.code === "PGRST202" || /function .* does not exist/i.test(error.message ?? "");

// Each repo's team, asking only for those not answered in the last ROUTE_TTL_MS. Any other error throws, so the
// flush backs off rather than send a team's card to the personal workspace.
export async function teamOrgsFor(client: SupabaseClient, repos: string[], now: number): Promise<Map<string, string | null>> {
  const known = state().repos;
  const keys = [...new Set(repos.map((r) => r.toLowerCase()))];
  const ask = keys.filter((k) => {
    const hit = known.get(k);
    return !hit || now - hit.at >= ROUTE_TTL_MS;
  });
  if (ask.length) {
    const { data, error } = (await client.rpc("team_orgs_for_repos", { repos: ask })) as { data: { repo: string; org_id: string }[] | null; error: { code?: string; message: string } | null };
    if (error && !missingFunction(error)) throw new Error(`Couldn't read the team projects: ${error.message}`);
    const linked = new Map((data ?? []).map((row) => [row.repo.toLowerCase(), row.org_id]));
    for (const k of ask) known.set(k, { org: linked.get(k) ?? null, at: now });
  }
  return new Map(keys.map((k) => [k, known.get(k)?.org ?? null]));
}

// The workspace for one folder: its repo's team, or home.
export async function orgForFolder(client: SupabaseClient, home: string, folder: string, now = Date.now()): Promise<string> {
  const repo = githubRepoOf(folder);
  if (!repo) return home;
  return (await teamOrgsFor(client, [repo], now)).get(repo.toLowerCase()) ?? home;
}

// The route for one flush's entries: each live card's folder → repo → team, read once per repo.
export async function routeFor(client: SupabaseClient, home: string, pending: OutboxEntry[], now: number): Promise<SyncRoute> {
  const { cards } = state();
  const repoOf = new Map<string, string>();
  for (const entry of pending) {
    const card = entry.op === "card_deleted" ? undefined : getCard(entry.cardId);
    const repo = card ? githubRepoOf(card.cwd) : undefined;
    if (repo) repoOf.set(entry.cardId, repo.toLowerCase());
  }
  const teams = repoOf.size ? await teamOrgsFor(client, [...repoOf.values()], now) : new Map<string, string | null>();
  for (const [cardId, repo] of repoOf) cards.set(cardId, teams.get(repo) ?? home);
  return {
    home,
    orgOf: (cardId) => (repoOf.has(cardId) ? (cards.get(cardId) ?? home) : home),
    all: () => [...new Set([home, ...cards.values(), ...[...state().repos.values()].flatMap((a) => (a.org ? [a.org] : []))])],
  };
}

// A route that sends every card to one workspace: a caller that hasn't any teams to think about.
export const singleRoute = (orgId: string): SyncRoute => ({ home: orgId, orgOf: () => orgId, all: () => [orgId] });

// The entries grouped by workspace, each group in outbox order.
export function byOrg<T extends { cardId: string }>(entries: T[], route: SyncRoute): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const org = route.orgOf(entry.cardId);
    groups.set(org, [...(groups.get(org) ?? []), entry]);
  }
  return groups;
}
