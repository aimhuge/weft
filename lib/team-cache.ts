"use client";

import { apiFetch } from "./api-client";
import { readSavedOrg } from "./team-view";
import type { TeamSnapshot } from "./team-types";

// The board's copy of each workspace's team (docs/architecture/teams.md, "Opening instantly"). A load from
// weft.zip takes a second or two (the local route forwards to weft.zip, which checks the token and reads the
// team from Supabase), so Settings → Teams opens on the last answer and checks again behind it:
// - in memory: the last answer per workspace ("" is your default one), filled by a prefetch at board start;
// - on disk: the last good answers in localStorage, so a cold start (a restart, a reload) opens on them too.
// Only the signed-in account's own snapshots come back from disk (each carries its user id).

export type TeamLoadState =
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ok"; team: TeamSnapshot };

export const TEAM_CACHE_KEY = "weft-team-cache";
// How many other workspaces to warm once the list is known, so a switch opens instantly too.
const WARM_LIMIT = 6;

// We can't read the status from the typed `api` client (it throws on non-2xx), so this asks the server
// directly and maps the status to a state. The forwarder has already turned a fetch error into a
// 502 { error: "offline" } reply, so a 502 here is "we couldn't reach weft.zip".
export async function fetchTeam(org: string | undefined): Promise<TeamLoadState> {
  const query = org ? `?org=${encodeURIComponent(org)}` : "";
  let res: Response;
  try {
    res = await apiFetch(`/api/account/team${query}`, { method: "GET" });
  } catch {
    return { kind: "error", message: "Couldn't reach weft.zip." };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: unknown } & Partial<TeamSnapshot>;
  if (res.status === 401) return { kind: "signed-out" };
  if (res.status === 404) return { kind: "error", message: "No workspace found." };
  if (res.status === 502) return { kind: "error", message: "Couldn't reach weft.zip." };
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `Weft's team API answered ${res.status}.`;
    return { kind: "error", message };
  }
  // The 2xx path: weft.zip's /api/teams is the only producer of TeamSnapshot the board reads, so a
  // structurally wrong reply is the deployer's problem; we still try to render what we got.
  return { kind: "ok", team: body as TeamSnapshot };
}

const cache = new Map<string, TeamLoadState>();
const inflight = new Map<string, Promise<TeamLoadState>>();

// What's on disk is whatever an earlier Weft wrote, so an entry may be empty or partial.
type DiskTeams = Record<string, Partial<TeamSnapshot> | null | undefined>;

function readDisk(): DiskTeams {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TEAM_CACHE_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as DiskTeams) : {};
  } catch {
    return {};
  }
}

function writeDisk(teams: DiskTeams | null): void {
  try {
    if (teams && Object.keys(teams).length) window.localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify(teams));
    else window.localStorage.removeItem(TEAM_CACHE_KEY);
  } catch {
    // Private mode or a full disk: the next cold start just loads.
  }
}

// Keep a good answer on disk; a signed-out answer forgets them all, an error leaves the last good one.
function remember(key: string, state: TeamLoadState): void {
  if (state.kind === "ok") writeDisk({ ...readDisk(), [key]: state.team });
  else if (state.kind === "signed-out") writeDisk(null);
}

export function cachedTeam(org: string | undefined): TeamLoadState | undefined {
  return cache.get(org ?? "");
}

// A fetch that lands in the cache. A first load joins a prefetch already on its way; a refresh (after an
// action, a sign-in) always asks again, so it can't come back with an answer from before the change.
export function loadTeam(org: string | undefined, fresh: boolean): Promise<TeamLoadState> {
  const key = org ?? "";
  const running = inflight.get(key);
  if (running && !fresh) return running;
  const next = fetchTeam(org).then((state) => {
    cache.set(key, state);
    remember(key, state);
    return state;
  });
  inflight.set(key, next);
  void next.finally(() => {
    if (inflight.get(key) === next) inflight.delete(key);
  });
  return next;
}

// Load a workspace's team ahead of time, unless it's already loaded or loading.
export function prefetchTeam(org?: string): void {
  if (cache.get(org ?? "")?.kind === "ok" || inflight.has(org ?? "")) return;
  void loadTeam(org, false);
}

// Warm the workspaces in a loaded list you haven't opened yet, so switching to one opens instantly.
export function prefetchTeams(slugs: string[]): void {
  for (const slug of slugs.slice(0, WARM_LIMIT)) prefetchTeam(slug);
}

// Forget every loaded team: on sign-out, or a switch to another account. `disk` also drops the copies on disk.
export function clearTeamCache(disk = true): void {
  cache.clear();
  inflight.clear();
  if (disk) writeDisk(null);
}

// Put this account's snapshots from disk back in memory; another account's are dropped, disk and all.
export function hydrateTeamCache(userId: string): void {
  const teams = readDisk();
  const mine = Object.entries(teams).filter((entry): entry is [string, TeamSnapshot] => entry[1]?.user?.id === userId);
  if (mine.length !== Object.keys(teams).length) writeDisk(Object.fromEntries(mine));
  for (const [key, team] of mine) if (!cache.has(key)) cache.set(key, { kind: "ok", team });
}

// What the top bar does once you're signed in: last answers back from disk, then a fresh load of your default
// workspace and of the one Settings → Teams opens on (the one you last picked), so neither waits on weft.zip.
export function warmTeams(userId: string): void {
  hydrateTeamCache(userId);
  void loadTeam(undefined, false);
  const saved = readSavedOrg();
  if (saved) void loadTeam(saved, false);
}
