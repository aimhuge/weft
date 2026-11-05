import { firstLine } from "./format";
import type { Card, Column } from "./types";

// What the copilot last saw of each card: its column and error.
export type Seen = Record<string, { column: Column; error?: string }>;

const MAX_ITEMS = 10;
const clip = firstLine;

// The board state worth remembering between copilot turns.
export function snapshot(cards: Card[]): Seen {
  const seen: Seen = {};
  for (const c of cards) if (c.role !== "copilot") seen[c.id] = { column: c.column, error: c.error };
  return seen;
}

// A short note on what finished, needs you, or failed since the copilot's last message, so it
// knows without a paid turn of its own. With no earlier snapshot (first message since the app
// started), a card counts when it changed after `since`, the copilot's last turn.
export function boardDigest(cards: Card[], seen: Seen | undefined, since = 0): string {
  const lines: string[] = [];
  for (const c of cards) {
    if (c.role === "copilot" || c.archived) continue;
    const before = seen?.[c.id];
    const changed = seen ? before?.column !== c.column : (c.lastActivity ?? c.updatedAt) > since;
    const label = `"${clip(c.title, 60)}" (${c.id})`;
    if (c.error && (seen ? before?.error !== c.error : changed)) lines.push(`- Error: ${label}: ${clip(c.error)}`);
    else if (!changed) continue;
    else if (c.column === "review") lines.push(`- Finished, in Review: ${label}${c.lastLine ? `: ${clip(c.lastLine)}` : ""}`);
    else if (c.column === "needs_you") {
      const ask = c.pending?.title ?? c.lastLine;
      lines.push(`- Needs you: ${label}${ask ? `: ${clip(ask)}` : ""}`);
    }
  }
  if (!lines.length) return "";
  const shown = lines.slice(0, MAX_ITEMS);
  if (lines.length > MAX_ITEMS) shown.push(`- …and ${lines.length - MAX_ITEMS} more (see list_cards)`);
  return `[Weft board update since your last message, not written by the user. Context only: the swim lanes already show this, so mention it only when it changes your answer]\n${shown.join("\n")}`;
}

// The text the copilot's CLI gets: the digest, then the user's message unchanged.
export const withDigest = (digest: string, text: string) => (digest ? `${digest}\n\n${text}` : text);

// The last snapshot, kept for the life of the server. The copilot's own moves update it, so it
// isn't told about a card it moved itself.
const g = globalThis as unknown as { __weftCopilotSeen?: Seen };
export const lastSeen = () => g.__weftCopilotSeen;
export const rememberSeen = (seen: Seen) => void (g.__weftCopilotSeen = seen);
export function markSeen(id: string, column: Column) {
  const seen = g.__weftCopilotSeen;
  if (seen?.[id]) seen[id] = { ...seen[id], column };
}
