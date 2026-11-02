// A new thread in a worker project from the desktop board (docs/architecture/project-hosts.md#transports): a
// card.create host command (lib/host-api/card-create.ts) addressed to the worker and the project's folder, under an id
// picked here so the board can name the card it asked for. POST /api/cards sends it; `start: false` puts the card in
// the worker's Backlog. Nothing is made on this Mac: the card comes back through the cloud rows (lib/worker-board.ts).
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import type { NewCommand } from "./cloud-commands";
import { hostCommand } from "./host-command";
import { ATTACHMENTS, insert, myWorkers, requireSession, withAttachments } from "./worker-board";
import { RUN_MODES, workerDevice } from "./worker-commands";
import { connectorStart, START_CONNECTOR, type StartConnectorDeps } from "./worker-folder-repo";
import { offlineMessage, parseWorkerProject } from "./worker-project";
import { liveStatus } from "./worker-presence";
import { presenceWatch, type PresenceWatch } from "./worker-presence-watch";

export interface WorkerThreadInput {
  cwd: string;
  prompt: string;
  title?: string;
  backend?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  tags?: string[];
  isolated?: boolean;
  branch?: string;
  // false leaves it in the worker's Backlog.
  start?: boolean;
  // Whether this Mac signs the start for the GitHub connector: only when Weft's own window asked (app/api/cards).
  signStart?: boolean;
}

// The fields a new worker card is made from: never its folder (the row's), agent or read scope, which remoteRefusal
// would turn away, nor a mode that skips prompts (only RUN_MODES), and only what was given.
export function createArgs(body: WorkerThreadInput): Record<string, unknown> {
  const { prompt, title, backend, model, effort, tags, isolated, branch, start } = body;
  const permissionMode = RUN_MODES.find((m) => m === body.permissionMode);
  const all: Record<string, unknown> = { prompt: prompt.trim(), title, backend, model, effort, permissionMode, tags, isolated, branch, start: start !== false };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== ""));
}

// It never starts anywhere else: an offline worker refuses here rather than queue a card that would land hours later.
export async function startWorkerThread(
  body: WorkerThreadInput,
  client: SupabaseClient = accountClient(),
  now = Date.now(),
  dir = ATTACHMENTS,
  presence: PresenceWatch = presenceWatch(),
  connector: StartConnectorDeps = START_CONNECTOR,
): Promise<{ commandId: string; worker: string; cardId: string }> {
  const project = parseWorkerProject(body.cwd);
  if (!project) throw new Error("That isn't a worker project.");
  if (!body.prompt.trim()) throw new Error("Write a prompt for this thread.");
  const who = await requireSession(client);
  const worker = (await myWorkers(client, who)).find((w) => w.id === project.workerId);
  if (!worker) throw new Error("That worker isn't one of yours anymore.");
  const seen = await presence.read((fn, args) => client.rpc(fn, args), [worker.id], { owner: who.uid });
  if (liveStatus(worker, seen, now) === "offline") throw new Error(offlineMessage(worker.name));
  const cardId = randomUUID();
  const target = { orgId: who.org, device: workerDevice(worker.id), folder: project.folder, cardId };
  const built = hostCommand(target, "card.create", createArgs(body)) as NewCommand;
  // The repo this Mac knows the folder as, and main's signature over the start, for the GitHub connector's mint
  // (lib/worker-folder-repo.ts); the worker ignores both.
  const extra = body.signStart ? await connectorStart({ workerId: worker.id, cardId, folder: project.folder }, connector) : {};
  const row: NewCommand = { ...built, payload: { ...(built.payload as object), ...extra } as NewCommand["payload"] };
  const { commandId } = await insert(client, await withAttachments(client, row, body.prompt, dir));
  return { commandId, worker: worker.name, cardId };
}
