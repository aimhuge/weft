import type { AppOwner } from "./app-share-types";
import { tagHue } from "./tags";
import type { CardShareMemo } from "./types-card-detail";

// Mini apps: a page from the browser pane, saved so it's one click away on the left rail, below
// Services (components/AppsRail.tsx). A thread's HTML page in ~/.weft/show, a dashboard, a dev server: anything
// the pane can show. Kept in ~/.weft/apps.json by lib/mini-app-store.ts. Pure, so it's testable and
// safe in the browser.

export interface MiniApp {
  id: string;
  name: string;
  url: string;
  addedAt: number;
  // The page it was saved from when that wasn't its own address: a worker card's blob page (blob:sha256:<hex>), kept
  // here on this Mac as a file (lib/mini-app-worker.ts), so the pane's Save as app knows that page is this app.
  source?: string;
  // Its share link as last read from Supabase (lib/app-share.ts), so the Share dialog and My mini apps draw at once.
  share?: AppShareMemo;
}

// An app's share as last read: a card's memo plus the link's public address, weft.zip/@username/apps/<slug> or
// weft.zip/<org-slug>/apps/<slug> (appPublicUrl in lib/app-share-types.ts), once the link has a slug.
export type AppShareMemo = CardShareMemo & {
  url?: string | null;
  owner?: AppOwner | null;
  slug?: string | null;
  orgId?: string | null;
};

export const MAX_APP_NAME = 40;

// The pages an app can be: the web and local files. Anything else (about:, data:, weft:) is refused.
export function cleanAppUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const url = new URL(raw.trim());
    return ["http:", "https:", "file:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// The sha of a page a worker card showed (a blob in the workspace's store, lib/worker-pane.ts), or null for any other
// address. Saving one as an app brings the page to this Mac first (lib/mini-app-worker.ts).
export function blobPageSha(raw: unknown): string | null {
  return typeof raw === "string" ? (/^blob:sha256:([0-9a-f]{64})(#.*)?$/.exec(raw.trim())?.[1] ?? null) : null;
}

export function cleanAppName(raw: unknown): string | undefined {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_APP_NAME).trim() : "";
  return name || undefined;
}

// A new app's name: the page's title, else its host, else its file's name without .html.
export function appNameFrom(title: string | undefined, url: string): string {
  const named = cleanAppName(title);
  if (named) return named;
  try {
    const u = new URL(url);
    if (u.protocol !== "file:") return u.host || url;
    const file = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return cleanAppName(file.replace(/\.html?$/i, "").replace(/[-_]+/g, " ")) ?? "App";
  } catch {
    return "App";
  }
}

// The rail's tile: a name that starts with an emoji shows that emoji, else its first letter on a steady hue.
export function appGlyph(name: string): { text: string; emoji: boolean; hue: number } {
  // By grapheme, so a flag or a family emoji stays one tile.
  const first = new Intl.Segmenter().segment(name.trim())[Symbol.iterator]().next().value?.segment ?? "?";
  const emoji = /\p{Extended_Pictographic}/u.test(first);
  return { text: emoji ? first : first.toUpperCase(), emoji, hue: tagHue(name) };
}

// The app a page is, if any: the same address, or a page inside it (a tour page's #step, a dashboard's
// own links) when that's the closest saved app.
export function appFor(apps: readonly MiniApp[], url: string | undefined): MiniApp | undefined {
  if (!url) return undefined;
  const bare = (u: string) => u.replace(/#.*$/, "");
  const exact = apps.find((a) => a.url === url) ?? apps.find((a) => bare(a.url) === bare(url) || (a.source !== undefined && bare(a.source) === bare(url)));
  if (exact) return exact;
  return apps
    .filter((a) => url.startsWith(bare(a.url).replace(/\/?$/, "/")))
    .sort((a, b) => b.url.length - a.url.length)[0];
}

// Saving a page that's already an app renames it rather than adding it twice.
export function upsertApp(apps: readonly MiniApp[], app: MiniApp): MiniApp[] {
  const i = apps.findIndex((a) => a.url === app.url);
  if (i < 0) return [...apps, app];
  return apps.map((a, j) => (j === i ? { ...a, name: app.name } : a));
}

// An app moved to index `to` (Move up or down on the rail), the others keeping their order.
export function moveApp(apps: readonly MiniApp[], id: string, to: number): MiniApp[] {
  const app = apps.find((a) => a.id === id);
  if (!app) return [...apps];
  const rest = apps.filter((a) => a.id !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), app, ...rest.slice(at)];
}

// Right-click on an app on the rail.
export type AppAction = "open" | "rename" | "share" | "up" | "down" | "copy" | "remove";

export function appMenu(apps: readonly MiniApp[], id: string) {
  const i = apps.findIndex((a) => a.id === id);
  return [
    { id: "open", label: "Open" },
    { id: "rename", label: "Rename…" },
    { id: "share", label: "Share…" },
    { type: "separator" as const },
    { id: "up", label: "Move up", enabled: i > 0 },
    { id: "down", label: "Move down", enabled: i >= 0 && i < apps.length - 1 },
    { id: "copy", label: "Copy address" },
    { type: "separator" as const },
    { id: "remove", label: "Remove app" },
  ];
}
