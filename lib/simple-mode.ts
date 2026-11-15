// Simple mode's pieces (docs/architecture/simple-mode.md). Simple mode is regular mode (lib/board-prefs.ts
// boardMode()): each piece here is on by default in regular mode and off in advanced mode, and its own cookie,
// once set, overrides the mode either way, so you can keep one piece in either mode.
import { boardMode } from "./board-prefs";

export const SIMPLE_PIECES = ["pane-full", "fold-turn-steps", "one-box-new-card", "three-piles"] as const;
export type SimplePiece = (typeof SIMPLE_PIECES)[number];

const EVENT = "weft-board-prefs";
const cookieName = (piece: SimplePiece) => `weft-simple-${piece}`;

// The piece's own setting: true, false, or undefined when it follows the mode.
export function pieceOverride(piece: SimplePiece): boolean | undefined {
  if (typeof document === "undefined") return undefined;
  const value = new RegExp(`(?:^|; )${cookieName(piece)}=([01])`).exec(document.cookie)?.[1];
  return value === undefined ? undefined : value === "1";
}

export function simplePieceOn(piece: SimplePiece): boolean {
  return pieceOverride(piece) ?? boardMode() === "regular";
}

// on undefined clears the override, so the piece follows the mode again.
export function setSimplePiece(piece: SimplePiece, on: boolean | undefined) {
  const age = on === undefined ? 0 : 10 * 365 * 24 * 60 * 60;
  document.cookie = `${cookieName(piece)}=${on ? 1 : 0}; path=/; max-age=${age}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}
