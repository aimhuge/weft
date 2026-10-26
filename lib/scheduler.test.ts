import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const busy = new Set<string>();
const sent: Array<[string, string]> = [];
let restartArmed = false;
const prebakeBriefs = vi.fn();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(cards.get(id)!, patch),
}));
vi.mock("./splice", () => ({ prebakeBriefs }));
vi.mock("./restart-when-idle", () => ({ restartArmed: () => restartArmed }));
const freeSlots = vi.fn();
vi.mock("./runner", () => ({
  freeSlots,
  isBusy: (id: string) => busy.has(id),
  sendUserMessage: (id: string, text: string) => {
    if (text === "boom") throw new Error("folder gone");
    sent.push([id, text]);
  },
}));

const { scheduleMessage, sendDueMessages, startScheduler, unscheduleMessage } = await import("./scheduler");

const NOW = Date.now();
const card = (id: string, over: Partial<Card> = {}) =>
  cards.set(id, { id, title: id, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

beforeEach(() => {
  cards.clear();
  busy.clear();
  sent.length = 0;
  restartArmed = false;
});

describe("scheduleMessage", () => {
  it("adds the message, soonest first", () => {
    card("a");
    scheduleMessage("a", "later", NOW + 2000);
    scheduleMessage("a", "sooner", NOW + 1000);
    expect(cards.get("a")!.scheduled!.map((m) => m.text)).toEqual(["sooner", "later"]);
  });

  it("refuses a time already past, the copilot, and unknown cards", () => {
    card("a");
    card("copilot");
    expect(() => scheduleMessage("a", "x", NOW - 1)).toThrow(/passed/);
    expect(() => scheduleMessage("copilot", "x", NOW + 1000)).toThrow(/copilot/);
    expect(() => scheduleMessage("nope", "x", NOW + 1000)).toThrow(/No such card/);
  });

  it("takes one back, clearing the list when it was the last", () => {
    card("a");
    const id = scheduleMessage("a", "x", NOW + 1000).scheduled![0]!.id;
    unscheduleMessage("a", id);
    expect(cards.get("a")!.scheduled).toBeUndefined();
  });
});

describe("sendDueMessages", () => {
  it("frees the threads waiting for a slot first, and leaves their held message out of the timed sends", () => {
    freeSlots.mockClear();
    card("a", { scheduled: [{ id: "h", text: "held", at: NOW - 5, forSlot: true }, { id: "1", text: "timed", at: NOW - 1 }] });
    sendDueMessages(NOW);
    expect(freeSlots).toHaveBeenCalledOnce();
    expect(sent).toEqual([["a", "timed"]]);
    expect(cards.get("a")!.scheduled!.map((m) => m.id)).toEqual(["h"]);
  });

  it("sends what came due, one per card per check, and leaves the rest", () => {
    card("a", { scheduled: [{ id: "1", text: "first", at: NOW - 2 }, { id: "2", text: "second", at: NOW - 1 }, { id: "3", text: "future", at: NOW + 1e6 }] });
    sendDueMessages(NOW);
    expect(sent).toEqual([["a", "first"]]);
    expect(cards.get("a")!.scheduled!.map((m) => m.id)).toEqual(["2", "3"]);
  });

  it("waits while the card is mid-turn", () => {
    card("a", { scheduled: [{ id: "1", text: "hi", at: NOW - 1 }] });
    busy.add("a");
    sendDueMessages(NOW);
    expect(sent).toEqual([]);
    busy.delete("a");
    sendDueMessages(NOW);
    expect(sent).toEqual([["a", "hi"]]);
    expect(cards.get("a")!.scheduled).toBeUndefined();
  });

  it("puts a failed send on the card instead of retrying it forever", () => {
    card("a", { scheduled: [{ id: "1", text: "boom", at: NOW - 1 }] });
    sendDueMessages(NOW);
    expect(cards.get("a")!.error).toMatch(/scheduled message couldn't go: folder gone/);
    expect(cards.get("a")!.scheduled).toBeUndefined();
  });
});

describe("sendDueMessages while a restart is armed", () => {
  it("sends nothing, leaves what's due on the card, and sends it once the restart is cancelled", () => {
    card("a", { scheduled: [{ id: "1", text: "held", at: NOW - 1 }] });
    restartArmed = true;
    sendDueMessages(NOW);
    expect(sent).toEqual([]);
    expect(cards.get("a")!.scheduled!.map((m) => m.id)).toEqual(["1"]);
    restartArmed = false;
    sendDueMessages(NOW);
    expect(sent).toEqual([["a", "held"]]);
  });
});

describe("scheduleMessage and unscheduleMessage edge cases", () => {
  it("asks for a time when it isn't a number", () => {
    card("a");
    expect(() => scheduleMessage("a", "x", NaN)).toThrow(/Pick a time/);
  });

  it("takes one back and keeps the others; refuses an unknown card; tolerates a card with none", () => {
    card("a", { scheduled: [{ id: "1", text: "one", at: NOW + 1 }, { id: "2", text: "two", at: NOW + 2 }] });
    unscheduleMessage("a", "1");
    expect(cards.get("a")!.scheduled!.map((m) => m.id)).toEqual(["2"]);
    expect(() => unscheduleMessage("nope", "1")).toThrow(/No such card/);
    card("b");
    expect(unscheduleMessage("b", "1").scheduled).toBeUndefined();
  });
});

describe("sendDueMessages with a non-Error failure", () => {
  it("still puts it on the card", async () => {
    const runner = await import("./runner");
    const spy = vi.spyOn(runner, "sendUserMessage");
    const notAnError: unknown = "offline";
    spy.mockImplementationOnce(() => {
      throw notAnError;
    });
    card("a", { scheduled: [{ id: "1", text: "hi", at: NOW - 1 }] });
    sendDueMessages(NOW);
    expect(cards.get("a")!.error).toBe("A scheduled message couldn't go: offline");
    spy.mockRestore();
  });
});

describe("startScheduler", () => {
  const g = globalThis as unknown as { __weftScheduleTimer?: ReturnType<typeof setInterval> };
  afterEach(() => {
    clearInterval(g.__weftScheduleTimer);
    delete g.__weftScheduleTimer;
    vi.useRealTimers();
  });

  it("sends what's already due at once, then checks every 15 seconds, and starts only once", () => {
    vi.useFakeTimers({ now: NOW });
    card("a", { scheduled: [{ id: "1", text: "overdue", at: NOW - 1 }, { id: "2", text: "soon", at: NOW + 10_000 }] });
    startScheduler();
    startScheduler();
    expect(sent).toEqual([["a", "overdue"]]);
    vi.advanceTimersByTime(15_000);
    expect(sent).toEqual([["a", "overdue"], ["a", "soon"]]);
    // Each tick also writes the briefs of cards whose cache is about to lapse (lib/splice.ts).
    expect(prebakeBriefs).toHaveBeenCalledTimes(1);
  });
});
