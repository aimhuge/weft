import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const sessions = new Map<string, { busy: boolean; pending: unknown[] }>();
let max = 2;
let restarting = false;

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(cards.get(id)!, patch),
}));
vi.mock("./runner-state", () => ({ sessions }));
vi.mock("./settings", () => ({ maxThreads: () => max }));
vi.mock("./restart-when-idle", () => ({ restartArmed: () => restarting }));

const { holdForSlot, releaseSlots, runningCount, waitingForSlot } = await import("./thread-slots");

const card = (id: string, over: Partial<Card> = {}) =>
  cards.set(id, { id, title: id, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });
const run = (id: string, over: Partial<{ busy: boolean; pending: unknown[] }> = {}) => sessions.set(id, { busy: true, pending: [], ...over });

beforeEach(() => {
  cards.clear();
  sessions.clear();
  max = 2;
  restarting = false;
});

describe("runningCount", () => {
  it("counts busy sessions, not idle ones, the copilot or threads waiting on you", () => {
    run("a");
    run("b", { busy: false });
    run("c", { pending: [{}] });
    run("copilot");
    expect(runningCount()).toBe(1);
  });

  it("leaves out the card asked about", () => {
    run("a");
    run("b");
    expect(runningCount("a")).toBe(1);
  });
});

describe("holdForSlot", () => {
  it("lets a turn start while there is a free slot", () => {
    card("x");
    run("a");
    expect(holdForSlot("x", "go")).toBe(false);
    expect(cards.get("x")!.scheduled).toBeUndefined();
  });

  it("holds a turn past the cap on its card and says why", () => {
    card("x");
    run("a");
    run("b");
    expect(holdForSlot("x", "go")).toBe(true);
    expect(cards.get("x")!.scheduled).toMatchObject([{ text: "go", forSlot: true }]);
    expect(cards.get("x")!.lastLine).toMatch(/free slot/);
    expect(waitingForSlot("x")).toBe(true);
  });

  it("marks a re-run quiet so release doesn't echo it twice", () => {
    card("x");
    run("a");
    run("b");
    holdForSlot("x", "again", { echo: false });
    expect(cards.get("x")!.scheduled?.[0]?.quiet).toBe(true);
  });

  it("never limits at 0", () => {
    max = 0;
    card("x");
    for (const id of ["a", "b", "c", "d"]) run(id);
    expect(holdForSlot("x", "go")).toBe(false);
  });

  it("leaves a card that is already mid-turn, and the copilot, alone", () => {
    card("x");
    card("copilot", { role: "copilot" });
    run("a");
    run("x");
    expect(holdForSlot("x", "go")).toBe(false);
    expect(holdForSlot("copilot", "go")).toBe(false);
    expect(holdForSlot("missing", "go")).toBe(false);
  });
});

describe("releaseSlots", () => {
  it("sends the oldest waiting message first, only as far as the cap allows", () => {
    card("x", { scheduled: [{ id: "m1", text: "second", at: 20, forSlot: true }] });
    card("y", { scheduled: [{ id: "m2", text: "first", at: 10, forSlot: true }] });
    card("z", { scheduled: [{ id: "m3", text: "third", at: 30, forSlot: true }] });
    run("a");
    const send = vi.fn((id: string) => run(id));
    expect(releaseSlots(send)).toBe(1);
    expect(send).toHaveBeenCalledWith("y", "first", { echo: true });
    expect(cards.get("y")!.scheduled).toBeUndefined();
    expect(cards.get("x")!.scheduled).toHaveLength(1);
  });

  it("sends a quiet one without an echo", () => {
    card("x", { scheduled: [{ id: "m1", text: "again", at: 1, forSlot: true, quiet: true }] });
    const send = vi.fn();
    releaseSlots(send);
    expect(send).toHaveBeenCalledWith("x", "again", { echo: false });
  });

  it("keeps timed and after-turn messages where they are", () => {
    card("x", {
      scheduled: [
        { id: "t", text: "later", at: 5 },
        { id: "m1", text: "held", at: 6, forSlot: true },
      ],
    });
    releaseSlots(vi.fn());
    expect(cards.get("x")!.scheduled).toMatchObject([{ id: "t" }]);
  });

  it("skips a card that is mid-turn and waits out a restart", () => {
    card("x", { scheduled: [{ id: "m1", text: "held", at: 1, forSlot: true }] });
    run("x");
    const send = vi.fn();
    expect(releaseSlots(send)).toBe(0);
    sessions.clear();
    restarting = true;
    expect(releaseSlots(send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("puts a failure on the card instead of throwing", () => {
    card("x", { scheduled: [{ id: "m1", text: "held", at: 1, forSlot: true }] });
    expect(releaseSlots(() => { throw new Error("folder gone"); })).toBe(0);
    expect(cards.get("x")!.error).toMatch(/folder gone/);
  });

  it("puts a failure that isn't an Error on the card too", () => {
    card("x", { scheduled: [{ id: "m1", text: "held", at: 1, forSlot: true }] });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is the branch under test
    expect(releaseSlots(() => { throw "offline"; })).toBe(0);
    expect(cards.get("x")!.error).toMatch(/offline/);
  });

  it("skips a card that was deleted while its message waited", () => {
    card("x", { scheduled: [{ id: "m1", text: "first", at: 1, forSlot: true }] });
    card("y", { scheduled: [{ id: "m2", text: "second", at: 2, forSlot: true }] });
    // The first message goes out, and the card waiting behind it is deleted before its turn comes.
    const send = vi.fn((id: string) => {
      if (id === "x") cards.delete("y");
    });
    expect(() => releaseSlots(send)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves a card with nothing held for a slot out of the queue", () => {
    card("x", { scheduled: [{ id: "t", text: "timed", at: 1 }] });
    card("y", { scheduled: [{ id: "m1", text: "held", at: 2, forSlot: true }] });
    const send = vi.fn();
    expect(releaseSlots(send)).toBe(1);
    expect(send).toHaveBeenCalledExactlyOnceWith("y", "held", { echo: true });
    expect(cards.get("x")!.scheduled).toHaveLength(1);
  });
});
