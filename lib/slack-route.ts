import type { SlackSettings } from "./slack-types";

// Where a project's updates go and which project a channel's cards run in (docs/architecture/slack.md): a project
// mapped to its own channel uses it both ways; everything else falls back to the drawer's default channel and project.

const within = (cwd: string, folder: string) => {
  // A folder that ends in a slash still names itself: /dev/app/ holds /dev/app.
  const base = folder.endsWith("/") ? folder.slice(0, -1) : folder;
  return cwd === base || cwd.startsWith(`${base}/`);
};

// The channel for something that happened in `cwd`: the link of the closest project folder holding it, else the default.
export function channelFor(settings: SlackSettings, cwd: string): string | null {
  const hits = settings.links.filter((l) => within(cwd, l.folder));
  const closest = hits.sort((a, b) => b.folder.length - a.folder.length)[0];
  return closest?.channel ?? settings.channel;
}

// The project a card started in `channel` runs in: the one mapped to it, else the default project.
export function folderFor(settings: SlackSettings, channel: string): string | null {
  return settings.links.find((l) => l.channel === channel)?.folder ?? settings.folder;
}

// Whether anything is set to post at all: a default channel or a mapped one.
export const hasChannel = (settings: SlackSettings) => Boolean(settings.channel) || settings.links.length > 0;
