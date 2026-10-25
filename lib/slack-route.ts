import type { SlackEventKey, SlackSettings } from "./slack-types";

// Where an update goes (docs/architecture/slack.md): a kind with a channel of its own goes there, else a project
// mapped to a channel uses it, else the default channel.
//
// The order matters: a kind's own channel is the most specific answer, and it beats a project's channel — which
// is the whole point of routing commits to one channel and deploys to another.

const within = (cwd: string, folder: string) => {
  // A folder that ends in a slash still names itself: /dev/app/ holds /dev/app.
  const base = folder.endsWith("/") ? folder.slice(0, -1) : folder;
  return cwd === base || cwd.startsWith(`${base}/`);
};

// The channel for something that happened in `cwd`: the kind's own channel, else the link of the closest
// project folder holding it, else the default.
export function channelFor(settings: SlackSettings, cwd: string, kind?: SlackEventKey): string | null {
  if (kind) {
    const route = settings.routes[kind];
    if (route) return route.channel;
  }
  const hits = settings.links.filter((l) => within(cwd, l.folder));
  const closest = hits.sort((a, b) => b.folder.length - a.folder.length)[0];
  return closest?.channel ?? settings.channel;
}

// The project a card started in `channel` runs in: the one mapped to it, else the default project.
export function folderFor(settings: SlackSettings, channel: string): string | null {
  return settings.links.find((l) => l.channel === channel)?.folder ?? settings.folder;
}

// Whether anything is set to post at all: a default channel or a mapped one.
export const hasChannel = (settings: SlackSettings) =>
  Boolean(settings.channel) || settings.links.length > 0 || Object.values(settings.routes).some((r) => Boolean(r.channel));
