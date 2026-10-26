// Which card wrote a file a Bash command left behind, for lib/bash-claims.ts. A file carries an mtime, not
// its writer, and cards share one tree: while one card's `pnpm test` runs, another card's `node gen.mjs`, or
// a puku-cli it started, writes files too. So each Bash call keeps a window, from its PreToolUse to its
// PostToolUse, and a written file goes to a card only when that card's windows are the only ones open at the
// moment it was written. When they aren't, the writer is unknown: no card claims the file, and a failed check
// hears "unknown" for it rather than another card's name (lib/failure-owners.ts).
//
// A call sent to the background (`run_in_background`) returns at once while its process keeps writing, so
// its window stays open for Bash's default background timeout after it returns.

export const BACKGROUND_MS = 30 * 60_000;
// Bash's longest timeout: a window still open after this lost its PostToolUse (a crashed CLI, say), and a
// closed one is kept this long, since a run that ends now can have started that long ago.
const MAX_MS = 2 * 60 * 60_000;
const CAP = 500;

type Window = { card: string; from: number; to: number };
const windows = new Map<string, Window>();
const unknown = new Set<string>();

function prune(now: number) {
  for (const [id, w] of windows) if ((w.to === Infinity ? w.from : w.to) + MAX_MS < now) windows.delete(id);
  while (windows.size > CAP) windows.delete(windows.keys().next().value as string);
}

export function openWindow(id: string, card: string, at = Date.now()) {
  windows.set(id, { card, from: at, to: Infinity });
  prune(at);
}

// Ends a call's window and returns when it opened, or undefined for a call never opened (or already closed).
export function closeWindow(id: string, background: boolean, at = Date.now()): number | undefined {
  const w = windows.get(id);
  if (!w || w.to !== Infinity) return undefined;
  w.to = background ? at + BACKGROUND_MS : at;
  return w.from;
}

// The cards with a Bash call open at `t`; a closed window keeps 1 ms more, since an mtime has a fraction
// of a millisecond the window's clock doesn't.
export function writersAt(t: number): Set<string> {
  const cards = new Set<string>();
  for (const w of windows.values()) if (w.from <= t && t < w.to + 1) cards.add(w.card);
  return cards;
}

// Files written while more than one card's Bash ran, so no card can be named as their writer.
export const markUnknown = (file: string) => unknown.add(file);
export const markKnown = (file: string) => unknown.delete(file);
export const unknownWriters = (): ReadonlySet<string> => unknown;

export function resetWriters() {
  windows.clear();
  unknown.clear();
}
