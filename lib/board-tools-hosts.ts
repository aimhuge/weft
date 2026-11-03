// The board tools on this Mac over every host (docs/architecture/project-hosts.md#board-tools-on-this-mac): a thread or
// the copilot sees and runs the user's Weft Worker cards beside this Mac's, through lib/worker-board-reach.ts, never
// this Mac's store. lib/board-tools.ts and lib/board-tools-copilot.ts wire these into the MCP tools.
//
//   list_cards     this Mac's cards + the workers' (their cloud rows), a note when those can't be read
//   read_thread    a worker card's thread from its synced rows, a page at a time
//   create_card    a worker:// folder (or a project name only a worker has) starts the thread there, in default mode
//   card verbs     a worker card's message, stop, answer, move and tags go to its worker as host verbs
//
// Nothing here widens a worker card: a new one asks before edits and commands whatever mode the thread is in, it runs as
// that project's default agent (any other needs the signed approval only Weft's own window can make, lib/host-agent.ts),
// and a move or tags change carries no mode, folder or agent.
import { describeCard, listText, readThreadText, threadText, type ListOptions } from "./board-tools-format";
import { resolveFolder } from "./folders";
import { agentElsewhereRefusal, defaultAgentNote } from "./host-agent";
import { getCard, listCards } from "./store";
import type { Backend, Card, ThreadItem } from "./types";
import type { WorkerReach } from "./worker-board-reach";
import { parseWorkerProject, type WorkerProject } from "./worker-project";
import type { CardVerb } from "@weft/client";

// How long list_cards waits on the workers' board before it answers with this Mac's cards and says why.
export const WORKER_READ_MS = 8_000;
// The most of a worker card's thread read_thread walks back for.
export const WORKER_THREAD_MAX = 300;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("they didn't answer in time")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function workersBoard(reach: WorkerReach) {
  try {
    return { ...(await within(reach.board(), WORKER_READ_MS)), note: "" };
  } catch (err) {
    return { cards: [] as Card[], projects: [] as WorkerProject[], note: `Your Weft Workers' cards couldn't be read (${message(err)}); these are this Mac's.` };
  }
}

// list_cards on this Mac: its own cards and every card on the user's workers, filed under their worker:// folders.
export async function hostListText(opts: ListOptions, reach: WorkerReach): Promise<string> {
  const { cards, note } = await workersBoard(reach);
  const text = listText([...listCards(), ...cards], opts);
  return note ? `${text}\n${note}` : text;
}

export interface HostCard {
  card: Card;
  // On one of the user's workers: its verbs go there, and its thread is read from its synced rows.
  worker: boolean;
}

const noCard = (id: string) => new Error(`No card ${id}. Use list_cards to get card ids.`);

// A card by id on any host: this Mac's store first (no network), then the workers' board.
export async function findHostCard(id: string, reach: WorkerReach): Promise<HostCard> {
  const local = getCard(id);
  if (local) {
    if (local.role === "copilot") throw noCard(id);
    return { card: local, worker: false };
  }
  const found = (await workersBoard(reach)).cards.find((c) => c.id === id);
  if (!found) throw noCard(id);
  return { card: found, worker: true };
}

// The newest `last` items of a worker card's thread, walked back a page at a time.
async function workerItems(cardId: string, last: number, reach: WorkerReach): Promise<ThreadItem[]> {
  let items: ThreadItem[] = [];
  let before: number | undefined;
  while (items.length < last) {
    const page = await reach.page(cardId, before);
    if (!page) {
      if (items.length) break;
      throw new Error("That worker card's thread can't be read right now.");
    }
    items = [...page.items, ...items];
    if (page.start <= 0 || !page.items.length) break;
    before = page.start;
  }
  return items.slice(-last);
}

// read_thread on this Mac: a local card from the store, a worker's from the rows its worker publishes.
export async function hostThreadText(id: string, last: number | undefined, reach: WorkerReach): Promise<string> {
  const { card, worker } = await findHostCard(id, reach);
  if (!worker) return readThreadText(card.id, last);
  const items = await workerItems(card.id, Math.min(last ?? 30, WORKER_THREAD_MAX), reach);
  return `${describeCard(card)}\n\n---\n\n${threadText(items) || "(empty thread)"}`;
}

// One verb on a worker's card, and what the reply adds when the worker hasn't taken it yet.
export async function actOnHostCard(card: Card, verb: CardVerb, args: Record<string, unknown>, reach: WorkerReach): Promise<string> {
  const { queued } = await reach.act(card.id, verb, args);
  return queued ? " Its worker hasn't taken it yet: it happens once that worker is back." : "";
}

function isLocalFolder(folder: string): boolean {
  try {
    resolveFolder(folder);
    return true;
  } catch {
    return false;
  }
}

// The worker project a create_card folder names: a worker:// path, or a bare name no folder here has that exactly one
// of the user's worker projects goes by. Null when it's this Mac's.
export async function workerFolder(folder: string, reach: WorkerReach): Promise<string | null> {
  const name = folder.trim();
  if (parseWorkerProject(name)) return name;
  if (!name || /[/~\\]/.test(name) || isLocalFolder(name)) return null;
  const matches = (await workersBoard(reach)).projects.filter((p) => p.folder === name);
  if (matches.length > 1) throw new Error(`More than one worker has a project named ${name}: ${matches.map((p) => p.path).join(", ")}. Pass one of those.`);
  return matches[0]?.path ?? null;
}

export interface WorkerCardInput {
  folder: string;
  prompt: string;
  title?: string;
  tags?: string[];
  cli?: Backend;
  start?: boolean;
  agent?: string;
}

// create_card into a worker project: card.create on that worker, in default mode whatever the asking thread runs in, so
// a board tool never hands a worker card more than asking before edits and commands. It carries no agent: the worker
// starts it as the project's default from your signed settings, so a named agent passes only when it is that one.
export async function createWorkerCard(input: WorkerCardInput, reach: WorkerReach): Promise<string> {
  const refused = agentElsewhereRefusal(input.agent, input.folder);
  if (refused) throw new Error(refused);
  const { cardId, worker } = await reach.start({
    cwd: input.folder,
    prompt: input.prompt,
    title: input.title,
    tags: input.tags,
    backend: input.cli,
    permissionMode: "default",
    start: input.start !== false,
  });
  const where = `on ${worker} (${input.folder}), in default mode: it asks before edits and commands`;
  const made = input.start === false ? `Created ${cardId} in Backlog ${where}.` : `Created and started ${cardId} ${where}.`;
  return made + defaultAgentNote(input.folder);
}
