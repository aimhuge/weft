import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const h = vi.hoisted(() => ({ cards: new Map<string, Partial<Card>>(), take: vi.fn() }));
vi.mock("./store", () => ({
  getCard: (id: string) => h.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => h.cards.set(id, { ...h.cards.get(id), ...patch }),
}));
vi.mock("./worktree-pool", () => ({ takeWorktree: h.take }));

const { isolate } = await import("./worktree-start");
const worktree = { path: "/w", branch: "weft/a", base: "b", repo: "/r" };

beforeEach(() => {
  h.cards.clear();
  h.take.mockReset().mockResolvedValue(worktree);
});

describe("isolate", () => {
  it("takes the worktree once for every message waiting on it, then sends them", async () => {
    h.cards.set("c1", { id: "c1", isolated: true });
    const sent: string[] = [];
    await Promise.all([isolate("c1", () => sent.push("a")), isolate("c1", () => sent.push("b"))]);
    expect(h.take).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(["a", "b"]);
    expect(h.cards.get("c1")).toMatchObject({ worktree, column: "running" });
  });

  it("sends straight away for a card that already has one, and not at all for a deleted card", async () => {
    h.cards.set("c1", { id: "c1", isolated: true, worktree });
    const then = vi.fn();
    await isolate("c1", then);
    await isolate("gone", then);
    expect(then).toHaveBeenCalledTimes(1);
    expect(h.take).not.toHaveBeenCalled();
  });

  it("keeps a send that fails on the card as its error", async () => {
    h.cards.set("c1", { id: "c1", isolated: true });
    await isolate("c1", () => {
      throw new Error("This thread is already running.");
    });
    expect(h.cards.get("c1")!.error).toBe("This thread is already running.");
    h.take.mockRejectedValue("boom");
    h.cards.set("c2", { id: "c2", isolated: true });
    await isolate("c2", () => undefined);
    expect(h.cards.get("c2")!.error).toContain("boom");
  });
});
