// Project Sync across your Macs. Settings `syncFolders` holds local paths, which differ from Mac to Mac, so the switch
// is also kept per GitHub repo in public.cloud_sync_repos (supabase/migrations/20261026145209_cloud_sync_repos.sql):
// turning a project on or off records its repo, and every Mac signed in to the same account turns sync on for its own
// clone of an enabled repo: at start, every minute after (which catches a fresh sign-in), and the moment a project
// lands on the board (cloned, opened, or a new card's folder). Before this a second Mac started with every project off.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { queueFolder } from "./cloud-sync";
import { onProjectOpen } from "./project-open";
import { githubRepoOf } from "./repos";
import { listProjects, setSyncFolder, syncFolders } from "./settings";

const TABLE = "cloud_sync_repos";
export const ADOPT_EVERY_MS = 60_000;

type Client = SupabaseClient | null;

function safeClient(): Client {
  try {
    return accountClient();
  } catch {
    return null;
  }
}

async function ownerOf(client: Client): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

// Records the Sync switch for a folder's repo, so your other Macs follow it. Nothing for a folder with no GitHub
// origin, or when signed out.
export async function rememberSyncRepo(folder: string, on: boolean, client: Client = safeClient()): Promise<void> {
  const repo = githubRepoOf(folder);
  const owner = repo ? await ownerOf(client) : null;
  if (!repo || !owner || !client) return;
  const { error } = await client.from(TABLE).upsert({ owner_user: owner, repo, enabled: on }, { onConflict: "owner_user,repo" });
  if (error) throw new Error(`Couldn't record sync for ${repo}: ${error.message}`);
}

// Publishes the repos this Mac already syncs (without overriding a switch made on another Mac), then turns sync on
// for each of `folders` whose repo is enabled for this account. Returns the folders it turned on.
export async function adoptSyncRepos(folders: string[] = listProjects().map((p) => p.path), client: Client = safeClient()): Promise<string[]> {
  const owner = await ownerOf(client);
  if (!owner || !client) return [];
  const mine = [...new Set(syncFolders().map(githubRepoOf).filter((r): r is string => Boolean(r)))];
  if (mine.length) {
    const rows = mine.map((repo) => ({ owner_user: owner, repo, enabled: true }));
    const { error } = await client.from(TABLE).upsert(rows, { onConflict: "owner_user,repo", ignoreDuplicates: true });
    if (error) throw new Error(`Couldn't publish synced repos: ${error.message}`);
  }
  const { data, error } = await client.from(TABLE).select("repo").eq("owner_user", owner).eq("enabled", true);
  if (error) throw new Error(`Couldn't read synced repos: ${error.message}`);
  const enabled = new Set(((data as { repo: string }[] | null) ?? []).map((r) => r.repo.toLowerCase()));
  const on = new Set(syncFolders());
  const turned: string[] = [];
  for (const folder of new Set(folders)) {
    const repo = on.has(folder) ? undefined : githubRepoOf(folder);
    if (!repo || !enabled.has(repo.toLowerCase())) continue;
    setSyncFolder(folder, true);
    queueFolder(folder);
    turned.push(folder);
  }
  return turned;
}

// One warning per streak of failures (a missing table, no network), so a minute's tick can't flood the log.
let warned = false;
function adopt(folders?: string[]) {
  adoptSyncRepos(folders).then(
    (turned) => {
      warned = false;
      if (turned.length) console.log(`[weft] project sync turned on from your other Macs: ${turned.join(", ")}`);
    },
    (err: unknown) => {
      if (!warned) console.warn("[weft] project sync across Macs:", String(err));
      warned = true;
    },
  );
}

// From startAccountCloudSync (lib/cloud-sync-start.ts).
export function startSyncRepos(): () => void {
  onProjectOpen("sync-repos", (folder) => adopt([folder]));
  adopt();
  const tick = setInterval(() => adopt(), ADOPT_EVERY_MS);
  tick.unref();
  return () => clearInterval(tick);
}
