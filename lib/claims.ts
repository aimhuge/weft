import { busyInFolder, TOUCHED_CAP } from "./overlap";
import { baseName, claimFileName, claimKey, splitClaim, WHOLE_FILE } from "./claim-keys";
import type { Card, CardYield, PromptReason } from "./types";
import { workDir } from "./work-dir";

// Symbol claims: cards share one working tree (no worktree per card, SOUL.md), so a card claims the
// symbols its thread edits, `/abs/Board.tsx#CommandPalette` (or inside a long one, `/abs/Board.tsx#Board/useEffect#3`,
// lib/symbols.ts), or a whole file, `/abs/a.css#*`.
// When another busy card in the same tree goes to edit a claimed symbol, lib/claim-guard.ts asks the user
// to wait or go ahead. Board data only, no git, so the check costs next to nothing.

// The key's parts live in lib/claim-keys.ts (pure, no node:path), so the board's thread panel can name a
// claim's file (lib/waits-on.ts) without dragging this module into the browser chunk. Re-exported here:
// the server's own imports of "./claims" keep working.
export { claimFileName, claimKey, splitClaim, WHOLE_FILE };

// How many claims a card keeps, like its edited files.
export const CLAIMS_CAP = TOUCHED_CAP;

// One symbol inside the other: `Board` holds `Board/useEffect#3`.
const within = (inner: string, outer: string) => inner.startsWith(`${outer}/`);

// Two claims clash on the same symbol, one inside the other, or when either covers the whole file.
export function clashes(a: string, b: string) {
  const x = splitClaim(a);
  const y = splitClaim(b);
  if (x.file !== y.file) return false;
  return x.symbol === y.symbol || x.symbol === WHOLE_FILE || y.symbol === WHOLE_FILE || within(x.symbol, y.symbol) || within(y.symbol, x.symbol);
}

// The card's claims with these added at the front, capped, or undefined when that changes nothing, so
// the caller can skip the write.
export function addClaims(list: string[] | undefined, keys: string[]) {
  const old = list ?? [];
  const next = [...new Set([...keys, ...old])].slice(0, CLAIMS_CAP);
  return next.length === old.length && next.every((k, i) => k === old[i]) ? undefined : next;
}

// The card's claims without those on these files, or undefined when it held none of them.
export function dropClaims(list: string[] | undefined, files: Set<string>) {
  const kept = (list ?? []).filter((k) => !files.has(splitClaim(k).file));
  return kept.length === (list ?? []).length ? undefined : kept;
}

// The files a card claims, by path.
export function claimFiles(card: Card): Set<string> {
  return new Set((card.claims ?? []).map((k) => splitClaim(k).file));
}

// The card that claims each file, for these cards: the first card in the list that claims it wins.
export function claimFilesOf(cards: Card[]): Map<string, Card> {
  const owner = new Map<string, Card>();
  for (const card of cards) for (const file of claimFiles(card)) if (!owner.has(file)) owner.set(file, card);
  return owner;
}

export interface Clash {
  card: Card;
  // Their claim and the one it clashes with.
  theirs: string;
  mine: string;
  // The user put that card first on this file (lib/precedence.ts): this card yields to it.
  first?: boolean;
}

// Whether `from` leaves this file to the card `to` (Me first, lib/precedence.ts).
export const yieldsTo = (from: Card, to: string, file: string) => Boolean(from.yields?.some((y) => y.to === to && y.file === file));

// The card's yields without the one to `to` on this file.
export const withoutYield = (card: Card, to: string, file: string): CardYield[] => (card.yields ?? []).filter((y) => y.to !== to || y.file !== file);

// The first other busy card in this card's tree holding a claim that clashes with one of these. A card that
// yields a file to this one is skipped there: the user put this card first.
export function findClash(cards: Card[], card: Card, keys: string[]): Clash | undefined {
  for (const other of busyInFolder(cards, workDir(card), card.id)) {
    for (const theirs of other.claims ?? []) {
      const { file } = splitClaim(theirs);
      if (yieldsTo(other, card.id, file)) continue;
      const mine = keys.find((k) => clashes(k, theirs));
      if (mine) return { card: other, theirs, mine, ...(yieldsTo(card, other.id, file) && { first: true }) };
    }
  }
  return undefined;
}

// What the permission prompt says: "Card ‘Fix login’ is editing LoginForm in Login.tsx. Wait, or go ahead?",
// or "is editing styles.css" for a whole-file claim.
// One the user put first reads "Card ‘Fix login’ goes first on Login.tsx. Wait, or go ahead?".
export function clashQuestion({ card, theirs, first }: Clash) {
  const { file, symbol } = splitClaim(theirs);
  if (first) return `Card ‘${card.title}’ goes first on ${baseName(file)}. Wait, or go ahead?`;
  const what = symbol === WHOLE_FILE ? baseName(file) : `${symbol} in ${baseName(file)}`;
  return `Card ‘${card.title}’ is editing ${what}. Wait, or go ahead?`;
}

const symbolText = (symbol: string) => symbol.split("/").map((part) => part.replace(/#(\d+)$/, " #$1")).join(" › ");

// Why the prompt came up, by category: the same symbol, one symbol inside the other, or a whole-file
// claim on either side; the detail names the holding card and what it has uncommitted. The shared-tree
// explanation is the same every time, so the prompt keeps it in the chip's tooltip.
export function clashWhy({ card, theirs, mine, first }: Clash): PromptReason {
  const t = splitClaim(theirs);
  const m = splitClaim(mine);
  // A holder waiting on its own holder is still holding the code, so it reads as running.
  const state = card.column === "needs_you" ? "waiting on you" : card.pending?.waiting ? "waiting" : "running";
  const held = t.symbol === WHOLE_FILE ? baseName(t.file) : symbolText(t.symbol);
  const category = t.symbol === WHOLE_FILE || m.symbol === WHOLE_FILE ? "whole-file" : m.symbol === t.symbol ? "same-code" : "overlap";
  return {
    category,
    detail: `‘${card.title}’ (${state}) has uncommitted edits to ${held}`,
    holder: { id: card.id, title: card.title, claim: theirs, emoji: card.emoji, thumb: card.thumb, ...(first && { first: true as const }) },
  };
}
