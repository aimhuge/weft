// The user's board as a thread on a Weft Worker reaches it (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// A worker's own store (WEFT_DATA) holds only its own cards, so its board tools read and write the cloud instead:
// the owner's synced cards, a card for another host as a command, and the worker's crons and webhooks published for
// the Mac's drawers. scripts/weft-worker.ts binds the link to the worker's key; off a worker there is none.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatProjectAddress, isWorkerPath, localAddress, parseProjectAddress, workerAddress } from "./host/address";
import { expandOnMac, findMac, isMacPath, isTilde, macLabels, macPath, parseMacPath, sameMac, type MacProjectsRow, type MacRow } from "./worker-board-macs";
import { isSealed, SEALED_CARD_FIELDS, SEALED_TITLE } from "./sync-seal";
import type { Card } from "./types";
import type { BoardRow, MacCronsRow, WorkerShareArgs, WorkerShareRow } from "./worker-registry";

export interface BoardLink {
  workerId: string;
  // The work root: the worker's projects are the folders under it.
  root: string;
  cards(limit: number): Promise<BoardRow[]>;
  newCard(target: string, folder: string, payload: Record<string, unknown>): Promise<string>;
  setLists(crons: unknown[], webhooks: unknown[]): Promise<unknown>;
  // The owner's Macs' crons, for list_crons to show read-only; absent on a wiring that predates it.
  macCrons?(): Promise<MacCronsRow[]>;
  // The owner's Macs and their names, for mac:// paths (lib/worker-board-macs.ts); absent on an older wiring.
  macs?(): Promise<MacRow[]>;
  // Each Mac's synced projects and home (lib/mac-projects.ts), so a project with no cards yet is found; absent on an older wiring.
  macProjects?(): Promise<MacProjectsRow[]>;
  // share_card on this worker's own card (lib/share-tool.ts); absent on an older wiring.
  shareCard?(share: WorkerShareArgs): Promise<WorkerShareRow>;
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

type Labels = Map<string, string>;

// A row's folder as a thread passes it back: worker://<id>/<name>, or mac://<Mac>/<path> once the Mac's label is known.
function rowPath(r: BoardRow, labels: Labels): string {
  if (r.owner_worker) return formatProjectAddress(workerAddress(r.owner_worker, r.folder));
  const label = labels.get(r.owner_device);
  return label ? macPath(label, r.folder) : formatProjectAddress(localAddress(r.folder));
}

const macDevices = (rows: BoardRow[]) => rows.filter((r) => !r.owner_worker).map((r) => r.owner_device);

// The owner's Macs, or none when this worker's wiring or the database predates worker_board_macs: the Macs with cards
// then go by the start of their ids.
export async function boardMacs(l: Pick<BoardLink, "macs"> = boardLink()): Promise<MacRow[]> {
  if (!l.macs) return [];
  try {
    return await l.macs();
  } catch {
    return [];
  }
}

// The Macs' published projects, or none when this worker's wiring or the database predates worker_mac_projects: a Mac
// project is then found by its cards alone, as before.
export async function boardMacProjects(l: Pick<BoardLink, "macProjects"> = boardLink()): Promise<MacProjectsRow[]> {
  if (!l.macProjects) return [];
  try {
    return await l.macProjects();
  } catch {
    return [];
  }
}

// A Mac's published projects as rows with no card, so a project with no cards yet matches like one with cards, by
// path, name or ~ path.
export function projectRows(projects: MacProjectsRow[]): BoardRow[] {
  const row = (device: string, folder: string): BoardRow => ({ card_id: "", folder, owner_device: device, owner_worker: null, card: null, updated_at: "" });
  return projects.flatMap((p) => p.folders.map((f) => row(p.device, f)));
}

// The label each Mac on the board goes by in mac:// paths.
export const rowLabels = (rows: BoardRow[], macs: MacRow[]): Labels => macLabels(macs, macDevices(rows));

// The worker a worker:// path names and its folder; null for a local path, and an error for a broken one.
function workerOf(text: string): { id: string; repo: string } | null {
  if (!isWorkerPath(text)) return null;
  const address = parseProjectAddress(text);
  if (address?.host.kind !== "worker") throw new Error(`${text} isn't a project: write worker://<worker id>/<folder>.`);
  return { id: address.host.id, repo: address.repo };
}

// A synced row as a card the list can draw: its folder as create_card takes it (mac://<Mac>/<path>, or
// worker://<id>/<name>), and a sealed field as the lock, since a worker holds no workspace key.
export function rowCard(row: BoardRow, labels: Labels = new Map()): Card {
  const card = { ...(row.card as Card) };
  const fields = card as unknown as Record<string, unknown>;
  for (const field of SEALED_CARD_FIELDS) {
    if (isSealed(fields[field])) fields[field] = field === "title" ? `${SEALED_TITLE} sealed` : undefined;
  }
  card.id = row.card_id;
  card.cwd = rowPath(row, labels);
  return card;
}

// The user's board from this worker: its own cards (fresher in its store than in the cloud) and every other synced card.
export async function boardCards(own: Card[]): Promise<Card[]> {
  const l = boardLink();
  const ids = new Set(own.map((c) => c.id));
  const [rows, macs] = await Promise.all([l.cards(BOARD_READ), boardMacs(l)]);
  const labels = rowLabels(rows, macs);
  return [...own, ...rows.filter((r) => r.owner_worker !== l.workerId && !ids.has(r.card_id)).map((r) => rowCard(r, labels))];
}

const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());
const inside = (dir: string, root: string) => dir === root || dir.startsWith(`${root}${path.sep}`);
const isDir = (dir: string) => fs.existsSync(dir) && fs.statSync(dir).isDirectory();

// The folder on this worker a create_card or create_cron names, or null when it names another host's project: empty
// (the thread's own), worker://<this worker>/<name>, a path under the work root, or a project name there.
export function localFolder(folder: string, l: Pick<BoardLink, "workerId" | "root">, own: string): string | null {
  const text = folder.trim();
  if (!text) return own;
  if (isMacPath(text)) return null;
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
  where: "Mac" | "worker";
  // The exact string that names it: mac://<Mac>/<path> or worker://<id>/<name>.
  address: string;
}

const workerTarget = (id: string, folder: string): RemoteTarget => ({
  target: `worker:${id}`,
  folder,
  where: "worker",
  address: formatProjectAddress(workerAddress(id, folder)),
});

const macTarget = (device: string, folder: string, labels: Labels): RemoteTarget => ({
  target: device,
  folder,
  where: "Mac",
  address: macPath(labels.get(device) as string, folder),
});

// The Mac a mac:// path names, and its folder: a project name becomes the one folder of that Mac's cards with that
// name (two is an error listing both), else goes as written for the Mac to resolve among its synced folders (so a
// project with no cards yet works too). A ~ path is under the home that Mac's cards' folders show.
function macNamed(text: string, rows: BoardRow[], labels: Labels, macs: MacRow[], homes: Map<string, string>): RemoteTarget {
  const { mac, folder } = parseMacPath(text);
  const device = findMac(mac, labels, macs);
  const own = rows.filter((r) => !r.owner_worker && r.owner_device === device);
  if (isTilde(folder)) {
    const home = homes.get(device);
    const full = expandOnMac(folder, home ? [home] : own.map((r) => r.folder));
    if (!full) throw new Error(`Can't tell where ~ is on that Mac from its cards: pass the full path, like mac://${labels.get(device) as string}/Users/<you>${folder.slice(1)}.`);
    return macTarget(device, full, labels);
  }
  if (folder.startsWith("/")) return macTarget(device, folder, labels);
  const named = new Set(own.filter((r) => path.basename(r.folder) === folder).map((r) => r.folder));
  const choices = [...named].map((f) => macPath(labels.get(device) as string, f));
  if (choices.length > 1) throw new Error(`“${text}” is more than one project on that Mac. Pass one of these as the folder: ${choices.join(", ")}.`);
  return macTarget(device, choices.length ? ([...named][0] as string) : folder, labels);
}

// A synced row's folder matches a path, a project name or, on a Mac, a ~ path under that Mac's home (the one it published,
// else the one the folder sits in).
const matches = (r: BoardRow, text: string, home?: string) =>
  r.folder === text || path.basename(r.folder) === text || (!r.owner_worker && isTilde(text) && expandOnMac(text, [home ?? r.folder]) === r.folder);

// One Mac seen under two device ids (a re-pair) is one choice, not two: sameMac picks the live one for each folder.
function oneMacPerFolder(hits: RemoteTarget[], macs: MacRow[]): RemoteTarget[] {
  const byFolder = new Map<string, RemoteTarget[]>();
  for (const t of hits) if (t.where === "Mac") byFolder.set(t.folder, [...(byFolder.get(t.folder) ?? []), t]);
  const drop = new Set<RemoteTarget>();
  for (const same of byFolder.values()) {
    const keep = same.length > 1 ? sameMac(same.map((t) => t.target), macs) : null;
    if (keep) for (const t of same) if (t.target !== keep) drop.add(t);
  }
  return hits.filter((t) => !drop.has(t));
}

// Where a project on another host is: worker://<id>/<name> or mac://<Mac>/<path> as given, else the synced cards'
// folders and the Macs' published projects (with cards or not) that match it by path, name or ~ path (that Mac's home).
// One match or an error listing each choice as the string to pass.
export function remoteTarget(folder: string, cards: BoardRow[], self: string, macs: MacRow[] = [], projects: MacProjectsRow[] = []): RemoteTarget {
  const text = folder.trim();
  const named = workerOf(text);
  if (named) return workerTarget(named.id, named.repo);
  const rows = [...cards, ...projectRows(projects)];
  const homes = new Map(projects.filter((p) => p.home.startsWith("/")).map((p) => [p.device, p.home.replace(/\/+$/, "")]));
  const labels = rowLabels(rows, macs);
  if (isMacPath(text)) return macNamed(text, rows, labels, macs, homes);
  const found = new Map<string, RemoteTarget>();
  for (const r of rows) {
    if (r.owner_worker === self) continue;
    if (!matches(r, text, homes.get(r.owner_device))) continue;
    const t = r.owner_worker ? workerTarget(r.owner_worker, r.folder) : macTarget(r.owner_device, r.folder, labels);
    found.set(t.address, t);
  }
  const hits = oneMacPerFolder([...found.values()], macs);
  if (hits.length === 1) return hits[0] as RemoteTarget;
  if (hits.length > 1) throw new Error(`“${text}” is more than one project on your board. Pass one of these as the folder: ${hits.map((t) => t.address).join(", ")}.`);
  const known = [...new Set(rows.filter((r) => r.owner_worker !== self).map((r) => rowPath(r, labels)))];
  throw new Error(`No project “${text}” on this worker or on your board.${known.length ? ` Projects: ${known.slice(0, 12).join(", ")}.` : ""} A project on this worker is a folder under ${boardLink().root}; one on a Mac is mac://<Mac>/<path>, and shows here once Sync is on for it (Settings → Sync on that Mac).`);
}
