// card.delete on its own (lib/host-api/card-delete.ts): what this Mac's DELETE route and a worker's daemon both run.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));

vi.mock("@/lib/store", () => ({
  getCard: vi.fn((id: string) => db.cards.get(id)),
  deleteCard: vi.fn((id: string) => db.cards.delete(id)),
}));
vi.mock("@/lib/runner", () => ({ endSession: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/settings", () => ({ dismissSession: vi.fn() }));
vi.mock("@/lib/worktree-pool", () => ({ dropWorktree: vi.fn(() => Promise.resolve()) }));

const store = await import("@/lib/store");
const runner = await import("@/lib/runner");
const settings = await import("@/lib/settings");
const pool = await import("@/lib/worktree-pool");
const { deleteCardVerb, COPILOT_UNDELETABLE } = await import("./card-delete");

const add = (over: Partial<Card> = {}) => {
  const card = { id: "c1", title: "T", cwd: "/w", column: "review", ...over } as Card;
  db.cards.set(card.id, card);
  return card;
};

beforeEach(() => {
  db.cards.clear();
  vi.clearAllMocks();
});

describe("deleteCardVerb", () => {
  it("ends the card's CLI, then drops it from the store", async () => {
    add();
    expect(await deleteCardVerb({ id: "c1" })).toEqual({ ok: true });
    expect(runner.endSession).toHaveBeenCalledWith("c1");
    expect(store.deleteCard).toHaveBeenCalledWith("c1");
    expect(settings.dismissSession).not.toHaveBeenCalled();
    expect(pool.dropWorktree).not.toHaveBeenCalled();
  });

  it("refuses the copilot", async () => {
    add({ role: "copilot" });
    await expect(deleteCardVerb({ id: "c1" })).rejects.toThrow(COPILOT_UNDELETABLE);
    expect(store.deleteCard).not.toHaveBeenCalled();
  });

  it("keeps a picked-up Claude Code session dismissed, and drops an isolated card's worktree", async () => {
    const worktree = { path: "/wt", branch: "b" } as Card["worktree"];
    add({ source: "claude-code", sessionId: "s1", worktree });
    await deleteCardVerb({ id: "c1" });
    expect(settings.dismissSession).toHaveBeenCalledWith("s1");
    expect(pool.dropWorktree).toHaveBeenCalledWith(worktree);
  });

  it("ignores a worktree that won't go, and a card that's already gone", async () => {
    vi.mocked(pool.dropWorktree).mockRejectedValueOnce(new Error("busy"));
    add({ worktree: { path: "/wt" } as Card["worktree"] });
    await expect(deleteCardVerb({ id: "c1" })).resolves.toEqual({ ok: true });
    await expect(deleteCardVerb({ id: "gone" })).resolves.toEqual({ ok: true });
  });
});
