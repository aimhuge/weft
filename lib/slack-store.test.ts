import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Slack's side of ~/.weft: the drawer's settings and each card's Slack thread. The store's data folder is a fake
// one, so the real ~/.weft is never touched.

let dir: string;
const fake = vi.hoisted(() => ({
  dir: "",
  settings: { channel: null, channelName: null, folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } },
}));

vi.mock("./store", () => ({
  get DATA_DIR() {
    return fake.dir;
  },
}));

const store = await import("./slack-store");

const settingsFile = () => path.join(dir, "slack.json");
const raw = () => JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as { settings: unknown; threads: Record<string, unknown> };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-slack-store-"));
  fake.dir = dir;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("slackSettings", () => {
  it("starts with the defaults when there is no file yet", () => {
    expect(store.slackSettings()).toEqual({
      channel: null,
      channelName: null,
      folder: null,
      links: [],
      events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
      routes: {},
    });
  });

  it("falls back to the defaults when the file is corrupt", () => {
    fs.writeFileSync(settingsFile(), "{ not json");
    expect(store.slackSettings().channel).toBeNull();
    expect(store.slackSettings().events.commits).toBe(true);
  });

  it("falls back to the defaults when the file has no settings in it", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ threads: {} }));
    expect(store.slackSettings().folder).toBeNull();
    expect(store.cardThread("a")).toBeNull();
  });

  it("keeps the threads of a file that has no settings in it", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ threads: { "card-1": { channel: "C1", ts: "1.0" } } }));
    expect(store.cardThread("card-1")).toEqual({ channel: "C1", ts: "1.0" });
  });

  it("has no threads for a file that has none in it", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ settings: fake.settings }));
    expect(store.cardThread("card-1")).toBeNull();
    expect(store.cardOfThread("C1", "1.0")).toBeNull();
  });
});

describe("saveSlackSettings", () => {
  it("saves the channel, its name and the folder", () => {
    const saved = store.saveSlackSettings({ channel: "C1", channelName: "general", folder: "/dev/app" });
    expect(saved).toMatchObject({ channel: "C1", channelName: "general", folder: "/dev/app" });
    expect(store.slackSettings()).toMatchObject({ channel: "C1" });
  });

  it("merges the events one switch at a time", () => {
    store.saveSlackSettings({ events: { commits: false, status: false } });
    const events = store.slackSettings().events;
    expect(events.commits).toBe(false);
    expect(events.status).toBe(false);
    expect(events.pushes).toBe(true);
    expect(events.deploys).toBe(true);
  });

  it("ignores an event that isn't a switch", () => {
    store.saveSlackSettings({ events: { commits: "yes" } as never });
    expect(store.slackSettings().events.commits).toBe(true);
  });

  it("keeps what it had for a setting the patch leaves out", () => {
    store.saveSlackSettings({ channel: "C1", channelName: "general" });
    const saved = store.saveSlackSettings({ channelName: "random" });
    expect(saved.channel).toBe("C1");
    expect(saved.channelName).toBe("random");
  });

  it("clears a setting given as an empty string, and refuses a value of the wrong type", () => {
    store.saveSlackSettings({ channel: "C1" });
    expect(store.saveSlackSettings({ channel: "" }).channel).toBeNull();
    expect(store.saveSlackSettings({ channel: 42 as never }).channel).toBeNull();
  });

  it("writes the file it reads back", () => {
    store.saveSlackSettings({ channel: "C1" });
    expect(raw().settings).toMatchObject({ channel: "C1" });
  });
});

describe("project links", () => {
  it("saves the projects mapped to their channels", () => {
    const saved = store.saveSlackSettings({
      links: [
        { folder: "/dev/app", channel: "C1", channelName: "app" },
        { folder: "/dev/site", channel: "C2", channelName: "site" },
      ],
    });
    expect(saved.links).toEqual([
      { folder: "/dev/app", channel: "C1", channelName: "app" },
      { folder: "/dev/site", channel: "C2", channelName: "site" },
    ]);
    expect(store.slackSettings().links).toHaveLength(2);
  });

  it("drops a row that is only half filled in", () => {
    const saved = store.saveSlackSettings({
      links: [
        { folder: "/dev/app", channel: "C1", channelName: "app" },
        { folder: "/dev/site", channel: "", channelName: "site" },
        { folder: "", channel: "C3", channelName: "other" },
      ],
    });
    expect(saved.links).toEqual([{ folder: "/dev/app", channel: "C1", channelName: "app" }]);
  });

  it("drops a row that is nothing at all", () => {
    const saved = store.saveSlackSettings({
      links: [null, { folder: "/dev/app", channel: "C1", channelName: "app" }, undefined] as never,
    });
    expect(saved.links).toEqual([{ folder: "/dev/app", channel: "C1", channelName: "app" }]);
  });

  it("keeps a later row for the same project instead of the earlier one", () => {
    const saved = store.saveSlackSettings({
      links: [
        { folder: "/dev/app", channel: "C1", channelName: "app" },
        { folder: "/dev/app", channel: "C2", channelName: "app-two" },
      ],
    });
    expect(saved.links).toEqual([{ folder: "/dev/app", channel: "C2", channelName: "app-two" }]);
  });

  it("keeps a later row for the same channel instead of the earlier one", () => {
    const saved = store.saveSlackSettings({
      links: [
        { folder: "/dev/app", channel: "C1", channelName: "app" },
        { folder: "/dev/site", channel: "C1", channelName: "site" },
      ],
    });
    expect(saved.links).toEqual([{ folder: "/dev/site", channel: "C1", channelName: "site" }]);
  });

  it("keeps the links when a patch leaves them out", () => {
    store.saveSlackSettings({ links: [{ folder: "/dev/app", channel: "C1", channelName: "app" }] });
    const saved = store.saveSlackSettings({ channel: "C9" });
    expect(saved.links).toEqual([{ folder: "/dev/app", channel: "C1", channelName: "app" }]);
  });

  it("reads an old file with no links as having none", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ settings: { channel: "C1", channelName: "general", folder: null, events: { commits: true, pushes: true, deploys: true, status: true } }, threads: {} }));
    expect(store.slackSettings().links).toEqual([]);
  });
});

describe("per-kind channels", () => {
  it("saves the channel a kind goes to", () => {
    const saved = store.saveSlackSettings({ routes: { growth: { channel: "C9", channelName: "growth" } } });
    expect(saved.routes.growth).toEqual({ channel: "C9", channelName: "growth" });
    expect(store.slackSettings().routes.growth).toEqual({ channel: "C9", channelName: "growth" });
  });

  it("clears a kind's channel when it is given as null", () => {
    store.saveSlackSettings({ routes: { growth: { channel: "C9", channelName: "growth" } } });
    const saved = store.saveSlackSettings({ routes: { growth: null } });
    expect(saved.routes.growth).toBeUndefined();
  });

  it("keeps the kinds a patch leaves out", () => {
    store.saveSlackSettings({ routes: { growth: { channel: "C9", channelName: null }, deploys: { channel: "C8", channelName: null } } });
    const saved = store.saveSlackSettings({ routes: { deploys: null } });
    expect(saved.routes.growth).toEqual({ channel: "C9", channelName: null });
    expect(saved.routes.deploys).toBeUndefined();
  });

  it("refuses a row with no channel in it", () => {
    const saved = store.saveSlackSettings({ routes: { growth: { channel: "", channelName: "growth" } } });
    expect(saved.routes.growth).toBeUndefined();
  });

  it("reads an old file with no routes as having none", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ settings: fake.settings, threads: {} }));
    expect(store.slackSettings().routes).toEqual({});
  });
});

describe("the growth watermark", () => {
  it("starts empty", () => {
    expect(store.growthWatermark()).toEqual({ at: null });
  });

  it("saves the time it got to, and reads it back", () => {
    store.saveGrowthWatermark({ at: "2026-10-20T10:00:00.000Z" });
    expect(store.growthWatermark().at).toBe("2026-10-20T10:00:00.000Z");
  });

  it("keeps the settings and the threads when it saves", () => {
    store.saveSlackSettings({ channel: "C1" });
    store.saveCardThread("card-1", { channel: "C1", ts: "1.0" });
    store.saveGrowthWatermark({ at: "2026-10-20T10:00:00.000Z" });
    expect(store.slackSettings().channel).toBe("C1");
    expect(store.cardThread("card-1")).toEqual({ channel: "C1", ts: "1.0" });
  });

  it("reads an old file with no watermark as having none", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ settings: fake.settings, threads: {} }));
    expect(store.growthWatermark()).toEqual({ at: null });
  });
});

describe("card threads", () => {
  it("has no thread for a card it never saw", () => {
    expect(store.cardThread("card-1")).toBeNull();
  });

  it("saves a card's thread and reads it back", () => {
    store.saveCardThread("card-1", { channel: "C1", ts: "1.0" });
    expect(store.cardThread("card-1")).toEqual({ channel: "C1", ts: "1.0" });
  });

  it("finds the card a thread belongs to", () => {
    store.saveCardThread("card-1", { channel: "C1", ts: "1.0" });
    store.saveCardThread("card-2", { channel: "C2", ts: "2.0" });
    expect(store.cardOfThread("C2", "2.0")).toBe("card-2");
  });

  it("finds no card for another thread's message or channel", () => {
    store.saveCardThread("card-1", { channel: "C1", ts: "1.0" });
    expect(store.cardOfThread("C1", "9.9")).toBeNull();
    expect(store.cardOfThread("C9", "1.0")).toBeNull();
  });

  it("moves a card's thread to the end when it is saved again", () => {
    store.saveCardThread("card-1", { channel: "C1", ts: "1.0" });
    store.saveCardThread("card-2", { channel: "C2", ts: "2.0" });
    store.saveCardThread("card-1", { channel: "C1", ts: "1.1" });
    expect(Object.keys(raw().threads)).toEqual(["card-2", "card-1"]);
    expect(store.cardThread("card-1")).toEqual({ channel: "C1", ts: "1.1" });
  });

  it("keeps the newest threads when there are more than it should", () => {
    // The file starts full, so one save is enough to show the trim.
    const many: Record<string, { channel: string; ts: string }> = {};
    for (let i = 0; i < store.MAX_THREADS + 10; i++) many[`card-${String(i)}`] = { channel: "C1", ts: String(i) };
    fs.writeFileSync(settingsFile(), JSON.stringify({ settings: fake.settings, threads: many }));
    store.saveCardThread("card-new", { channel: "C1", ts: "new" });
    const threads = raw().threads;
    expect(Object.keys(threads)).toHaveLength(store.MAX_THREADS);
    expect(threads["card-0"]).toBeUndefined();
    expect(threads["card-new"]).toEqual({ channel: "C1", ts: "new" });
  });
});
