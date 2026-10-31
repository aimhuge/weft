// Settings → Sync → Workers: the Weft Workers enrolled in the workspace this Mac syncs to
// (docs/architecture/weft-worker.md), a one-time token to enrol another, a run sent to one, and Remove. Every call
// is the account's own client, signed in as you, so RLS decides: members read the workspace's workers, the one who
// enrolled a worker removes it, and a run only goes to a worker you enrolled.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { newCardCommand, type NewCommand } from "./cloud-commands";
import { syncOrgId } from "./cloud-sync";
import { deviceId } from "./device-id";
import type { CommandResult } from "./worker-command-wait";
import { cloneCommand, githubLoginCommand, loginCommand, runCommand, updateCommand, workerDevice } from "./worker-commands";
import type { GithubState } from "./worker-github";

export interface WorkerView {
  id: string;
  name: string;
  platform: string;
  arch: string;
  status: "online" | "busy" | "offline";
  lastSeenAt: string | null;
  mine: boolean;
  // headless: a Weft Worker box; desktop: a signed-in Weft desktop that takes the web board's commands (headed).
  kind: "headless" | "desktop";
  // The desktop's device id, which its commands target instead of `worker:<id>`.
  device: string | null;
  // This is the Mac you're reading the list on.
  here: boolean;
  // The GitHub account the worker's git signs in as, and how that stands. Null state: a worker too old to say.
  githubAccount: string | null;
  githubState: GithubState | null;
  // Why your latest clone onto it failed, so a failure outlives the menu it started from.
  cloneError: string | null;
  // What a headless worker runs (0.6.7+abc1234), and why it isn't on the newest commit. Null: a worker too old to say.
  build: string | null;
  updateNote: string | null;
}

export interface WorkersView {
  signedIn: boolean;
  workers: WorkerView[];
}

interface Row {
  id: string;
  owner_user: string;
  name: string;
  platform: string;
  arch: string;
  status: WorkerView["status"];
  last_seen_at: string | null;
  kind?: WorkerView["kind"] | null;
  device?: string | null;
}

interface CloneRow {
  target_device: string;
  status: string;
  error: string | null;
}

interface GithubRow {
  id: string;
  github_account: string | null;
  github_state: GithubState | null;
}

interface BuildRow {
  id: string;
  build: string | null;
  update_note: string | null;
}

// A worker that hasn't heartbeat in this long is offline, whatever its row last said (it heartbeats every 20 s).
export const OFFLINE_AFTER_MS = 60_000;

// The install line a new box runs, with its token.
export const installLine = (token: string) => `curl -fsSL https://weft.zip/worker.sh | sh -s -- ${token}`;

async function session(client: SupabaseClient): Promise<{ uid: string; org: string } | null> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  const org = await syncOrgId(client, uid);
  if (!org) throw new Error("You aren't in a Weft workspace yet.");
  return { uid, org };
}

// Each of your workers' latest clone, by target device, when that clone failed. A newer one that worked clears it.
async function failedClones(client: SupabaseClient, org: string, uid: string): Promise<Map<string, string>> {
  const { data } = (await client
    .from("cloud_commands")
    .select("target_device, status, error")
    .eq("org_id", org)
    .eq("created_by", uid)
    .eq("kind", "clone")
    .order("created_at", { ascending: false })
    .limit(50)) as { data: CloneRow[] | null };
  const latest = new Map<string, CloneRow>();
  for (const row of data ?? []) {
    if (!latest.has(row.target_device)) latest.set(row.target_device, row);
  }
  return new Map([...latest].filter(([, c]) => c.status === "failed").map(([device, c]) => [device, c.error ?? "The clone failed."]));
}

// Each worker's GitHub sign-in, read apart from the list: a database without these columns yet (the app ships ahead
// of its migration) only leaves the line off the row, and the list and Run on Worker keep working.
async function githubSignIns(client: SupabaseClient, org: string): Promise<Map<string, GithubRow>> {
  const { data } = (await client.from("cloud_workers").select("id, github_account, github_state").eq("org_id", org)) as { data: GithubRow[] | null };
  return new Map((data ?? []).map((row) => [row.id, row]));
}

// Each worker's build, read apart from the list for the same reason as its sign-in.
async function workerBuilds(client: SupabaseClient, org: string): Promise<Map<string, BuildRow>> {
  const { data } = (await client.from("cloud_workers").select("id, build, update_note").eq("org_id", org)) as { data: BuildRow[] | null };
  return new Map((data ?? []).map((row) => [row.id, row]));
}

const buildView = (row?: BuildRow) => ({ build: row?.build ?? null, updateNote: row?.update_note ?? null });

export async function listWorkers(client: SupabaseClient = accountClient(), now = Date.now()): Promise<WorkersView> {
  const who = await session(client);
  if (!who) return { signedIn: false, workers: [] };
  const { data, error } = await client
    .from("cloud_workers")
    .select("id, owner_user, name, platform, arch, status, last_seen_at, kind, device")
    .eq("org_id", who.org)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Couldn't read your workers: ${error.message}`);
  const here = deviceId();
  const [clones, signIns, builds] = await Promise.all([failedClones(client, who.org, who.uid), githubSignIns(client, who.org), workerBuilds(client, who.org)]);
  const workers = ((data as Row[] | null) ?? []).map((r) => {
    const stale = !r.last_seen_at || now - Date.parse(r.last_seen_at) > OFFLINE_AFTER_MS;
    const device = r.device ?? null;
    return {
      id: r.id,
      name: r.name,
      platform: r.platform,
      arch: r.arch,
      status: stale ? "offline" : r.status,
      lastSeenAt: r.last_seen_at,
      mine: r.owner_user === who.uid,
      kind: r.kind === "desktop" ? "desktop" : "headless",
      device,
      here: device !== null && device === here && r.owner_user === who.uid,
      githubAccount: signIns.get(r.id)?.github_account ?? null,
      githubState: signIns.get(r.id)?.github_state ?? null,
      cloneError: clones.get(workerDevice(r.id)) ?? null,
      ...buildView(builds.get(r.id)),
    } satisfies WorkerView;
  });
  return { signedIn: true, workers };
}

// A one-time token, good for an hour, and the line to run on the box with it.
export async function enrolToken(client: SupabaseClient = accountClient()): Promise<{ token: string; command: string }> {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to add a worker.");
  const { data, error } = (await client.rpc("worker_enrol_token", { p_org: who.org })) as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`Couldn't make a token: ${error.message}`);
  const token = String(data);
  return { token, command: installLine(token) };
}

// The device a desktop worker's commands go to, or null for a headless worker (or one RLS doesn't show you).
async function desktopDevice(client: SupabaseClient, workerId: string): Promise<string | null> {
  const { data } = await client.from("cloud_workers").select("kind, device").eq("id", workerId).maybeSingle<{ kind: string | null; device: string | null }>();
  return data?.kind === "desktop" && data.device ? data.device : null;
}

// Queues a run on one of your workers; the worker hears it at once and its card syncs back. A desktop
// worker takes it as its own new_card command (lib/cloud-inbox.ts), which finds the synced folder by name.
export async function sendRun(body: { workerId: string; folder: string; prompt: string; repo?: string }, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to send a run.");
  const device = await desktopDevice(client, body.workerId);
  const folder = body.folder.trim();
  const row = device
    ? folder ? newCardCommand({ orgId: who.org, device, folder }, { prompt: body.prompt }) : null
    : runCommand({ orgId: who.org, workerId: body.workerId, folder: body.folder }, body);
  if (!row) throw new Error("A run needs a project folder and a prompt.");
  const { data, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't send the run: ${error.message}`);
  return { commandId: data.id };
}

// The worker a sign-in goes to, with the public key it published, for sealing on this Mac.
async function sealTarget(client: SupabaseClient, workerId: string) {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to sign a worker in.");
  const { data: worker } = await client.from("cloud_workers").select("public_key").eq("id", workerId).maybeSingle<{ public_key: string | null }>();
  if (!worker?.public_key) throw new Error("That worker hasn't published its key yet. Update it (weft-worker update), then try again.");
  return { orgId: who.org, workerId, publicKey: worker.public_key };
}

async function insertSignIn(client: SupabaseClient, row: NewCommand): Promise<{ commandId: string }> {
  const { data, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't send the sign-in: ${error.message}`);
  return { commandId: data.id };
}

// Signs a headless worker's Claude Code in: the token is sealed here, on this Mac, to the public key the worker put
// on its row (lib/worker-seal.ts), so the login command Supabase carries holds nothing anyone else can open. The
// worker saves it and restarts itself.
export async function sendLogin(body: { workerId: string; token: string }, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const row = loginCommand(await sealTarget(client, body.workerId), body.token);
  if (!row) throw new Error("That doesn't look like a Claude Code token. It starts with sk-ant-.");
  return insertSignIn(client, row);
}

// Signs a headless worker's git in to GitHub the same way: sealed here, with its own purpose, so a token sealed for
// Claude can't be opened as this one or the other way round.
export async function sendGithubLogin(body: { workerId: string; token: string }, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const row = githubLoginCommand(await sealTarget(client, body.workerId), body.token);
  if (!row) throw new Error("That doesn't look like a GitHub token. It starts with github_pat_.");
  return insertSignIn(client, row);
}

// Queues a clone of a GitHub repo onto one of your workers, with no thread.
export async function sendClone(body: { workerId: string; repo: string }, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to clone onto a worker.");
  const row = cloneCommand({ orgId: who.org, workerId: body.workerId }, body.repo);
  if (!row) throw new Error("Use owner/name, like aimhuge/weft.");
  const { data, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't send the clone: ${error.message}`);
  return { commandId: data.id };
}

// Asks one of your workers to look for a new build now. A live card still holds it, and its row says which.
export async function sendUpdate(body: { workerId: string }, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to update a worker.");
  const { data, error } = await client.from("cloud_commands").insert(updateCommand({ orgId: who.org, workerId: body.workerId })).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't ask it to update: ${error.message}`);
  return { commandId: data.id };
}

// How a command sent to a worker went, for the forms that wait on it (lib/worker-command-wait.ts).
export async function commandResult(id: string, client: SupabaseClient = accountClient()): Promise<CommandResult> {
  const { data, error } = await client.from("cloud_commands").select("status, error").eq("id", id).maybeSingle<CommandResult>();
  if (error) throw new Error(`Couldn't read that command: ${error.message}`);
  if (!data) throw new Error("That command is gone.");
  return data;
}

export async function removeWorker(id: string, client: SupabaseClient = accountClient()): Promise<void> {
  if (!(await session(client))) throw new Error("Sign in to Weft to remove a worker.");
  const { error } = await client.from("cloud_workers").delete().eq("id", id);
  if (error) throw new Error(`Couldn't remove that worker: ${error.message}`);
}
