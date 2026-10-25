import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { DEFAULT_SLACK_SETTINGS, type SlackEvents, type SlackLink, type SlackSettings, type SlackSettingsPatch, type SlackThread } from "./slack-types";

// Slack's side of ~/.weft (docs/architecture/slack.md): the drawer's settings and each card's Slack thread, the
// message its status updates reply under. No token lives here: those stay sealed in Electron main.

interface SlackFile {
  settings: SlackSettings;
  threads: Record<string, SlackThread>;
}

export type { SlackSettingsPatch };

// How many card threads are kept: the oldest go first, since a card that old has long left the board.
export const MAX_THREADS = 500;

const file = () => path.join(DATA_DIR, "slack.json");

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function read(): SlackFile {
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<SlackFile>;
    return { settings: clean(data.settings ?? {}, DEFAULT_SLACK_SETTINGS), threads: data.threads ?? {} };
  } catch {
    return { settings: DEFAULT_SLACK_SETTINGS, threads: {} };
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
  return { channel: pick("channel"), channelName: pick("channelName"), folder: pick("folder"), links, events };
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
