import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { DEFAULT_SLACK_SETTINGS, type SlackEventKey, type SlackEvents, type SlackLink, type SlackSettings, type SlackSettingsPatch, type SlackThread } from "./slack-types";

// Slack's side of ~/.weft (docs/architecture/slack.md): the drawer's settings, each card's Slack thread, the
// message its status updates reply under, and the growth watermark. No token lives here: those stay sealed in
// Electron main.

interface SlackFile {
  settings: SlackSettings;
  threads: Record<string, SlackThread>;
  // Where the growth watcher got to: the time of the newest event it posted.
  growth: { at: string | null };
}

export type { SlackSettingsPatch };

// How many card threads are kept: the oldest go first, since a card that old has long left the board.
export const MAX_THREADS = 500;

const file = () => path.join(DATA_DIR, "slack.json");

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

// The growth watermark: only a time, or null when nothing has been posted yet.
function cleanGrowth(value: unknown): { at: string | null } {
  if (!value || typeof value !== "object") return { at: null };
  const at = (value as { at?: unknown }).at;
  return { at: typeof at === "string" && at ? at : null };
}

function read(): SlackFile {
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<SlackFile>;
    return {
      settings: clean(data.settings ?? {}, DEFAULT_SLACK_SETTINGS),
      threads: data.threads ?? {},
      growth: cleanGrowth(data.growth),
    };
  } catch {
    return { settings: DEFAULT_SLACK_SETTINGS, threads: {}, growth: { at: null } };
  }
}

function write(next: SlackFile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
}

// Only the fields the drawer may set, each of its type; anything else keeps what `base` had.
function clean(patch: SlackSettingsPatch, base: SlackSettings): SlackSettings {
  const events = { ...base.events };
  for (const key of Object.keys(events) as (keyof SlackEvents)[]) {
    const on = patch.events?.[key];
    if (typeof on === "boolean") events[key] = on;
  }
  const pick = (key: "channel" | "channelName" | "folder") => (key in patch ? str(patch[key]) : base[key]);
  const links = Array.isArray(patch.links) ? cleanLinks(patch.links) : base.links;
  const routes = cleanRoutes(patch.routes, base.routes);
  return { channel: pick("channel"), channelName: pick("channelName"), folder: pick("folder"), links, events, routes };
}

// The channel each kind of update goes to, when it is not the default. A kind with no row follows the default.
function cleanRoutes(
  patch: SlackSettingsPatch["routes"],
  base: SlackSettings["routes"],
): SlackSettings["routes"] {
  if (!patch) return base;
  const routes: SlackSettings["routes"] = {};
  for (const key of Object.keys(base) as SlackEventKey[]) {
    // A kind the patch doesn't mention keeps the row it had.
    if (!(key in patch)) {
      const kept = base[key];
      if (kept) routes[key] = kept;
      continue;
    }
    const row = patch[key];
    // Null clears the row: that kind goes back to the default channel.
    if (row === null || !row) continue;
    const channel = str(row.channel);
    if (!channel) continue;
    routes[key] = { channel, channelName: str(row.channelName) };
  }
  // A kind the base didn't have, added now.
  for (const key of Object.keys(patch) as SlackEventKey[]) {
    if (key in routes) continue;
    const row = patch[key];
    if (!row) continue;
    const channel = str(row.channel);
    if (!channel) continue;
    routes[key] = { channel, channelName: str(row.channelName) };
  }
  return routes;
}

// Whole links only, and one per project and per channel: a later row for either replaces the earlier one.
function cleanLinks(rows: unknown[]): SlackLink[] {
  const links: SlackLink[] = [];
  // A row can be anything the drawer sent, or nothing at all.
  for (const row of rows as (Partial<SlackLink> | null | undefined)[]) {
    const folder = str(row?.folder);
    const channel = str(row?.channel);
    if (!folder || !channel) continue;
    const kept = links.filter((l) => l.folder !== folder && l.channel !== channel);
    links.splice(0, links.length, ...kept, { folder, channel, channelName: str(row?.channelName) });
  }
  return links;
}

export function slackSettings(): SlackSettings {
  return read().settings;
}

export function saveSlackSettings(patch: SlackSettingsPatch): SlackSettings {
  const data = read();
  const settings = clean(patch, data.settings);
  write({ ...data, settings });
  return settings;
}

export function cardThread(cardId: string): SlackThread | null {
  return read().threads[cardId] ?? null;
}

// The card whose Slack thread this is: an @mention there talks to that card.
export function cardOfThread(channel: string, ts: string): string | null {
  const hit = Object.entries(read().threads).find(([, t]) => t.channel === channel && t.ts === ts);
  return hit?.[0] ?? null;
}

export function saveCardThread(cardId: string, thread: SlackThread) {
  const data = read();
  // Last saved goes last, so the trim keeps the newest threads.
  const entries = [...Object.entries(data.threads).filter(([id]) => id !== cardId), [cardId, thread] as const];
  write({ ...data, threads: Object.fromEntries(entries.slice(-MAX_THREADS)) });
}

// Where the growth watcher got to: the time of the newest event it posted.
export function growthWatermark(): { at: string | null } {
  return read().growth;
}

export function saveGrowthWatermark(watermark: { at: string | null }): void {
  const data = read();
  write({ ...data, growth: cleanGrowth(watermark) });
}
