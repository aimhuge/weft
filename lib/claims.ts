import path from "node:path";
import { busyInFolder, TOUCHED_CAP } from "./overlap";
import type { Card, PromptReason } from "./types";
import { workDir } from "./work-dir";

// Symbol claims: cards share one working tree (no worktree per card, SOUL.md), so a card claims the
// symbols its thread edits, `/abs/Board.tsx#CommandPalette` (or inside a long one, `/abs/Board.tsx#Board/useEffect#3`,
// lib/symbols.ts), or a whole file, `/abs/a.css#*`.
// When another busy card in the same tree goes to edit a claimed symbol, lib/claim-guard.ts asks the user
// to wait or go ahead. Board data only, no git, so the check costs next to nothing.

export const WHOLE_FILE = "*";

// How many claims a card keeps, like its edited files.
export const CLAIMS_CAP = TOUCHED_CAP;

// A path's own # is escaped (and %, so it reads back), so a key's first # is where its symbol starts:
// symbols hold # of their own, order numbers anywhere along them (`Board/return/div#2/main`).
export function claimKey(file: string, symbol: string = WHOLE_FILE) {
  return `${file.replace(/%/g, "%25").replace(/#/g, "%23")}#${symbol}`;
}

// A key's file and symbol.
export function splitClaim(key: string) {
  const at = key.indexOf("#");
  return { file: key.slice(0, at).replace(/%23/g, "#").replace(/%25/g, "%"), symbol: key.slice(at + 1) };
}

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

export interface Clash {
  card: Card;
  // Their claim and the one it clashes with.
  theirs: string;
  mine: string;
}

// The first other busy card in this card's tree holding a claim that clashes with one of these.
export function findClash(cards: Card[], card: Card, keys: string[]): Clash | undefined {
  for (const other of busyInFolder(cards, workDir(card), card.id)) {
    for (const theirs of other.claims ?? []) {
      const mine = keys.find((k) => clashes(k, theirs));
      if (mine) return { card: other, theirs, mine };
    }
  }
  return undefined;
}

// What the permission prompt says: "Card ‘Fix login’ is editing LoginForm in Login.tsx. Wait, or go ahead?",
// or "is editing styles.css" for a whole-file claim.
export function clashQuestion({ card, theirs }: Clash) {
  const { file, symbol } = splitClaim(theirs);
  const what = symbol === WHOLE_FILE ? path.basename(file) : `${symbol} in ${path.basename(file)}`;
  return `Card ‘${card.title}’ is editing ${what}. Wait, or go ahead?`;
}

const symbolText = (symbol: string) => symbol.split("/").map((part) => part.replace(/#(\d+)$/, " #$1")).join(" › ");

// Why the prompt came up, by category: the same symbol, one symbol inside the other, or a whole-file
// claim on either side; the detail names the holding card and what it has uncommitted. The shared-tree
// explanation is the same every time, so the prompt keeps it in the chip's tooltip.
export function clashWhy({ card, theirs, mine }: Clash): PromptReason {
  const t = splitClaim(theirs);
  const m = splitClaim(mine);
  // A holder waiting on its own holder is still holding the code, so it reads as running.
  const state = card.column === "needs_you" ? "waiting on you" : card.pending?.waiting ? "waiting" : "running";
  const held = t.symbol === WHOLE_FILE ? path.basename(t.file) : symbolText(t.symbol);
  const category = t.symbol === WHOLE_FILE || m.symbol === WHOLE_FILE ? "whole-file" : m.symbol === t.symbol ? "same-code" : "overlap";
  return {
    category,
    detail: `‘${card.title}’ (${state}) has uncommitted edits to ${held}`,
    holder: { id: card.id, title: card.title, claim: theirs },
  };
}
