import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write";
import type { Card, ThreadItem } from "./types";

// The write half of Recently deleted (docs/architecture/card-trash.md): lib/store.ts deleteCard keeps the card and
// its thread here before it removes them. It takes the data folder and the thread as arguments and never imports
// the store, so store.ts can call it without an import cycle; lib/card-trash.ts lists, restores and purges.

export interface TrashEntry {
  card: Card;
  thread: ThreadItem[];
  deletedAt: number;
}

/** How long a deleted card can be restored. */
export const TRASH_MS = 30 * 24 * 60 * 60 * 1000;

export const trashDir = (dataDir: string) => path.join(dataDir, "trash");

// An id names a file in the trash folder, so one with a path separator in it (or "." and "..") names none.
export function trashFile(dataDir: string, id: string): string | null {
  if (!id || id === "." || id === ".." || /[\\/]/.test(id)) return null;
  return path.join(trashDir(dataDir), `${id}.json`);
}

// Keeps a card about to be deleted. Never throws: a full disk or an unreadable thread must not stop the delete.
export function keepDeleted(dataDir: string, card: Card | undefined, thread: () => ThreadItem[], now = Date.now()): boolean {
  if (!card) return false;
  try {
    const file = trashFile(dataDir, card.id);
    if (!file) return false;
    fs.mkdirSync(trashDir(dataDir), { recursive: true });
    const entry: TrashEntry = { card, thread: thread(), deletedAt: now };
    writeFileAtomic(file, JSON.stringify(entry));
    return true;
  } catch (err) {
    console.warn(`Couldn't keep card ${card.id} in Recently deleted; deleting it anyway.`, err);
    return false;
  }
}
