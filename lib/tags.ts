import { CONTROL_CHARS } from "./format";
import type { Card } from "./types";

// Card tags. They follow GitHub's label rules so a card's tags and its issue's labels are the same
// thing: up to 50 characters, unique ignoring case. Weft keeps them lowercase with single spaces.

export const MAX_TAG = 50;
export const MAX_TAGS = 8;
// GitHub caps a label's description at 100 characters.
export const MAX_DESCRIPTION = 100;

// A tag in the catalog (lib/tag-store.ts, served at /api/tags).
export interface TagInfo {
  name: string;
  // "#rrggbb"; left out, the board draws the tag in its steady hue (tagHue).
  color?: string;
  description?: string;
}

// A catalog row: with how many cards carry it, archived ones too.
export interface TagRow extends TagInfo {
  count: number;
}

// A tag as Weft stores it, with no control characters, or undefined when nothing is left: "  Bug  Fix " -> "bug fix", "#ui" -> "ui".
export function normalizeTag(raw: string): string | undefined {
  const tag = raw
    .replace(CONTROL_CHARS, "")
    .replace(/^[#\s]+/, "")
    .replace(/[,\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG)
    .trim();
  return tag || undefined;
}

// Normalized, deduped, in order, capped.
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const tag = normalizeTag(r);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

// Every tag on these cards with how many carry it, most used first (then by name).
export function tagCounts(cards: readonly Pick<Card, "tags">[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of cards) for (const tag of card.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// A steady hue per tag, so "bug" is the same colour everywhere. GitHub sends its own colour with a label.
export function tagHue(tag: string) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
