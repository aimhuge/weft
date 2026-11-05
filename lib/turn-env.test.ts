import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Partial<Card>>();
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id) }));

const { clock, deskClient, envBlock, ENV_PROMPT, stripEnvBlock, turnEnv } = await import("./turn-env");
const { noteClient, resetTurnClients } = await import("./turn-client");
const { hostTz, resetHostFacts } = await import("./host-facts");
const { extractStatus } = await import("./status");
const { extractReview } = await import("./review");

// 17:23 in Bangkok, 10:23 UTC.
const NOW = new Date("2026-11-02T10:23:00Z");
const MAC = { worker: false, name: "m1mini", os: "macOS (Darwin 25.3.0, arm64)", version: "0.7.0", commit: "abc1234", behind: 3, checkedAt: NOW.getTime() - 60_000 };
const WORKER = { worker: true, name: "mini-1", os: "Linux 6.8.0 (x64)", version: "0.7.0", commit: "abc1234", behind: 0, checkedAt: NOW.getTime() - 25 * 3600_000 };

beforeEach(() => {
  cards.clear();
  resetTurnClients();
  resetHostFacts();
});

describe("clock", () => {
  it("says the day, time, zone and UTC offset", () => {
    expect(clock(NOW, "Asia/Bangkok")).toBe("Mon 2026-11-02 17:23 Asia/Bangkok (UTC+07:00)");
    expect(clock(NOW, "UTC")).toBe("Mon 2026-11-02 10:23 UTC (UTC+00:00)");
    expect(clock(NOW, "America/New_York", { date: false })).toBe("05:23 America/New_York (UTC-05:00)");
  });

  it("falls back to the host's zone for one this runtime doesn't know", () => {
    expect(clock(NOW, "Mars/Olympus_Mons")).toContain(hostTz());
  });
});

describe("envBlock", () => {
  it("on a Mac, from its own board: host, sender and one time for both", () => {
    const block = envBlock({ facts: MAC, client: { app: "desktop", here: true, name: "m1mini" }, now: NOW, hostTz: "Asia/Bangkok" });
    // The count's time is in the host's own zone, whatever the test machine's is.
    const asOf = clock(new Date(MAC.checkedAt), undefined, { date: false }).slice(0, 5);
    expect(block).toBe(
      [
        "<weft-env>",
        `host: your Mac (m1mini), macOS (Darwin 25.3.0, arm64), Weft 0.7.0 @ abc1234, 3 commits behind origin/main as of ${asOf}`,
        "from: the desktop board on this Mac (m1mini)",
        "time: Mon 2026-11-02 17:23 Asia/Bangkok (UTC+07:00) (the user's and the host's)",
        "</weft-env>",
        "",
        "",
      ].join("\n"),
    );
  });

  it("on a worker, from weft.zip: the worker by name, the user's time and the host's", () => {
    const block = envBlock({ facts: WORKER, client: { app: "web" }, now: NOW, userTz: "Asia/Bangkok", hostTz: "UTC" });
    expect(block).toContain("host: Weft Worker mini-1, Linux 6.8.0 (x64), Weft 0.7.0 @ abc1234, up to date with origin/main as of ");
    expect(block).toMatch(/as of \d\d-\d\d \d\d:\d\d\n/);
    expect(block).toContain("from: weft.zip in a browser\n");
    expect(block).toContain("time: user Mon 2026-11-02 17:23 Asia/Bangkok (UTC+07:00); host 10:23 UTC (UTC+00:00)\n");
  });

  it("a worker that hasn't heard the user's zone says so; a count with no time or commit says less", () => {
    const block = envBlock({ facts: { ...WORKER, commit: undefined, behind: 1, checkedAt: undefined }, client: { app: "remote" }, now: NOW, hostTz: "UTC" });
    expect(block).toContain("Weft 0.7.0, 1 commit behind origin/main\n");
    expect(block).toContain("time: host Mon 2026-11-02 10:23 UTC (UTC+00:00); the user's time zone isn't known yet");
    expect(envBlock({ facts: { ...MAC, behind: undefined }, client: { app: "weft" }, now: NOW, hostTz: "UTC" })).toContain("Weft 0.7.0 @ abc1234\n");
  });

  it("is a few hundred bytes", () => {
    const block = envBlock({ facts: WORKER, client: { app: "desktop", name: "Alexs-MacBook-Air", via: "line" }, now: NOW, userTz: "Asia/Bangkok", hostTz: "UTC" });
    expect(Buffer.byteLength(block)).toBeLessThan(400);
  });

  it("is invisible to the BOARD STATUS and review parsers", () => {
    const text = `${envBlock({ facts: MAC, client: { app: "web" }, now: NOW, hostTz: "UTC" })}ship it`;
    expect(extractStatus(text)).toEqual({ text });
    expect(extractReview(text)).toEqual({ text });
  });
});

describe("turnEnv", () => {
  it("takes the card's noted sender, with the user's zone from it", () => {
    cards.set("c1", { id: "c1", turns: 2 });
    noteClient("c1", { app: "web", tz: "Asia/Bangkok" });
    const block = turnEnv("c1", "hello", NOW);
    expect(block).toContain("from: weft.zip in a browser");
    expect(block).toContain("Asia/Bangkok");
    // Taken: the next message is Weft's own.
    expect(turnEnv("c1", "go on", NOW)).toContain("from: Weft itself");
  });

  it("a card's first turn says who made it", () => {
    cards.set("p", { id: "p", title: "Parent card" });
    cards.set("c1", { id: "c1", parentId: "p" });
    cards.set("c2", { id: "c2", parentId: "gone" });
    expect(turnEnv("c1", "do it", NOW)).toContain('from: another card "Parent card" (create_card)');
    expect(turnEnv("c2", "do it", NOW)).toContain("from: another card (create_card)");
    expect(turnEnv("none", "do it", NOW)).toContain("from: Weft itself");
  });

  it("nothing ahead of a /command, and its note doesn't carry over", () => {
    noteClient("c1", { app: "phone" });
    expect(turnEnv("c1", "/weft:done", NOW)).toBe("");
    expect(turnEnv("c1", "next", NOW)).toContain("from: Weft itself");
  });
});

describe("deskClient", () => {
  it("is this Mac's board from its window, else a local process", () => {
    expect(deskClient(true)).toMatchObject({ app: "desktop", here: true, tz: hostTz() });
    expect(deskClient(false)).toEqual({ app: "local" });
  });
});

describe("stripEnvBlock", () => {
  it("takes every block out and leaves other text alone", () => {
    const block = envBlock({ facts: MAC, client: { app: "web" }, now: NOW, hostTz: "UTC" });
    expect(stripEnvBlock(`${block}hello`)).toBe("hello");
    expect(stripEnvBlock(`<system-reminder>x</system-reminder>\n${block}hello`)).toBe("<system-reminder>x</system-reminder>\nhello");
    expect(stripEnvBlock("plain")).toBe("plain");
    // A mention of the tag in prose doesn't swallow what lies between it and a real block.
    expect(stripEnvBlock(`about <weft-env> blocks\n${block}hello`)).toBe("about <weft-env> blocks\nhello");
  });

  it("the thread instructions name the block", () => {
    expect(ENV_PROMPT).toContain("tagged weft-env");
  });
});
