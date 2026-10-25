// The rail's Slack drawer: what Slack needs before it can talk to Weft (lib/slack-view.ts).
// The manifest is the whole setup in one click — Slack builds the app from it, with the scopes, the
// /weft command and the event subscription already filled in. The tokens themselves live in Electron
// main (electron/slack.cjs), never here: this file holds the shapes and the words.

import { norm, rankItems } from "./db-picker";
import { folderName } from "./format";
import manifest from "./slack-manifest.json";
import type { SlackBridge, SlackChannel, SlackSettings, SlackStatus } from "./slack-types";

export type { SlackBridge, SlackChannel, SlackSettings, SlackStatus };

// window.weft.slack, from electron/preload.cjs. Null in a plain browser tab.
export function slackBridge(): SlackBridge | null {
  return (typeof window !== "undefined" && window.weft?.slack) || null;
}

// The manifest Slack's "Create new app" page reads: the app's scopes, /weft and Socket Mode. One file, shared with
// `pnpm slack:manifest` (scripts/slack-app-manifest.mjs), which puts it on an app made by hand.
export const SLACK_MANIFEST = manifest;

// The page that creates the app from the manifest: one click, and Slack has the app set up.
export function manifestUrl() {
  return "https://api.slack.com/apps?new_app=1&manifest_json=" + encodeURIComponent(JSON.stringify(SLACK_MANIFEST));
}

// The rail button's hover text: what Slack is doing for the board right now.
export function slackTitle(status: SlackStatus | null, settings: SlackSettings | null) {
  if (!status?.signedIn) return "Slack: connect a workspace";
  if (settings?.channelName) return `Slack: posting to #${settings.channelName}`;
  return "Slack: pick a channel";
}

// The events the drawer switches on, in the order it shows them.
export const EVENT_KEYS = ["commits", "pushes", "deploys", "status", "growth"] as const;
export type SlackEventKey = (typeof EVENT_KEYS)[number];

export const EVENT_LABELS: Record<SlackEventKey, string> = {
  commits: "Commits",
  pushes: "Pushes",
  deploys: "Deploys (Vercel)",
  status: "Card status (preview + weft.zip link)",
  growth: "Growth (new user, new team, payment)",
};

// The socket's dot: green when it's listening, amber while it connects, grey when it's off.
export const SOCKET_STATE: Record<SlackStatus["socket"], { label: string; tone: "ok" | "warn" | "muted" }> = {
  connected: { label: "listening for /weft", tone: "ok" },
  connecting: { label: "connecting…", tone: "warn" },
  off: { label: "not listening", tone: "muted" },
};

// A private channel the bot isn't in needs an invite; a public one it joins on the first post.
export function channelHint(channel: SlackChannel) {
  if (channel.isMember) return "";
  return channel.isPrivate ? " (invite @Weft)" : " (joins on first post)";
}

// The channel's name as the drawer shows it, with the hint when it needs one.
export function channelLabel(channel: SlackChannel) {
  return `#${channel.name}${channelHint(channel)}`;
}

// How well a channel fits a project, on the drawers' best-fit scale (lib/db-picker.ts, DbSelect badges 2 and up):
// 3 it's the project's name, 2 it carries it (#weft-dev for weft), then 1 for a channel the bot is already in.
export function channelScore(channel: SlackChannel, folder: string | null): number {
  const project = folder ? norm(folderName(folder)) : "";
  const name = norm(channel.name);
  if (project && name === project) return 3;
  if (project && name.includes(project)) return 2;
  return channel.isMember ? 1 : 0;
}

// The channel picker's rows: what the search matches, best fits first, then Slack's own order (members, then names).
export function channelRows(channels: SlackChannel[], search: string, folder: string | null) {
  return rankItems<SlackChannel>({ items: channels, folder, search, score: (c) => channelScore(c, folder), keys: (c) => [c.name], limit: 100 });
}

// A name Slack accepts, as electron/slack-channels.cjs makes it (main normalizes again; this is for the picker's
// suggestion): lowercase, spaces to hyphens, only letters, digits, - and _, at most 80.
export function slackChannelName(text: string): string {
  return text
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\s.]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
