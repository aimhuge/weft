import { describe, expect, it } from "vitest";

// Where an update goes and which project a channel runs in (lib/slack-route.ts): a kind with a channel of its
// own goes there, a mapped project's updates go to its own channel, and a card started there runs in it.
// Everything else falls back to the drawer's default.

import { channelFor, folderFor, hasChannel } from "./slack-route";
import type { SlackLink, SlackSettings } from "./slack-types";

const settings = (over: Partial<SlackSettings> = {}): SlackSettings => ({
  channel: "C1",
  channelName: "general",
  folder: "/dev/default",
  links: [],
  events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
  routes: {},
  ...over,
});

const link = (folder: string, channel: string): SlackLink => ({ folder, channel, channelName: null });

describe("channelFor", () => {
  it("gives a project its own channel", () => {
    const s = settings({ links: [link("/dev/app", "C7")] });
    expect(channelFor(s, "/dev/app")).toBe("C7");
  });

  it("gives a folder inside a mapped project that project's channel", () => {
    const s = settings({ links: [link("/dev/app", "C7")] });
    expect(channelFor(s, "/dev/app/site")).toBe("C7");
  });

  it("gives the closest of two nested projects its own channel", () => {
    const s = settings({ links: [link("/dev/app", "C7"), link("/dev/app/site", "C8")] });
    expect(channelFor(s, "/dev/app/site/pages")).toBe("C8");
    expect(channelFor(s, "/dev/app/other")).toBe("C7");
  });

  it("falls back to the default channel for a project of its own", () => {
    const s = settings({ links: [link("/dev/app", "C7")] });
    expect(channelFor(s, "/dev/other")).toBe("C1");
  });

  it("gives nothing when there is neither a mapped nor a default channel", () => {
    const s = settings({ channel: null, links: [] });
    expect(channelFor(s, "/dev/app")).toBeNull();
  });

  it("does not take a look-alike sibling for a mapped project", () => {
    const s = settings({ links: [link("/dev/app", "C7")] });
    expect(channelFor(s, "/dev/app2")).toBe("C1");
  });

  it("matches a link folder that ends in a slash", () => {
    const s = settings({ links: [link("/dev/app/", "C7")] });
    expect(channelFor(s, "/dev/app/site")).toBe("C7");
    expect(channelFor(s, "/dev/app")).toBe("C7");
  });

  it("gives a kind its own channel when it has one", () => {
    const s = settings({ routes: { growth: { channel: "C9", channelName: "growth" } } });
    expect(channelFor(s, "/dev/app", "growth")).toBe("C9");
  });

  it("gives that channel to every project, not just the mapped one", () => {
    const s = settings({ links: [link("/dev/app", "C7")], routes: { deploys: { channel: "C9", channelName: null } } });
    expect(channelFor(s, "/dev/app", "deploys")).toBe("C9");
    expect(channelFor(s, "/dev/other", "deploys")).toBe("C9");
  });

  it("keeps the project's own channel for the kinds with no channel of their own", () => {
    const s = settings({ links: [link("/dev/app", "C7")], routes: { growth: { channel: "C9", channelName: null } } });
    expect(channelFor(s, "/dev/app", "commits")).toBe("C7");
    expect(channelFor(s, "/dev/app", "status")).toBe("C7");
  });

  it("falls back to the default channel for a kind with no channel of its own", () => {
    const s = settings({ routes: { growth: { channel: "C9", channelName: null } } });
    expect(channelFor(s, "/dev/other", "commits")).toBe("C1");
  });
});

describe("folderFor", () => {
  it("gives the project mapped to a channel", () => {
    const s = settings({ links: [link("/dev/app", "C7")] });
    expect(folderFor(s, "C7")).toBe("/dev/app");
  });

  it("falls back to the default project for a channel of its own", () => {
    const s = settings({ links: [link("/dev/app", "C7")] });
    expect(folderFor(s, "C1")).toBe("/dev/default");
  });

  it("gives nothing when there is neither a mapped nor a default project", () => {
    const s = settings({ folder: null });
    expect(folderFor(s, "C1")).toBeNull();
  });
});

describe("hasChannel", () => {
  it("is true with a default channel", () => {
    expect(hasChannel(settings())).toBe(true);
  });

  it("is true with only a mapped channel", () => {
    expect(hasChannel(settings({ channel: null, links: [link("/dev/app", "C7")] }))).toBe(true);
  });

  it("is true with only a kind's own channel", () => {
    expect(hasChannel(settings({ channel: null, links: [], routes: { growth: { channel: "C9", channelName: null } } }))).toBe(true);
  });

  it("is false with neither", () => {
    expect(hasChannel(settings({ channel: null, links: [] }))).toBe(false);
  });
});
