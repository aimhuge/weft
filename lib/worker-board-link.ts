// The user's board as a thread on a Weft Worker reaches it (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// A worker's own store (WEFT_DATA) holds only its own cards, so its board tools read and write the cloud instead:
// the owner's synced cards, a card for another host as a command, and the worker's crons and webhooks published for
// the Mac's drawers. scripts/weft-worker.ts binds the link to the worker's key; off a worker there is none.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatProjectAddress, isWorkerPath, localAddress, parseProjectAddress, workerAddress } from "./host/address";
import { isSealed, SEALED_CARD_FIELDS, SEALED_TITLE } from "./sync-seal";
import type { Card } from "./types";
import type { BoardRow, MacCronsRow } from "./worker-registry";

export interface BoardLink {
  workerId: string;
  // The work root: the worker's projects are the folders under it.
  root: string;
  cards(limit: number): Promise<BoardRow[]>;
  newCard(target: string, folder: string, payload: Record<string, unknown>): Promise<string>;
  setLists(crons: unknown[], webhooks: unknown[]): Promise<unknown>;
  // The owner's Macs' crons, for list_crons to show read-only; absent on a wiring that predates it.
  macCrons?(): Promise<MacCronsRow[]>;
}

let link: BoardLink | null = null;

export function setBoardLink(next: BoardLink | null) {
  link = next;
}

export function boardLink(): BoardLink {
  if (!link) throw new Error("This worker can't reach your board yet. Update it with weft-worker update.");
  return link;
}

export const BOARD_READ = 500;

const rowPath = (r: BoardRow) => formatProjectAddress(r.owner_worker ? workerAddress(r.owner_worker, r.folder) : localAddress(r.folder));

// The worker a worker:// path names and its folder; null for a local path, and an error for a broken one.
function workerOf(text: string): { id: string; repo: string } | null {
  if (!isWorkerPath(text)) return null;
  const address = parseProjectAddress(text);
  if (address?.host.kind !== "worker") throw new Error(`${text} isn't a project: write worker://<worker id>/<folder>.`);
  return { id: address.host.id, repo: address.repo };
}

// A synced row as a card the list can draw: its folder as the board names it (a Mac's path, or worker://<id>/<name>),
// and a sealed field as the lock, since a worker holds no workspace key.
export function rowCard(row: BoardRow): Card {
  const card = { ...(row.card as Card) };
  const fields = card as unknown as Record<string, unknown>;
  for (const field of SEALED_CARD_FIELDS) {
    if (isSealed(fields[field])) fields[field] = field === "title" ? `${SEALED_TITLE} sealed` : undefined;
  }
  card.id = row.card_id;
  card.cwd = rowPath(row);
  return card;
}

// The user's board from this worker: its own cards (fresher in its store than in the cloud) and every other synced card.
export async function boardCards(own: Card[]): Promise<Card[]> {
  const l = boardLink();
  const ids = new Set(own.map((c) => c.id));
  const rows = await l.cards(BOARD_READ);
  return [...own, ...rows.filter((r) => r.owner_worker !== l.workerId && !ids.has(r.card_id)).map(rowCard)];
}

const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());
const inside = (dir: string, root: string) => dir === root || dir.startsWith(`${root}${path.sep}`);
const isDir = (dir: string) => fs.existsSync(dir) && fs.statSync(dir).isDirectory();

// The folder on this worker a create_card or create_cron names, or null when it names another host's project: empty
// (the thread's own), worker://<this worker>/<name>, a path under the work root, or a project name there.
export function localFolder(folder: string, l: Pick<BoardLink, "workerId" | "root">, own: string): string | null {
  const text = folder.trim();
  if (!text) return own;
  const named = workerOf(text);
  if (named) return named.id === l.workerId ? path.join(l.root, named.repo) : null;
  const root = path.resolve(l.root);
  if (path.isAbsolute(expand(text))) {
    const dir = path.resolve(expand(text));
    return inside(dir, root) && isDir(dir) ? dir : null;
  }
  const child = path.join(root, text);
  return !text.includes("/") && isDir(child) ? child : null;
}

export interface RemoteTarget {
  target: string;
  folder: string;
  where: string;
}

const describeTarget = (t: RemoteTarget) => `${t.where} (${t.folder})`;

// Where a project on another host is: worker://<id>/<name> as given, else the synced cards' folders that match it by
// path or by name. One match or an error naming the choices.
export function remoteTarget(folder: string, rows: BoardRow[], self: string): RemoteTarget {
  const text = folder.trim();
  const named = workerOf(text);
  if (named) return { target: `worker:${named.id}`, folder: named.repo, where: "worker" };
  const found = new Map<string, RemoteTarget>();
  for (const r of rows) {
    if (r.owner_worker === self) continue;
    const hit = r.folder === text || path.basename(r.folder) === text;
    if (!hit) continue;
    const t = r.owner_worker ? { target: `worker:${r.owner_worker}`, folder: r.folder, where: "worker" } : { target: r.owner_device, folder: r.folder, where: "Mac" };
    found.set(`${t.target}\n${t.folder}`, t);
  }
  const hits = [...found.values()];
  if (hits.length === 1) return hits[0] as RemoteTarget;
  if (hits.length > 1) throw new Error(`“${text}” is more than one project on your board: ${hits.map(describeTarget).join(", ")}. Pass the full path, or worker://<id>/<name>.`);
  const known = [...new Set(rows.filter((r) => r.owner_worker !== self).map(rowPath))];
  throw new Error(`No project “${text}” on this worker or on your board.${known.length ? ` Projects with cards: ${known.slice(0, 12).join(", ")}.` : ""} A project on this worker is a folder under ${boardLink().root}.`);
}
