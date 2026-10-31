// The desktop board's side of your Weft Workers (docs/architecture/weft-worker.md#worker-projects-on-the-desktop-board):
// reads their projects and cards from the cloud rows, and sends the same cloud_commands the web board sends. Nothing
// here touches the local store or a local CLI, and a worker card is never copied in. Every call is the account's own
// client, signed in as you, so RLS decides.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { signPageAssets } from "./blob-page-sign";
import { readBlob } from "./blob-read";
import { answerCommand, replyCommand, stopCommand, type GrantScope, type NewCommand } from "./cloud-commands";
import { syncOrgId } from "./cloud-sync";
import { THREAD_PAGE_SIZE } from "./cloud-sync-types";
import { pageFromRows } from "./cloud-thread-page";
import type { ThreadPage } from "./thread-page";
import type { Card, PermissionMode, QuestionReply } from "./types";
import { inputCommand, modeCommand, runCommand, type ScreenInput } from "./worker-commands";
import { EMPTY_WORKER_BOARD, offlineMessage, parseWorkerProject, workerProjectPath, type WorkerBoard, type WorkerProject, type WorkerProjectStatus } from "./worker-project";
import { OFFLINE_AFTER_MS } from "./workers-account";

// The cards a board reads per poll, newest first.
const CARD_LIMIT = 500;

interface WorkerRow {
  id: string;
  name: string;
  status: WorkerProjectStatus;
  last_seen_at: string | null;
}

interface CardRow {
  card_id: string;
  owner_device: string;
  owner_worker: string;
  folder: string;
  card: Card;
}

const sendable = (row: unknown) => row as NewCommand;

async function session(client: SupabaseClient): Promise<{ uid: string; org: string } | null> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  const org = await syncOrgId(client, uid);
  return org ? { uid, org } : null;
}

async function requireSession(client: SupabaseClient) {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to reach your worker.");
  return who;
}

// Your headless workers. A teammate's won't obey you, and a desktop worker's cards are that Mac's own.
async function myWorkers(client: SupabaseClient, who: { uid: string; org: string }): Promise<WorkerRow[]> {
  const { data, error } = await client
    .from("cloud_workers")
    .select("id, name, status, last_seen_at")
    .eq("org_id", who.org)
    .eq("owner_user", who.uid)
    .neq("kind", "desktop")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Couldn't read your workers: ${error.message}`);
  return data;
}

const statusOf = (w: WorkerRow, now: number): WorkerProjectStatus => (!w.last_seen_at || now - Date.parse(w.last_seen_at) > OFFLINE_AFTER_MS ? "offline" : w.status);

// The folders each worker reports, read apart from the list: a database without the column yet (the app ships ahead
// of its migration) only leaves out the projects with no cards.
async function reportedFolders(client: SupabaseClient, ids: string[]): Promise<Map<string, string[]>> {
  const { data } = (await client.from("cloud_workers").select("id, folders").in("id", ids)) as { data: { id: string; folders: string[] | null }[] | null };
  return new Map((data ?? []).map((row) => [row.id, row.folders ?? []]));
}

// Your workers' cards as the board draws them: each filed under its project's worker:// path. The copilot and
// deleted cards stay out, as on the web board.
export function boardFrom(workers: WorkerRow[], folders: Map<string, string[]>, rows: CardRow[], now: number): Pick<WorkerBoard, "projects" | "cards"> {
  const live = rows.filter((r) => r.card.role !== "copilot" && r.folder);
  const projects: WorkerProject[] = workers.flatMap((w) => {
    const names = new Set([...(folders.get(w.id) ?? []), ...live.filter((r) => r.owner_worker === w.id).map((r) => r.folder)]);
    return [...names].sort().map((folder) => ({ path: workerProjectPath(w.id, folder), workerId: w.id, worker: w.name, folder, status: statusOf(w, now) }));
  });
  return { projects, cards: live.map((r) => ({ ...r.card, cwd: workerProjectPath(r.owner_worker, r.folder) })) };
}

// Your workers' projects, each listed even offline, and their cards.
export async function readWorkerBoard(client: SupabaseClient = accountClient(), now = Date.now()): Promise<WorkerBoard> {
  const who = await session(client);
  if (!who) return EMPTY_WORKER_BOARD;
  const workers = await myWorkers(client, who);
  if (!workers.length) return { ...EMPTY_WORKER_BOARD, signedIn: true };
  const ids = workers.map((w) => w.id);
  const [folders, cards] = await Promise.all([
    reportedFolders(client, ids),
    client.from("cloud_cards").select("card_id, owner_device, owner_worker, folder, card").eq("org_id", who.org).eq("deleted", false).in("owner_worker", ids).order("updated_at", { ascending: false }).limit(CARD_LIMIT),
  ]);
  if (cards.error) throw new Error(`Couldn't read your worker's threads: ${cards.error.message}`);
  return { signedIn: true, ...boardFrom(workers, folders, cards.data, now) };
}

// One page of a worker card's thread, the page the web board's transport reads. Null when it can't be read.
export async function workerThreadPage(cardId: string, before: number | undefined, client: SupabaseClient = accountClient()): Promise<ThreadPage | null> {
  const who = await requireSession(client);
  let query = client.from("cloud_thread_items").select("card_id, seq, item").eq("org_id", who.org).eq("card_id", cardId);
  if (before !== undefined) query = query.lt("seq", before);
  const { data, error } = await query.order("seq", { ascending: false }).limit(THREAD_PAGE_SIZE);
  return error ? null : pageFromRows(cardId, data);
}

// The full result of a tool call whose result was cut out of its item.
export async function workerToolOutput(cardId: string, toolId: string, client: SupabaseClient = accountClient()): Promise<string> {
  const who = await requireSession(client);
  const { data, error } = await client.from("cloud_tool_outputs").select("result").eq("org_id", who.org).eq("card_id", cardId).eq("tool_id", toolId).maybeSingle<{ result: string }>();
  if (error || !data) throw new Error("That output isn't there.");
  return data.result;
}

// A page a worker card opened, for the desktop board's pane: the bytes through the account's own session, an HTML page's
// assets signed the same way (lib/blob-page-sign.ts). Null when it isn't there or isn't yours to read.
export async function workerPage(sha: string, client: SupabaseClient = accountClient()): Promise<{ body: BodyInit; type: string } | null> {
  const who = await requireSession(client);
  const got = await readBlob(client, who.org, sha, { r2: null });
  if (!got) return null;
  const type = got.type || "application/octet-stream";
  return { type, body: type.startsWith("text/html") ? await signPageAssets(client, who.org, new TextDecoder().decode(got.bytes)) : got.bytes };
}

// Where a command for a card goes: the worker that runs it, read fresh, and only a card a worker of yours owns.
async function commandTarget(client: SupabaseClient, cardId: string) {
  const who = await requireSession(client);
  const { data } = await client.from("cloud_cards").select("owner_device, owner_worker, folder, owner_user").eq("org_id", who.org).eq("card_id", cardId).maybeSingle<{ owner_device: string; owner_worker: string | null; folder: string; owner_user: string }>();
  if (!data?.owner_worker || data.owner_user !== who.uid) throw new Error("That thread isn't on one of your workers.");
  return { orgId: who.org, device: data.owner_device, folder: data.folder, cardId };
}

async function insert(client: SupabaseClient, row: NewCommand): Promise<{ commandId: string }> {
  const { data, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't reach your worker: ${error.message}`);
  return { commandId: data.id };
}

export type WorkerAction =
  | { action: "reply"; cardId: string; text: string }
  | { action: "answer"; cardId: string; pendingId: string; allow: boolean; answers?: Record<string, string>; reply?: QuestionReply; grant?: GrantScope }
  | { action: "stop"; cardId: string }
  | { action: "mode"; cardId: string; mode: PermissionMode }
  | { action: "input"; cardId: string; input: ScreenInput };

// A reply, an answer or a Stop from the desktop: the same rows the web board sends. A command for an offline worker
// waits in the queue until it's back, and the thread says so.
export async function sendWorkerAction(body: WorkerAction, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const target = await commandTarget(client, body.cardId);
  if (body.action === "stop") return insert(client, stopCommand(target));
  if (body.action === "mode" || body.action === "input") {
    const row = body.action === "mode" ? modeCommand(target, body.mode) : inputCommand(target, body.input);
    if (!row) throw new Error(body.action === "mode" ? "A worker doesn't run in that mode." : "That tap can't be sent.");
    return insert(client, row);
  }
  const row = body.action === "reply" ? replyCommand(target, body.text) : answerCommand(target, body);
  if (!row) throw new Error(body.action === "reply" ? "Write a message first." : "Nothing is waiting for an answer.");
  return insert(client, row);
}

export interface WorkerThreadInput {
  cwd: string;
  prompt: string;
  title?: string;
  backend?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
}

// A new thread in a worker project: a run with that folder, or an error that says why not. It never starts anywhere
// else: an offline worker refuses here rather than queue a run that would land hours later.
export async function startWorkerThread(body: WorkerThreadInput, client: SupabaseClient = accountClient(), now = Date.now()): Promise<{ commandId: string; worker: string }> {
  const project = parseWorkerProject(body.cwd);
  if (!project) throw new Error("That isn't a worker project.");
  const who = await requireSession(client);
  const worker = (await myWorkers(client, who)).find((w) => w.id === project.workerId);
  if (!worker) throw new Error("That worker isn't one of yours anymore.");
  if (statusOf(worker, now) === "offline") throw new Error(offlineMessage(worker.name));
  const row = runCommand({ orgId: who.org, workerId: worker.id, folder: project.folder }, body);
  if (!row) throw new Error("Write a prompt for this thread.");
  // runBody reads these as well; runCommand has no use for them on a Send a run from Settings.
  const payload = { ...row.payload, ...(body.title ? { title: body.title } : {}), ...(body.backend ? { backend: body.backend } : {}), ...(body.effort ? { effort: body.effort } : {}) };
  const { commandId } = await insert(client, sendable({ ...row, payload }));
  return { commandId, worker: worker.name };
}
