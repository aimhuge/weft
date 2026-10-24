import { normalizeTag, normalizeTags, tagCounts, tagHue } from "./tags";
import type { Card } from "./types";

// How the left rail reads (components/LibraryRail.tsx): ★ starred and 🏷 tags filter the board, 🔐 and the
// tools under it open their drawers. Pure, so it's testable and safe in the browser.

// What the rail's drawer can show: every tag (components/TagsDrawer.tsx), the secrets vault
// (components/VaultDrawer.tsx), the webhooks (components/WebhooksDrawer.tsx), Vercel, Supabase, Cloudflare, BlastCP or GitHub. ★ has no drawer: it filters the board.
// "admin" is the SuperAdmin group (Users, Billing, Coupons, Settings) — visible only when the signed-in Weft
// account is on SUPER_ADMIN_EMAILS (lib/admin.ts). It doesn't open a drawer; it renders a
// popover with the two admin links, since the pages live at /admin/users and /admin/settings.
export type RailPanel = "tags" | "vault" | "webhooks" | "vercel" | "supabase" | "cloudflare" | "blastcp" | "github" | "services" | "skills" | "admin";

// The board narrowed to starred cards, a tag, or both. Empty shows everything.
export interface RailFilter {
  starred?: boolean;
  tag?: string;
}

export function filterCards<T extends Pick<Card, "starred" | "tags">>(cards: readonly T[], filter: RailFilter): T[] {
  if (!filter.starred && !filter.tag) return cards as T[];
  return cards.filter((c) => (!filter.starred || c.starred) && (!filter.tag || (c.tags ?? []).includes(filter.tag)));
}

export const isFiltering = (filter: RailFilter) => Boolean(filter.starred || filter.tag);

// Clicking a tag filters to it; clicking it again clears it. ★ stays as it was.
export function toggleTag(filter: RailFilter, tag: string): RailFilter {
  return { ...filter, tag: filter.tag === tag ? undefined : tag };
}

// ★'s badge: starred cards still on the board.
export const starredCount = (cards: readonly Pick<Card, "starred" | "archived">[]) => cards.filter((c) => c.starred && !c.archived).length;

// A card's tags with one more (typed, or a tag row a card was dropped on), or undefined when nothing changes.
export function addTag(tags: readonly string[] | undefined, raw: string): string[] | undefined {
  const tag = normalizeTag(raw);
  const current = tags ?? [];
  if (!tag || current.includes(tag)) return undefined;
  const next = normalizeTags([...current, tag]);
  return next.length > current.length ? next : undefined;
}

export const removeTag = (tags: readonly string[] | undefined, tag: string) => (tags ?? []).filter((t) => t !== tag);

// The tag editor's suggestions: tags used on the board that this card doesn't have, starting with what's
// typed first, then containing it, most used first (tagCounts' order).
export function tagSuggestions(all: readonly { tag: string; count: number }[], current: readonly string[], typed: string, limit = 6): string[] {
  const q = normalizeTag(typed) ?? "";
  const free = all.filter((t) => !current.includes(t.tag) && t.tag.includes(q));
  const starts = free.filter((t) => t.tag.startsWith(q));
  const rest = free.filter((t) => !t.tag.startsWith(q));
  return [...starts, ...rest].slice(0, limit).map((t) => t.tag);
}

// A tag in the catalog (app/api/tags, ~/.weft/tags.json): its colour (GitHub's hex, with or without #) and
// what it's for. count is how many cards carry it.
export interface TagInfo {
  name: string;
  color?: string;
  description?: string;
  count: number;
}

// Every tag for the 🏷 drawer: the catalog's (kept even on no card) and any a card carries that the catalog
// doesn't know yet, counted from the board's cards, most used first.
export function tagList(catalog: readonly Omit<TagInfo, "count">[] | null, cards: readonly Pick<Card, "tags">[]): TagInfo[] {
  const counts = new Map(tagCounts(cards).map((t) => [t.tag, t.count]));
  const list: TagInfo[] = (catalog ?? []).map((t) => ({ ...t, count: counts.get(t.name) ?? 0 }));
  for (const [name, count] of counts) if (!list.some((t) => t.name === name)) list.push({ name, count });
  return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// A tag's colour as CSS: the catalog's, else a steady hue from its name.
export function tagColor(name: string, color?: string) {
  if (color && /^#?[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color)) return color.startsWith("#") ? color : `#${color}`;
  return `hsl(${tagHue(name)} 55% 50%)`;
}

// Name -> CSS colour for every tag in the list, for the pills on cards.
export const tagColors = (list: readonly Pick<TagInfo, "name" | "color">[]): Record<string, string> =>
  Object.fromEntries(list.map((t) => [t.name, tagColor(t.name, t.color)]));

// Colours to pick from in the drawer, GitHub's label palette.
export const TAG_PALETTE = ["#d73a4a", "#e99695", "#f9d0c4", "#fbca04", "#fef2c0", "#0e8a16", "#c2e0c6", "#006b75", "#1d76db", "#0052cc", "#5319e7", "#d4c5f9", "#b60205", "#e4e669", "#bfd4f2", "#cfd3d7"];

// What a card shows: up to max tags, and how many more there are.
export function cardTags(tags: readonly string[] | undefined, max = 2): { shown: string[]; more: number } {
  const all = tags ?? [];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

// What deleting a tag asks first.
export const deleteTagQuestion = (name: string, count: number) =>
  `Delete the tag “${name}”?${count ? ` ${count} card${count === 1 ? "" : "s"} will lose it.` : ""}`;

// Pinned, the drawer sits beside the board instead of sliding over it. Remembered per browser, under the key
// it had when the rail was the library, so the choice carries over.
const PINNED = "weft.libraryPinned";

export function railPinned() {
  try {
    return localStorage.getItem(PINNED) === "1";
  } catch {
    return false;
  }
}

export function setRailPinned(on: boolean) {
  try {
    localStorage.setItem(PINNED, on ? "1" : "0");
  } catch {}
}
