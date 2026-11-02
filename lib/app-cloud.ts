// Every mini app (its row, and for a file/folder app its page and manifest) is stored in Weft's production
// Supabase, table cloud_mini_apps, under the signed-in account, and restored on a Mac that lacks it
// (docs/architecture/mini-apps.md). Saves, renames, moves and removes push; a throttled pull (on GET /api/apps,
// at most every 5 minutes, in the background) restores apps this Mac lacks into ~/.weft/apps/<app_id>/ and
// apps.json. A removed app is a tombstone (deleted = true) so a pull never brings it back. Best effort: a
// failure never breaks the local save.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { resolvePage } from "./blob-paths";
import { createBlobStore, sha256Of } from "./blob-store";
import { syncOrgId } from "./cloud-sync";
import { globalSingleton } from "./global-singleton";
import { isWorkerAppFolder, type MiniApp } from "./mini-apps";
import { listApps, insertAppAt } from "./mini-app-store";
import { DATA_DIR } from "./store";

const PULL_INTERVAL_MS = 5 * 60 * 1000;
// Computed lazily so tests that override WEFT_DATA after import still see their own dir.
const APPS_DIR = () => path.join(DATA_DIR, "apps");

// A row the pull reads. Only the columns lib/app-cloud.ts writes are selectable here.
type CloudRow = {
  app_id: string;
  org_id: string;
  name: string;
  url: string;
  kind: "site" | "file" | "folder";
  page: string | null;
  manifest: Record<string, unknown> | null;
  position: number;
  deleted: boolean;
};

function check(err: { message: string } | null) {
  if (err) throw new Error(err.message);
}

function safeClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null; // accounts aren't set up in this build
  }
}

// The signed-in account and its workspace, or null when any step is missing. Every push and pull starts here.
async function account(): Promise<{ client: SupabaseClient; orgId: string } | null> {
  const client = safeClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  const orgId = await syncOrgId(client, userId);
  if (!orgId) return null;
  return { client, orgId };
}

// A folder app's manifest, parsed from weft-app.json beside index.html. The whole file's contents go in.
function readManifest(appDir: string): Record<string, unknown> | undefined {
  const manifestPath = path.join(appDir, "weft-app.json");
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// The row's columns for what the app is now. `file:` URLs may be any page under home Weft can upload
// (a folder app's index.html, a show rail page); resolvePage refuses secrets and the vault. A folder
// is only a folder when the page lives one level under APPS_DIR and the manifest parses; else it's a file.
type Payload = { local: string; row: Record<string, unknown> };

async function buildPayload(app: MiniApp, orgId: string): Promise<Payload | null> {
  if (app.url.startsWith("http://") || app.url.startsWith("https://")) {
    return { local: "", row: { org_id: orgId, name: app.name, url: app.url, kind: "site", page: null, manifest: null, position: 0 } };
  }
  if (!app.url.startsWith("file://")) return null;
  const resolved = resolvePage(app.url);
  if (!resolved) return null;
  const sha = await sha256Of(resolved.local);
  if (!sha) return null;
  const appDir = path.dirname(resolved.local);
  // A worker card's page carries no manifest anywhere (lib/mini-apps.ts isWorkerAppFolder).
  const manifest = path.dirname(appDir) === APPS_DIR() && !isWorkerAppFolder(appDir) ? readManifest(appDir) : undefined;
  const isFolder = manifest !== undefined;
  return {
    local: resolved.local,
    row: {
      org_id: orgId, name: app.name, url: app.url, kind: isFolder ? "folder" : "file",
      page: `blob:sha256:${sha}`, manifest: isFolder ? manifest : null, position: 0,
    },
  };
}

// The app's row: read by app_id (maybeSingle), then update or insert. An update always sets deleted
// false so saving an app again after it was removed brings the row back. Inserts include app_id since
// the column grant doesn't allow updating it.
async function writeOne(client: SupabaseClient, app: MiniApp, orgId: string): Promise<void> {
  const payload = await buildPayload(app, orgId);
  if (!payload) return; // not a kind we persist
  const position = listApps().findIndex((a) => a.id === app.id);
  payload.row.position = position < 0 ? 0 : position;
  // Read the own row once: it tells us whether to insert or update and whether the page's hash already matches.
  const existing = await client
    .from("cloud_mini_apps")
    .select("page")
    .eq("app_id", app.id)
    .maybeSingle<{ page: string | null }>();
  check(existing.error);
  // Upload the page if it isn't already at the same hash as the row says. The SHA in the page ref
  // matches a file on disk; upload is content-addressed and treats a 409 as success. A site has no
  // local page to upload.
  if (payload.local && payload.row.page !== existing.data?.page) {
    const ref = await createBlobStore({ client }).upload(payload.local, orgId);
    if (!ref) return; // file gone by the time we read it
  }
  // deleted is in the update grant only: a new row starts false by default.
  if (existing.data) {
    const { error } = await client.from("cloud_mini_apps").update({ ...payload.row, deleted: false }).eq("app_id", app.id);
    check(error);
  } else {
    const { error } = await client.from("cloud_mini_apps").insert({ app_id: app.id, ...payload.row });
    check(error);
  }
}

// Push the app to prod after a save, rename, or move. Best effort: signed out, no workspace, or any
// failure is swallowed so the local save wins.
export async function pushApp(app: MiniApp): Promise<void> {
  const a = await account();
  if (!a) return;
  try {
    await writeOne(a.client, app, a.orgId);
  } catch (err) {
    // Best effort: the local save stands. The server log says why, as cloud sync's does.
    console.warn(`Mini app push to prod failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tombstone the app's row. Best effort, same swallowing as pushApp.
export async function dropCloudApp(appId: string): Promise<void> {
  const a = await account();
  if (!a) return;
  try {
    const { error } = await a.client.from("cloud_mini_apps").update({ deleted: true }).eq("app_id", appId);
    check(error);
  } catch (err) {
    // Best effort: the local save stands. The server log says why, as cloud sync's does.
    console.warn(`Mini app remove to prod failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Pull prod's rows this Mac doesn't have and bring them home: site → add the app with its URL; file/folder →
// fetchBlob the page, write APPS_DIR/<app_id>/index.html, and weft-app.json from the manifest for a folder.
// Errors are swallowed; one bad row never blocks the others.
async function pullOne(client: SupabaseClient, row: CloudRow, orgId: string) {
  if (row.kind === "site") {
    insertAppAt(row.app_id, { name: row.name, url: row.url, addedAt: Date.now() }, row.position);
    return;
  }
  if (!row.page) return;
  const file = await createBlobStore({ client }).fetchBlob(row.page as `blob:sha256:${string}`, orgId);
  if (!file) return;
  const appDir = path.join(APPS_DIR(), row.app_id);
  fs.mkdirSync(appDir, { recursive: true });
  fs.copyFileSync(file, path.join(appDir, "index.html"));
  if (row.kind === "folder" && row.manifest && !isWorkerAppFolder(row.app_id)) {
    fs.writeFileSync(path.join(appDir, "weft-app.json"), JSON.stringify(row.manifest, null, 2));
  }
  const url = pathToFileURL(path.join(APPS_DIR(), row.app_id, "index.html")).href;
  insertAppAt(row.app_id, { name: row.name, url, addedAt: Date.now() }, row.position);
}

// One sync: bring home the rows this Mac lacks and that aren't deleted, in row position order, then push the
// apps prod has no row for at all (saved before this existed, or while signed out). A tombstone is left alone
// both ways: removed on another Mac, the app neither comes back there nor leaves this one.
export async function pullApps(): Promise<void> {
  const a = await account();
  if (!a) return;
  const { data: rows, error } = await a.client
    .from("cloud_mini_apps")
    .select("app_id, org_id, name, url, kind, page, manifest, position, deleted")
    .order("position", { ascending: true });
  check(error);
  const local = new Set(listApps().map((a) => a.id));
  for (const row of (rows ?? []) as CloudRow[]) {
    if (row.deleted || local.has(row.app_id)) continue;
    try {
      await pullOne(a.client, row, a.orgId);
    } catch {
      // one row's failure doesn't stop the rest
    }
  }
  const known = new Set(((rows ?? []) as CloudRow[]).map((r) => r.app_id));
  for (const app of listApps().filter((x) => !known.has(x.id))) {
    try {
      await writeOne(a.client, app, a.orgId);
    } catch (err) {
      console.warn(`Mini app push to prod failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// A pull, throttled: at most one every 5 minutes, in the background, errors swallowed. Called from GET
// /api/apps so a card that lists apps will eventually see the ones the user saved on another Mac. The
// throttle state lives on globalThis so tests can reset it.
function throttleState(): { lastPullAt: number; inFlight: Promise<void> | null } {
  return globalSingleton("__weftAppCloud", () => ({ lastPullAt: 0, inFlight: null as Promise<void> | null }));
}
export function syncAppsSoon(): void {
  const state = throttleState();
  const now = Date.now();
  if (now - state.lastPullAt < PULL_INTERVAL_MS) return;
  if (state.inFlight) return;
  state.lastPullAt = now;
  state.inFlight = pullApps().catch(() => {}).finally(() => { state.inFlight = null; });
}
