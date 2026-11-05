import { beforeEach, describe, expect, it } from "vitest";
import { asTurnClient, commandClient, describeClient, impliedClient, lastUserTz, noteClient, resetTurnClients, takeClient } from "./turn-client";

beforeEach(resetTurnClients);

describe("noteClient / takeClient", () => {
  it("holds a card's next sender until the runner takes it, once", () => {
    noteClient("c1", { app: "web", tz: "Asia/Bangkok" });
    noteClient("c2", undefined);
    expect(takeClient("c2")).toBeUndefined();
    expect(takeClient("c1")).toEqual({ app: "web", tz: "Asia/Bangkok" });
    expect(takeClient("c1")).toBeUndefined();
  });

  it("remembers the user's time zone from the last client that gave a real one", () => {
    expect(lastUserTz()).toBeUndefined();
    noteClient("c1", { app: "phone", tz: "Europe/Berlin" });
    noteClient("c2", { app: "web", tz: "<bad>" });
    noteClient("c3", { app: "cron" });
    expect(lastUserTz()).toBe("Europe/Berlin");
  });
});

describe("commandClient", () => {
  it("is the row's hint, or 'remote' for a row that gives none", () => {
    expect(commandClient({ text: "hi", client: { app: "web", tz: "UTC" } })).toEqual({ app: "web", tz: "UTC" });
    expect(commandClient({ text: "hi", client: { app: "desktop", name: "Mac", via: "line" } })).toEqual({ app: "desktop", name: "Mac", via: "line" });
    expect(commandClient({ text: "hi" })).toEqual({ app: "remote" });
    expect(commandClient({ client: { app: "cron" } })).toEqual({ app: "remote" });
    expect(commandClient(null)).toEqual({ app: "remote" });
  });
});

describe("asTurnClient", () => {
  it("checks a body's client like the rest of the body", () => {
    expect(asTurnClient({ app: "desktop", here: true, name: "m1", tz: "Asia/Bangkok" })).toEqual({ app: "desktop", here: true, name: "m1", tz: "Asia/Bangkok" });
    expect(asTurnClient({ app: "webhook", name: "Slack", here: "yes" })).toEqual({ app: "webhook", name: "Slack" });
    expect(asTurnClient({ app: "root" })).toBeUndefined();
    expect(asTurnClient({ app: 3 })).toBeUndefined();
    expect(asTurnClient("desktop")).toBeUndefined();
    expect(asTurnClient(undefined)).toBeUndefined();
  });
});

describe("impliedClient", () => {
  it("a first turn says who made the card; anything else is Weft's own", () => {
    expect(impliedClient({ cronId: "k", cronRun: 4 })).toEqual({ app: "cron", name: "run 4" });
    expect(impliedClient({ cronId: "k" })).toEqual({ app: "cron" });
    expect(impliedClient({ parentId: "p" }, "Fix login")).toEqual({ app: "card", name: "Fix login" });
    expect(impliedClient({ parentId: "p" })).toEqual({ app: "card" });
    expect(impliedClient({ parentId: "p", turns: 2 })).toEqual({ app: "weft" });
    expect(impliedClient({ cronId: "k", turns: 1 })).toEqual({ app: "weft" });
    expect(impliedClient(undefined)).toEqual({ app: "weft" });
  });
});

describe("describeClient", () => {
  it("says each sender in a few words", () => {
    expect(describeClient({ app: "desktop", here: true, name: "m1" })).toBe("the desktop board on this Mac (m1)");
    expect(describeClient({ app: "desktop", here: true })).toBe("the desktop board on this Mac");
    expect(describeClient({ app: "desktop", name: "m1", via: "line" })).toBe("the desktop board on Mac m1 over the session line");
    expect(describeClient({ app: "desktop", via: "relay" })).toBe("the desktop board over the relay");
    expect(describeClient({ app: "web" })).toBe("weft.zip in a browser");
    expect(describeClient({ app: "phone" })).toBe("the Weft phone app");
    expect(describeClient({ app: "remote" })).toBe("a remote board (weft.zip or the phone app; it didn't say which)");
    expect(describeClient({ app: "local" })).toContain("a local process on this Mac");
    expect(describeClient({ app: "cron", name: "run 2" })).toBe("a cron (run 2)");
    expect(describeClient({ app: "cron" })).toBe("a cron");
    expect(describeClient({ app: "card", name: 'Fix "<login>"' })).toBe('another card "Fix login" (create_card)');
    expect(describeClient({ app: "card" })).toBe("another card (create_card)");
    expect(describeClient({ app: "webhook", name: "Slack" })).toBe("a webhook (Slack)");
    expect(describeClient({ app: "webhook" })).toBe("a webhook");
    expect(describeClient({ app: "scheduled" })).toBe("a message the user scheduled (Send later)");
    expect(describeClient({ app: "weft" })).toBe("Weft itself (a queued, resumed or automatic message)");
  });
});
