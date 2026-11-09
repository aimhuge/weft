// A team's linked project syncs for every member, with no Sync switch of their own (docs/architecture/teams.md#shared-projects).
// Each minute, and the moment a project lands on the board, this asks which of the board's folders have a GitHub repo
// a team you're in linked (the same answer lib/cloud-sync-route.ts routes by), and keeps those folders here. The
// outbox and the inbox treat them as synced alongside settings `syncFolders`; a folder that just became linked gets its
// existing cards queued, once: the folders already queued are kept in BACKFILLED_FILE, so a restart doesn't queue a
// project's whole history again. Unlinking drops the folder on the next check, so the person's own switch decides again.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { teamOrgsFor } from "./cloud-sync-route";
import { globalSingleton } from "./global-singleton";
import { onProjectOpen } from "./project-open";
import { githubRepoOf } from "./repos";
import { listProjects, syncFolders } from "./settings";
import { DATA_DIR } from "./store";

export const TEAM_SYNC_EVERY_MS = 60_000;

export const BACKFILLED_FILE = path.join(DATA_DIR, "team-sync-backfilled.json");

function readBackfilled(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(BACKFILLED_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}

function writeBackfilled(folders: Set<string>): void {
  fs.mkdirSync(path.dirname(BACKFILLED_FILE), { recursive: true });
  fs.writeFileSync(BACKFILLED_FILE, JSON.stringify([...folders]));
}

// Each folder synced because a team linked its repo, and that team's id; and each such team's name, read once.
const state = () => globalSingleton("__weftTeamSyncFolders", () => ({ folders: new Map<string, string>(), names: new Map<string, string>() }));

// The folders synced because a team linked their repo.
export function teamSyncFolders(): string[] {
  return [...state().folders.keys()];
}

// Settings → Sync shows these with the team's name in place of a switch: folder → name ("your team" until it's read).
export function teamSyncNames(): Record<string, string> {
  const { folders, names } = state();
  return Object.fromEntries([...folders].map(([folder, org]) => [folder, names.get(org) ?? "your team"]));
}

// The names of teams not asked about yet, from orgs (members can read their own). Only a label: a failure leaves it.
async function readTeamNames(client: SupabaseClient, orgs: Iterable<string>): Promise<void> {
  const names = state().names;
  const ask = [...new Set(orgs)].filter((org) => !names.has(org));
  if (!ask.length) return;
  const { data } = await client.from("orgs").select("id, name").in("id", ask);
  for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
}

// Every folder whose cards sync: the person's own switches plus their teams' linked projects.
export function syncedFolders(): string[] {
  return [...new Set([...syncFolders(), ...teamSyncFolders()])];
}

function safeClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null;
  }
}

// Re-reads which of `folders` a team linked and returns the ones to queue: linked and not queued before. A folder the
// person already synced is queued too, so its older cards move from their own workspace into the team. Signed out,
// nothing is team-synced.
export async function refreshTeamFolders(folders: string[], client: SupabaseClient | null = safeClient(), now = Date.now()): Promise<string[]> {
  const known = state().folders;
  if (!client) {
    known.clear();
    return [];
  }
  const repoOf = new Map<string, string>();
  for (const f of folders) {
    const repo = githubRepoOf(f);
    if (repo) repoOf.set(f, repo.toLowerCase());
  }
  const teams = repoOf.size ? await teamOrgsFor(client, [...repoOf.values()], now) : new Map<string, string | null>();
  const linkedTo = new Map<string, string>();
  for (const [folder, repo] of repoOf) {
    const org = teams.get(repo);
    if (org) linkedTo.set(folder, org);
  }
  const linked = new Set(linkedTo.keys());
  known.clear();
  for (const [f, org] of linkedTo) known.set(f, org);
  await readTeamNames(client, linkedTo.values()).catch(() => {});
  // A folder that was unlinked is forgotten, so linking it again moves its newer cards back into the team.
  const done = readBackfilled();
  const kept = new Set([...done].filter((f) => linked.has(f) || !repoOf.has(f)));
  const fresh = [...linked].filter((f) => !kept.has(f));
  for (const f of fresh) kept.add(f);
  if (fresh.length || kept.size !== done.size) writeBackfilled(kept);
  return fresh;
}

// One warning per streak of failures, so a minute's tick can't flood the log.
let warned = false;

// From startAccountCloudSync (lib/cloud-sync-start.ts); `queue` is lib/cloud-sync.ts queueFolder.
export function startTeamSync(queue: (folder: string) => void): () => void {
  // A folder just opened may not be in the project list yet, so it's asked about alongside the rest.
  const check = (extra: string[] = []) =>
    refreshTeamFolders([...new Set([...listProjects().map((p) => p.path), ...extra])]).then(
      (fresh) => {
        warned = false;
        for (const folder of fresh) queue(folder);
      },
      (err: unknown) => {
        if (!warned) console.warn("[weft] team project sync:", String(err));
        warned = true;
      },
    );
  onProjectOpen("team-sync", (folder) => void check([folder]));
  void check();
  const tick = setInterval(() => void check(), TEAM_SYNC_EVERY_MS);
  tick.unref();
  return () => clearInterval(tick);
}
