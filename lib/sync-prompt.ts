import { looksScratch } from "./scratch";
import { COPILOT_ID, type Card } from "./types";

// The "Turn on Project Sync?" dialog (components/SyncPromptDialog.tsx): once the welcome is answered and a thread in
// the project you're working in has finished a turn, Weft asks once per launch whether to sync that project to
// weft.zip (lib/cloud-sync.ts), until you sync it or tick "Don't show me again". That box lives in localStorage
// for good, until Settings → General → Reset tips (lib/welcome-client.ts resetOnboarding).

export const SYNC_PROMPT_KEY = "weft-sync-prompt-off";

type PromptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): PromptStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

// Missing, blocked or broken storage reads as "never ticked": the worst case is one more ask.
export function promptOff(storage: PromptStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(SYNC_PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

export function turnPromptOff(storage: PromptStorage | null = defaultStorage()) {
  try {
    storage?.setItem(SYNC_PROMPT_KEY, "1");
  } catch {
    // Full or blocked storage: it asks again next launch, which is all that's lost.
  }
}

export function resetSyncPrompt(storage: PromptStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(SYNC_PROMPT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

// A thread that has finished a turn: it ran, and now waits on you, for review or is done.
const finished = (card: Card) => card.column !== "running" && card.column !== "backlog";
export const finishedCount = (cards: Card[]) => cards.filter(finished).length;

// The project you're working on: the one the board is narrowed to, else the folder of the card that moved last.
// Only a real project counts (no copilot, scratch or worktree folder), and only once one of its threads has
// finished a turn, so first launch asks after your first thread has shown what it does, not while it runs.
export function promptFolder(cwd: string | null | undefined, cards: Card[]): string | null {
  const real = cards.filter((c) => c.id !== COPILOT_ID && !c.archived && !looksScratch(c.cwd) && finished(c));
  if (cwd) return real.some((c) => c.cwd === cwd) ? cwd : null;
  const latest = real.reduce<Card | null>((best, c) => (!best || c.updatedAt > best.updatedAt ? c : best), null);
  return latest?.cwd ?? null;
}

export interface PromptGate {
  folder: string | null;
  // The folders already syncing (GET /api/cloud-sync), null until it answers.
  synced: string[] | null;
  welcomed: boolean;
  off: boolean;
  // Asked already this launch (answered either way).
  asked: boolean;
}

export const shouldAsk = (g: PromptGate): g is PromptGate & { folder: string } =>
  !!g.folder && g.welcomed && !g.off && !g.asked && g.synced !== null && !g.synced.includes(g.folder);
