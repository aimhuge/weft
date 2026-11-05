import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(cards.get(id)!, patch),
}));

const { addScheduled, hold, holdMessage } = await import("./scheduled-hold");

const card = (id: string, over: Partial<Card> = {}) =>
  cards.set(id, { id, title: id, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

beforeEach(() => cards.clear());

describe("addScheduled", () => {
  it("keeps the soonest first", () => {
    const list = addScheduled([{ id: "b", text: "b", at: 20 }], { id: "a", text: "a", at: 10 });
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("starts a list for a card that has none", () => {
    expect(addScheduled(undefined, { id: "a", text: "a", at: 10 })).toEqual([{ id: "a", text: "a", at: 10 }]);
  });
});

describe("holdMessage", () => {
  it("writes a message with the flag its reason names, due now", () => {
    card("a");
    holdMessage(cards.get("a")!, "go", { reason: "afterTurn" });
    expect(cards.get("a")!.scheduled).toMatchObject([{ text: "go", afterTurn: true }]);
    expect(cards.get("a")!.scheduled![0]!.at).toBeGreaterThan(0);
  });

  it("writes a timed message with no flag and the time it is due", () => {
    card("a");
    holdMessage(cards.get("a")!, "later", { reason: "timed", at: 1234 });
    expect(cards.get("a")!.scheduled).toEqual([expect.objectContaining({ text: "later", at: 1234 })]);
    expect(cards.get("a")!.scheduled![0]).not.toHaveProperty("timed");
  });

  it("gives a message one flag, so 'when does it go' has one answer", () => {
    card("a");
    holdMessage(cards.get("a")!, "go", { reason: "afterRestart" });
    holdMessage(cards.get("a")!, "go", { reason: "forSlot" });
    for (const message of cards.get("a")!.scheduled!) {
      const flags = ["afterRestart", "afterTurn", "forSlot"].filter((f) => (message as unknown as Record<string, unknown>)[f]);
      expect(flags).toHaveLength(1);
    }
  });

  it("marks a quiet message and leaves the card's note alone when there is none", () => {
    card("a");
    holdMessage(cards.get("a")!, "again", { reason: "forSlot", quiet: true });
    expect(cards.get("a")!.scheduled![0]!.quiet).toBe(true);
    expect(cards.get("a")!.lastLine).toBeUndefined();
  });

  it("puts the note on the card when it has one", () => {
    card("a");
    holdMessage(cards.get("a")!, "go", { reason: "forSlot", note: "Waiting for a free slot" });
    expect(cards.get("a")!.lastLine).toBe("Waiting for a free slot");
  });

  it("adds the message to the card's schedule, soonest first", () => {
    card("a", { scheduled: [{ id: "b", text: "b", at: 20 }] });
    holdMessage(cards.get("a")!, "a", { reason: "timed", at: 10 });
    expect(cards.get("a")!.scheduled!.map((m) => m.text)).toEqual(["a", "b"]);
  });
});

describe("hold", () => {
  it("holds a message on a card by id", () => {
    card("a");
    hold("a", "go", { reason: "afterRestart" });
    expect(cards.get("a")!.scheduled).toMatchObject([{ text: "go", afterRestart: true }]);
  });

  it("refuses a card that isn't there", () => {
    expect(() => hold("nope", "go", { reason: "afterRestart" })).toThrow(/No such card/);
  });
});
