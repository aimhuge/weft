import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const updateCard = vi.fn();
let cards: Card[] = [];
vi.mock("./store", () => ({ listCards: () => cards, updateCard }));

const { pruneYields, yieldHolds } = await import("./yields");

function card(over: Partial<Card> = {}): Card {
  return { id: "a", title: "A", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

beforeEach(() => updateCard.mockClear());

describe("yieldHolds", () => {
  const y = { to: "a", file: "/repo/x.ts" };

  it("holds while the card it yields to is busy and claims the file", () => {
    expect(yieldHolds([card({ claims: ["/repo/x.ts#*"] })], y)).toBe(true);
  });

  it("ends when that card is gone, archived, idle, or let go of the file", () => {
    expect(yieldHolds([], y)).toBe(false);
    expect(yieldHolds([card({ claims: ["/repo/x.ts#*"], archived: true })], y)).toBe(false);
    expect(yieldHolds([card({ claims: ["/repo/x.ts#*"], column: "review" })], y)).toBe(false);
    expect(yieldHolds([card({ claims: ["/repo/y.ts#*"] })], y)).toBe(false);
    expect(yieldHolds([card()], y)).toBe(false);
  });
});

describe("pruneYields", () => {
  it("drops the yields that ended and leaves the rest alone", () => {
    const first = card({ claims: ["/repo/x.ts#f"] });
    const both = card({ id: "b", yields: [{ to: "a", file: "/repo/x.ts" }, { to: "a", file: "/repo/y.ts" }] });
    const ended = card({ id: "c", yields: [{ to: "gone", file: "/repo/x.ts" }] });
    const fine = card({ id: "d", yields: [{ to: "a", file: "/repo/x.ts" }] });
    cards = [first, both, ended, fine, card({ id: "e", yields: [] })];
    pruneYields();
    expect(updateCard).toHaveBeenCalledTimes(2);
    expect(updateCard).toHaveBeenCalledWith("b", { yields: [{ to: "a", file: "/repo/x.ts" }] });
    expect(updateCard).toHaveBeenCalledWith("c", { yields: undefined });
  });
});
