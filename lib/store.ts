import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { publish } from "./bus";
import { picturesPatch, threadPictures } from "./card-pictures";
import { CLOSED_LINE, MAX_RESUMES } from "./card-resume";
import { foldFrom } from "./edit-last";
import type { Card, ThreadItem } from "./types";
import { globalSingleton } from "./global-singleton";
import { normalizeTags } from "./tags";
import { compareCardOrder, ordersForSlot } from "./card-order";
import { orphanTasks } from "./tasks";
import { writeFileAtomic } from "./atomic-write";

// The app was called Threadboard and kept its data in ~/.threadboard. Move that folder to
// ~/.weft the first time, unless ~/.weft already exists. If the move fails, keep using the old one.
function defaultDataDir() {
  const dir = path.join(os.homedir(), ".weft");
  const legacy = path.join(os.homedir(), ".threadboard");
  if (!fs.existsSync(dir) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, dir);
    } catch (err) {
      console.warn(`Couldn't move ${legacy} to ${dir}; using ${legacy}.`, err);
      return legacy;
    }
  }
  return dir;
}

export const DATA_DIR = process.env.WEFT_DATA || defaultDataDir();
const BOARD_FILE = path.join(DATA_DIR, "board.json");
const THREADS_DIR = path.join(DATA_DIR, "threads");

interface State {
  cards: Map<string, Card>;
  threads: Map<string, ThreadItem[]>;
}

function state(): State {
  return globalSingleton("__weftState", loadState);
}

function loadState(): State {
  fs.mkdirSync(THREADS_DIR, { recursive: true });
  const cards = new Map<string, Card>();
  if (fs.existsSync(BOARD_FILE)) {
    const saved = JSON.parse(fs.readFileSync(BOARD_FILE, "utf8")) as { cards: Card[] };
    for (const card of saved.cards) {
      // A card can't still be live after a restart: its CLI process is gone.
      card.warm = false;
      delete card.wrappingUp;
      // Its subagents ran in that CLI's process group, so they ended with it.
      card.tasks = orphanTasks(card.tasks, Date.now()) ?? card.tasks;
      if (card.column === "running" || card.pending) {
        card.column = "review";
        delete card.archived; // as updateCard does: a card back in Review isn't filed away
        card.pending = null;
        card.lastLine = CLOSED_LINE;
        // lib/resume.ts carries the turn on, unless it's been cut off MAX_RESUMES carry-ons in a row.
        if ((card.resumes ?? 0) < MAX_RESUMES) card.interrupted = true;
      }
      cards.set(card.id, card);
    }
    if (migrateLibrary([...cards.values()])) writeFileAtomic(BOARD_FILE, JSON.stringify({ cards: [...cards.values()] }, null, 2));
  }
  return { cards, threads: new Map() };
}

// The library (recipes, to-dos, notes) gave way to a star and tags. A card that was in it is starred and
// tagged with its old kind, read from the library's items.json indexes, which stay where they are.
// Returns whether any card changed, so the board is saved once.
type LegacyCard = Card & { libraryId?: string; recipeId?: string };
const KIND_TAGS: Record<string, string> = { recipe: "recipe", todo: "to-do", note: "note" };

function migrateLibrary(cards: LegacyCard[]): boolean {
  const old = cards.filter((c) => "libraryId" in c || "recipeId" in c);
  if (!old.length) return false;
  const kinds = libraryKinds();
  for (const card of old) {
    if (card.libraryId) {
      card.starred = true;
      const tag = KIND_TAGS[kinds.get(card.libraryId) ?? ""];
      if (tag) Object.assign(card, { tags: normalizeTags([...(card.tags ?? []), tag]), tagsBy: "user" });
    }
    delete card.libraryId;
    delete card.recipeId;
  }
  return true;
}

// Library item id -> kind, from ~/.weft/library/items.json and each project's under projects/.
function libraryKinds(): Map<string, string> {
  const dir = path.join(DATA_DIR, "library");
  const projects = path.join(dir, "projects");
  const indexes = [dir, ...(fs.existsSync(projects) ? fs.readdirSync(projects).map((d) => path.join(projects, d)) : [])];
  const kinds = new Map<string, string>();
  for (const index of indexes) {
    try {
      const { items } = JSON.parse(fs.readFileSync(path.join(index, "items.json"), "utf8")) as { items?: { id: string; kind: string }[] };
      for (const item of items ?? []) kinds.set(item.id, item.kind);
    } catch {
      // No index there, or a broken one: those cards are starred without a kind tag.
    }
  }
  return kinds;
}

function saveBoard() {
  const cards = [...state().cards.values()];
  // Temp file, fsync, rename (lib/atomic-write.ts): a crash mid-write can't leave a half-written board.
  writeFileAtomic(BOARD_FILE, JSON.stringify({ cards }, null, 2));
}

function threadFile(id: string) {
  return path.join(THREADS_DIR, `${id}.json`);
}

export function listCards(): Card[] {
  backfillPictures();
  backfillOrder();
  return [...state().cards.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

const pictured = globalThis as unknown as { __weftPicturesBackfill?: boolean };

// Cards made before thumbnails existed: read their threads once, a card per tick so the server stays
// responsive, then save the board once. Archived cards are skipped; they're hidden anyway.
function backfillPictures() {
  if (pictured.__weftPicturesBackfill) return;
  pictured.__weftPicturesBackfill = true;
  const todo = [...state().cards.values()].filter((c) => c.pictures === undefined && !c.archived);
  if (!todo.length) return;
  const step = () => {
    const card = todo.shift();
    if (!card) {
      saveBoard();
      return;
    }
    const cached = state().threads.has(card.id);
    try {
      const found = threadPictures(getThread(card.id));
      card.pictures = found.pictures;
      card.thumb ??= found.thumb;
      if (found.thumb) publish({ type: "card", card });
      // A thread read only for this stays out of the cache.
      if (!cached) state().threads.delete(card.id);
    } catch {
      card.pictures = 0;
    }
    setImmediate(step);
  };
  setImmediate(step);
}

export function getCard(id: string): Card | undefined {
  return state().cards.get(id);
}

export function createCard(
  input: Omit<Card, "id" | "column" | "createdAt" | "updatedAt">,
  id: string = randomUUID(),
): Card {
  const now = Date.now();
  // Stamp an order so the new card lands at the end of its column's chosen order (Backlog
  // surfaces by order; createdAt is a fine starting value since it's monotonically
  // increasing per-card). This also means a brand-new card sorts after older ones.
  const card: Card = { ...input, id, column: "backlog", createdAt: now, updatedAt: now, order: now };
  state().cards.set(card.id, card);
  saveBoard();
  publish({ type: "card", card });
  return card;
}

// Adds many cards at once with a single save (used when picking up existing sessions).
export function addCards(cards: Card[]) {
  for (const card of cards) {
    // Mirror createCard: stamp order on cards that don't have one. Old imports may carry
    // createdAt but no order, so we backfill here too.
    if (typeof card.order !== "number") card.order = card.createdAt;
    state().cards.set(card.id, card);
  }
  saveBoard();
  for (const card of cards) publish({ type: "card", card });
}

export function updateCard(id: string, patch: Partial<Card>): Card {
  const card = state().cards.get(id);
  if (!card) throw new Error(`No card ${id}`);
  const now = Date.now();
  const moved = patch.column !== undefined && patch.column !== card.column;
  Object.assign(card, patch, { updatedAt: now }, moved ? { columnAt: now } : {});
  // Archived means filed away from Done. Any other move (a turn ending in Review, a closed session, a drag)
  // brings it back, or a card that still needs you would vanish; a patch that sets archived itself decides.
  if (moved && card.column !== "done" && patch.archived === undefined) delete card.archived;
  // A card's symbol claims (lib/claims.ts) end with its work: at Done, or when it's archived.
  if (card.column === "done" || card.archived) delete card.claims;
  saveBoard();
  publish({ type: "card", card });
  return card;
}

// Backfill order on any card that doesn't have it. Runs once on first listCards after load.
const orderBackfillOnce = globalThis as unknown as { __weftOrderBackfill?: boolean };
export function backfillOrder() {
  if (orderBackfillOnce.__weftOrderBackfill) return;
  orderBackfillOnce.__weftOrderBackfill = true;
  const cards = [...state().cards.values()];
  let changed = false;
  for (const card of cards) {
    if (typeof card.order === "number") continue;
    card.order = card.createdAt;
    changed = true;
  }
  if (changed) saveBoard();
}

// Place `id` before `beforeId` (or at the end of its column when beforeId is null) in the
// card's own column. Other columns are left alone — the user is only reordering Backlog.
export function reorderCard(id: string, beforeId: string | null): Card {
  const card = state().cards.get(id);
  if (!card) throw new Error(`No card ${id}`);
  // A reorder must build on saved order so a later drag doesn't jump to the creation sequence.
  const siblings = [...state().cards.values()]
    .filter((c) => c.column === card.column && c.id !== id)
    .sort(compareCardOrder);
  // The new position of `card` in `siblings`. beforeId === null puts it at the end.
  if (beforeId === id) return card;
  const beforeIndex = beforeId === null ? siblings.length : siblings.findIndex((c) => c.id === beforeId);
  if (beforeIndex < 0) throw new Error("The target card must be in the same column.");
  // Share the slot and gap math with the optimistic board update.
  const orderChanges = ordersForSlot(siblings, id, beforeIndex);
  for (const [changedId, order] of orderChanges) {
    const changedCard = state().cards.get(changedId);
    if (changedCard) changedCard.order = order;
  }
  saveBoard();
  for (const changedId of orderChanges.keys()) {
    const changedCard = state().cards.get(changedId);
    if (changedCard) publish({ type: "card", card: changedCard });
  }
  return card;
}

export function deleteCard(id: string) {
  state().cards.delete(id);
  state().threads.delete(id);
  fs.rmSync(threadFile(id), { force: true });
  saveBoard();
  publish({ type: "card_deleted", id });
}

export function getThread(id: string): ThreadItem[] {
  const threads = state().threads;
  let items = threads.get(id);
  if (!items) {
    const file = threadFile(id);
    items = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as ThreadItem[]) : [];
    threads.set(id, items);
  }
  return items;
}

function saveThread(id: string) {
  fs.writeFileSync(threadFile(id), JSON.stringify(getThread(id)));
}

export function replaceThread(id: string, items: ThreadItem[]) {
  state().threads.set(id, items);
  saveThread(id);
  setPictures(id, threadPictures(items));
}

// Keeps the card's thumbnail current as its thread changes. Not activity, so updatedAt stays put.
function setPictures(cardId: string, patch?: Pick<Card, "pictures" | "thumb">) {
  const card = state().cards.get(cardId);
  if (!card || !patch || (patch.pictures === card.pictures && patch.thumb === card.thumb)) return;
  Object.assign(card, patch);
  saveBoard();
  publish({ type: "card", card });
}

// Sets a card's fields that aren't activity (its pane capture, its emoji), leaving updatedAt alone.
export function decorateCard(id: string, patch: Partial<Pick<Card, "thumb" | "emoji" | "title" | "titleBy" | "tags" | "tagsBy" | "share" | "page" | "pages">>) {
  const card = state().cards.get(id);
  if (!card) return;
  Object.assign(card, patch);
  saveBoard();
  publish({ type: "card", card });
}

export function clearThread(id: string) {
  state().threads.set(id, []);
  saveThread(id);
  publish({ type: "thread_cleared", cardId: id });
}

export function appendThread(cardId: string, item: ThreadItem): number {
  const items = getThread(cardId);
  items.push(item);
  saveThread(cardId);
  publish({ type: "thread", cardId, item, index: items.length - 1 });
  const card = state().cards.get(cardId);
  if (card) setPictures(cardId, picturesPatch(card, item));
  return items.length - 1;
}

// Folds the thread from `from` on into one "edited" item: the message ↑ edited and its turn.
export function foldThread(cardId: string, from: number) {
  const items = foldFrom(getThread(cardId), from, Date.now());
  const folded = items[items.length - 1];
  state().threads.set(cardId, items);
  saveThread(cardId);
  setPictures(cardId, threadPictures(items));
  if (folded) publish({ type: "thread", cardId, item: folded, index: items.length - 1, truncate: true });
}

// Drops the thread from `from` on (a copilot check-in it answered QUIET, lib/copilot-initiative-run.ts).
export function dropThreadFrom(cardId: string, from: number) {
  const items = getThread(cardId).slice(0, from);
  state().threads.set(cardId, items);
  saveThread(cardId);
  const last = items[items.length - 1];
  publish(last ? { type: "thread", cardId, item: last, index: items.length - 1, truncate: true } : { type: "thread_cleared", cardId });
}

export function replaceThreadItem(cardId: string, index: number, item: ThreadItem) {
  const items = getThread(cardId);
  const before = items[index];
  items[index] = item;
  saveThread(cardId);
  const card = state().cards.get(cardId);
  if (card) setPictures(cardId, picturesPatch(card, item, before));
  publish({ type: "thread", cardId, item, index });
}
