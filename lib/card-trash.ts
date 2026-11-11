import fs from "node:fs";
import path from "node:path";
import { TRASH_MS, trashDir, trashFile, type TrashEntry } from "./card-trash-file";
import { addCards, DATA_DIR, getCard, replaceThread } from "./store";
import { orphanTasks } from "./tasks";
import type { Card } from "./types";
import type { TrashItem } from "./trash-client";

// Recently deleted (docs/architecture/card-trash.md): a deleted card waits in DATA_DIR/trash/<id>.json for 30 days
// (written by lib/card-trash-file.ts from deleteCard), listed newest first and put back on the board by Restore.

const ENTRY_SUFFIX = ".json";

function entryFiles(): string[] {
  const dir = trashDir(DATA_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ENTRY_SUFFIX) && !f.startsWith(".")).map((f) => path.join(dir, f));
}

function readEntry(file: string): TrashEntry | null {
  try {
    const { card, thread, deletedAt } = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<TrashEntry>;
    return card && typeof deletedAt === "number" ? { card, thread: thread ?? [], deletedAt } : null;
  } catch {
    return null;
  }
}

// When a file stopped being restorable: its deletedAt, or for one that won't parse, when it was written.
function deletedAt(file: string, entry: TrashEntry | null): number {
  return entry ? entry.deletedAt : fs.statSync(file).mtimeMs;
}

/** Removes the entries deleted more than 30 days before `now`; answers how many went. */
export function purgeTrash(now = Date.now()): number {
  let purged = 0;
  for (const file of entryFiles()) {
    if (now - deletedAt(file, readEntry(file)) <= TRASH_MS) continue;
    fs.rmSync(file, { force: true });
    purged++;
  }
  return purged;
}

/** The deleted cards still restorable, newest first. */
export function listTrash(now = Date.now()): TrashItem[] {
  purgeTrash(now);
  const items: TrashItem[] = [];
  for (const file of entryFiles()) {
    const entry = readEntry(file);
    if (!entry) continue;
    const { id, title, cwd } = entry.card;
    items.push({ id, title, cwd, deletedAt: entry.deletedAt });
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

// A card can't still be live once it was deleted: its CLI went with it, as at a restart (lib/store.ts loadState).
function revived(card: Card, now: number): Card {
  const next: Card = { ...card, warm: false };
  delete next.wrappingUp;
  next.tasks = orphanTasks(next.tasks, now) ?? next.tasks;
  if (next.column === "running" || next.pending) {
    next.column = "review";
    next.pending = null;
  }
  return next;
}

/** Puts a deleted card and its thread back on the board and empties its place in the trash. */
export function restoreFromTrash(id: string, now = Date.now()): Card {
  const file = trashFile(DATA_DIR, id);
  const entry = file && fs.existsSync(file) ? readEntry(file) : null;
  if (!file || !entry || now - entry.deletedAt > TRASH_MS) throw new Error("That card isn't in Recently deleted any more.");
  if (getCard(id)) throw new Error("That card is already on the board.");
  const card = revived(entry.card, now);
  addCards([card]);
  replaceThread(id, entry.thread);
  fs.rmSync(file, { force: true });
  return card; // the stored card itself, with the pictures replaceThread put on it
}
