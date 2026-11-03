// The desktop board's side of your Weft Workers (docs/architecture/weft-worker.md#worker-projects-on-the-desktop-board):
// reads their projects and cards from the cloud rows, and sends the same cloud_commands the web board sends. Nothing
// here touches the local store or a local CLI, and a worker card is never copied in. Every call is the account's own
// client, signed in as you, so RLS decides.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { encodeAttachments } from "./attachment-transfer";
import { signPageAssets } from "./blob-page-sign";
import { readBlob } from "./blob-read";
import { createBlobStore } from "./blob-store";
import { switchQa } from "./qa-switch";
import { answerCommand, replyCommand, stopCommand, type GrantScope, type NewCommand } from "./cloud-commands";
import { syncOrgId } from "./cloud-sync";
import { BLOB_REF_PREFIX, THREAD_PAGE_SIZE } from "./cloud-sync-types";
import { pageFromRows } from "./cloud-thread-page";
import { hostCommand, textArgOf } from "./host-command";
import { DATA_DIR } from "./store";
import type { ThreadPage } from "./thread-page";
import type { Card, PermissionMode, QuestionReply } from "./types";
import { inputCommand, modeCommand, workerDevice, type BoardInput, type BoardOffer, type ScreenInput } from "./worker-commands";
import { seal } from "./worker-seal";
import { RTC_PURPOSE } from "./rtc-signal";
import { LINE_PURPOSE, type LineOffer } from "./host-line-protocol";
import { EMPTY_WORKER_BOARD, workerProjectPath, type WorkerBoard, type WorkerProject, type WorkerProjectStatus } from "./worker-project";
import { liveStatus, type PresenceRead } from "./worker-presence";
import { presenceWatch, type PresenceWatch } from "./worker-presence-watch";
import { macHint } from "./host-facts";
import { linePlaintext, withClientHint } from "@weft/client";

// Where this Mac's composer saves what you paste (lib/attachments.ts ATTACHMENTS_DIR, without its image tools).
export const ATTACHMENTS = path.join(DATA_DIR, "attachments");

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
  updated_at?: string;
  deleted?: boolean;
}

const sendable = (row: unknown) => row as NewCommand;

async function session(client: SupabaseClient): Promise<{ uid: string; org: string } | null> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  const org = await syncOrgId(client, uid);
  return org ? { uid, org } : null;
}

export async function requireSession(client: SupabaseClient) {
  const who = await session(client);
  if (!who) throw new Error("Sign in to Weft to reach your worker.");
  return who;
}

// Your headless workers. A teammate's won't obey you, and a desktop worker's cards are that Mac's own.
export async function myWorkers(client: SupabaseClient, who: { uid: string; org: string }): Promise<WorkerRow[]> {
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

// The folders each worker reports, read apart from the list: a database without the column yet (the app ships ahead
// of its migration) only leaves out the projects with no cards.
async function reportedFolders(client: SupabaseClient, ids: string[]): Promise<Map<string, string[]>> {
  const { data } = (await client.from("cloud_workers").select("id, folders").in("id", ids)) as { data: { id: string; folders: string[] | null }[] | null };
  return new Map((data ?? []).map((row) => [row.id, row.folders ?? []]));
}

// Your workers' cards as the board draws them: each filed under its project's worker:// path. The copilot and
// deleted cards stay out, as on the web board.
// A worker's status comes from presence where the board has it (lib/worker-presence.ts liveStatus).
export function boardFrom(workers: WorkerRow[], folders: Map<string, string[]>, rows: CardRow[], now: number, seen: PresenceRead | null = null): Pick<WorkerBoard, "projects" | "cards"> {
  const live = rows.filter((r) => r.card.role !== "copilot" && r.folder);
  const projects: WorkerProject[] = workers.flatMap((w) => {
    const names = new Set([...(folders.get(w.id) ?? []), ...live.filter((r) => r.owner_worker === w.id).map((r) => r.folder)]);
    return [...names].sort().map((folder) => ({ path: workerProjectPath(w.id, folder), workerId: w.id, worker: w.name, folder, status: liveStatus(w, seen, now) }));
  });
  return { projects, cards: live.map((r) => ({ ...r.card, cwd: workerProjectPath(r.owner_worker, r.folder) })) };
}

// A changed-cards read starts this far before its `since`, so a row committed a moment late isn't missed.
export const SINCE_OVERLAP_MS = 2_000;

// Your workers' projects, each listed even offline, and their cards. With `since` (the last read's `asOf`) only the cards
// changed after it come back, marked `delta`; the board merges them, drops the `removed` ones, and reads whole every few minutes as a safety net.
export async function readWorkerBoard(client: SupabaseClient = accountClient(), now = Date.now(), presence: PresenceWatch = presenceWatch(), since?: string): Promise<WorkerBoard> {
  const who = await session(client);
  if (!who) return EMPTY_WORKER_BOARD;
  const workers = await myWorkers(client, who);
  if (!workers.length) return { ...EMPTY_WORKER_BOARD, signedIn: true };
  const ids = workers.map((w) => w.id);
  const from = since && Number.isFinite(Date.parse(since)) ? new Date(Date.parse(since) - SINCE_OVERLAP_MS).toISOString() : null;
  const [seen, folders, cards] = await Promise.all([
    presence.read((fn, args) => client.rpc(fn, args), ids, { owner: who.uid, all: true }),
    reportedFolders(client, ids),
    changedCards(client, who.org, ids, from),
  ]);
  if (cards.error) throw new Error(`Couldn't read your worker's threads: ${cards.error.message}`);
  const rows = cards.data as CardRow[];
  const { asOf, delta, removed } = readMarks(rows, from, since);
  const board = boardFrom(workers, folders, rows.filter((r) => !r.deleted), now, seen);
  return { signedIn: true, ...board, ...(asOf ? { asOf } : {}), ...(delta ? { delta: true, removed } : {}) };
}

// The newest CARD_LIMIT card rows. A changed-cards read (`from`) also takes the deleted rows, to tell the board which are gone.
function changedCards(client: SupabaseClient, org: string, ids: string[], from: string | null) {
  const query = client.from("cloud_cards").select("card_id, owner_device, owner_worker, folder, card, updated_at, deleted").eq("org_id", org).in("owner_worker", ids);
  return (from ? query.gt("updated_at", from) : query.eq("deleted", false)).order("updated_at", { ascending: false }).limit(CARD_LIMIT);
}

// What a read tells the next one: its newest stamp, whether it is a changed-cards read, and the cards that are gone.
function readMarks(rows: CardRow[], from: string | null, since: string | undefined) {
  const stamps = rows.flatMap((r) => (r.updated_at ? [Date.parse(r.updated_at)] : [])).filter(Number.isFinite);
  const asOf = stamps.length ? new Date(Math.max(...stamps)).toISOString() : from ? since : undefined;
  // A changed read that fills the limit is the newest CARD_LIMIT cards, which is what a whole read holds: it is sent as one.
  const delta = from !== null && rows.length < CARD_LIMIT;
  const removed = delta ? rows.filter((r) => r.deleted || r.card.role === "copilot" || !r.folder).map((r) => r.card_id) : [];
  return { asOf, delta, removed };
}

// One page of a worker card's thread, the page the web board's transport reads. Null when it can't be read.
// With `after`, only the items with a seq past it (the poll's delta, lib/worker-poll.ts); when none is, an empty page that
// still carries the thread's total, so a rewound thread shows.
export async function workerThreadPage(cardId: string, before: number | undefined, client: SupabaseClient = accountClient(), after?: number): Promise<ThreadPage | null> {
  const who = await requireSession(client);
  let query = client.from("cloud_thread_items").select("card_id, seq, item").eq("org_id", who.org).eq("card_id", cardId);
  if (before !== undefined) query = query.lt("seq", before);
  if (after !== undefined) query = query.gt("seq", after);
  const { data, error } = await query.order("seq", { ascending: false }).limit(THREAD_PAGE_SIZE);
  if (error) return null;
  if (after === undefined || data.length) return pageFromRows(cardId, data);
  const head = await client.from("cloud_thread_items").select("seq").eq("org_id", who.org).eq("card_id", cardId).order("seq", { ascending: false }).limit(1);
  if (head.error) return null;
  return { items: [], start: after + 1, total: head.data.length ? (head.data[0] as { seq: number }).seq + 1 : 0 };
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
  return { orgId: who.org, device: data.owner_device, folder: data.folder, cardId, workerId: data.owner_worker };
}

// The files a message pastes, uploaded to the workspace's blobs as you, for the worker to bring over
// (lib/attachment-transfer.ts). The row gains them only when there are any, so a text reply's row is as it was.
export async function withAttachments(client: SupabaseClient, row: NewCommand, text: string, dir: string): Promise<NewCommand> {
  const blobs = createBlobStore({ client });
  const upload = async (file: string) => (await blobs.upload(file, row.org_id))?.slice(BLOB_REF_PREFIX.length) ?? null;
  const attachments = await encodeAttachments(text, dir, upload);
  return attachments.length ? sendable({ ...row, payload: { ...row.payload, attachments } }) : row;
}

// Every row this Mac sends a worker says it's from this Mac's desktop board: a hint for the thread's <weft-env> block
// (lib/turn-client.ts), never a check.
export async function insert(client: SupabaseClient, row: NewCommand): Promise<{ commandId: string }> {
  const { data, error } = await client.from("cloud_commands").insert(withClientHint(row, macHint())).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't reach your worker: ${error.message}`);
  return { commandId: data.id };
}

export type WorkerAction =
  | { action: "reply"; cardId: string; text: string }
  | { action: "answer"; cardId: string; pendingId: string; allow: boolean; answers?: Record<string, string>; reply?: QuestionReply; grant?: GrantScope }
  | { action: "stop"; cardId: string }
  | { action: "mode"; cardId: string; mode: PermissionMode }
  | { action: "input"; cardId: string; input: BoardInput }
  | { action: "qa"; cardId: string; device: string | null }
  // Any verb in lib/host-api (lib/host-command.ts), for the board to reach every verb a worker runs.
  | { action: "host"; cardId: string; verb: string; args?: Record<string, unknown> };

// A session line's offer (lib/session-line.ts): for a worker, not a card, so it goes through openWorkerLine.
export type LineAction = { action: "line"; workerId: string; offer: LineOffer };

// A WebRTC offer goes out sealed to the worker's published key: only that worker can answer it, and the answer comes
// back under the board's one-time key, so the board knows who it reached (weft-worker.md#the-fast-path).
async function sealedOffer(client: SupabaseClient, workerId: string, offer: BoardOffer): Promise<ScreenInput> {
  const { data } = await client.from("cloud_workers").select("public_key").eq("id", workerId).maybeSingle<{ public_key: string | null }>();
  if (!data?.public_key) throw new Error("That worker hasn't published its key yet.");
  return { kind: "offer", device: offer.device, sealed: seal(data.public_key, JSON.stringify({ sdp: offer.sdp, key: offer.key, quality: offer.quality }), RTC_PURPOSE) };
}

// Opens a session line: the board's offer, its answer key, topic and ICE servers, sealed to the worker's published key
// (LINE_PURPOSE) on a `line` command, so only that worker can answer and both DTLS fingerprints travel protected.
export async function openWorkerLine(body: LineAction, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const who = await requireSession(client);
  if (!(await myWorkers(client, who)).some((w) => w.id === body.workerId)) throw new Error("That worker isn't one of yours.");
  const { data } = await client.from("cloud_workers").select("public_key").eq("id", body.workerId).maybeSingle<{ public_key: string | null }>();
  if (!data?.public_key) throw new Error("That worker hasn't published its key yet.");
  // The same plaintext weft.zip and the phone seal themselves (@weft/client lineOpener), so the worker reads one shape.
  const sealed = seal(data.public_key, linePlaintext(body.offer), LINE_PURPOSE);
  return insert(client, { org_id: who.org, kind: "line", target_device: workerDevice(body.workerId), folder: "", payload: { sealed } });
}

const inputFor = (client: SupabaseClient, workerId: string, input: BoardInput) => ("sdp" in input ? sealedOffer(client, workerId, input) : input);

// Switching a card's simulator between this Mac and the worker, named after the worker it reaches.
async function qaCommand(client: SupabaseClient, target: Awaited<ReturnType<typeof commandTarget>>, cardId: string, device: Parameters<typeof switchQa>[1]) {
  const { data } = await client.from("cloud_workers").select("name").eq("id", target.workerId).maybeSingle<{ name: string }>();
  return switchQa(cardId, device, { ...target, workerName: data?.name ?? "your worker" });
}

// A host verb's row, with the files its typed text pastes, as a reply's (lib/attachment-transfer.ts).
async function hostRow(client: SupabaseClient, target: Awaited<ReturnType<typeof commandTarget>>, body: Extract<WorkerAction, { action: "host" }>, dir: string) {
  const row = hostCommand(target, body.verb, body.args);
  if (!row) throw new Error(`A worker doesn't run ${body.verb}.`);
  const { verb, args } = row.payload;
  const field = textArgOf(verb);
  const typed = field ? args[field] : undefined;
  return typeof typed === "string" ? withAttachments(client, row, typed, dir) : row;
}

// A reply, an answer or a Stop from the desktop: the same rows the web board sends. A command for an offline worker
// waits in the queue until it's back, and the thread says so.
export async function sendWorkerAction(body: WorkerAction, client: SupabaseClient = accountClient(), dir = ATTACHMENTS): Promise<{ commandId: string }> {
  const target = await commandTarget(client, body.cardId);
  if (body.action === "qa") return insert(client, await qaCommand(client, target, body.cardId, body.device));
  if (body.action === "host") return insert(client, await hostRow(client, target, body, dir));
  if (body.action === "stop") return insert(client, stopCommand(target));
  if (body.action === "mode" || body.action === "input") {
    const row = body.action === "mode" ? modeCommand(target, body.mode) : inputCommand(target, await inputFor(client, target.workerId, body.input));
    if (!row) throw new Error(body.action === "mode" ? "A worker doesn't run in that mode." : "That tap can't be sent.");
    return insert(client, row);
  }
  const row = body.action === "reply" ? replyCommand(target, body.text) : answerCommand(target, body);
  if (!row) throw new Error(body.action === "reply" ? "Write a message first." : "Nothing is waiting for an answer.");
  return insert(client, body.action === "reply" ? await withAttachments(client, row, body.text, dir) : row);
}
