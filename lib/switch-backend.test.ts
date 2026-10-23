// Pure unit tests for lib/runner.ts's switchBackend. These tests stub only what switchBackend
// touches directly (the store) and inject the global session map that isBusy reads from.
// They run without the SDK harness (lib/runner.harness) that lib/runner.test.ts depends on —
// each test stands alone. The busy-card path needs a session pre-injected; everything else
// is just store reads/writes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

type StoreHandle = {
  cards: Map<string, Card>;
  threads: Map<string, ThreadItem[]>;
  updateCalls: Array<{ id: string; patch: Partial<Card> }>;
};

const store: StoreHandle = {
  cards: new Map(),
  threads: new Map(),
  updateCalls: [],
};

vi.mock("./store", () => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => store.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => {
    store.updateCalls.push({ id, patch });
    const card = store.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  },
  getThread: (id: string) => store.threads.get(id) ?? [],
}));

vi.mock("./runner", () => ({
  isBusy: vi.fn((id: string) => busyIds.has(id)),
  endSession: vi.fn(),
  sendMessage: vi.fn(),
  setModel: vi.fn((id: string, model: string) => Object.assign(store.cards.get(id)!, { model })),
}));

const busyIds = new Set<string>();
const runner = await import("./runner");
const { switchBackend, rerunOnModel } = await import("./backend-switch");

function addCard(over: Partial<Card> = {}): Card {
  const id = `card-${store.cards.size + 1}`;
  const card: Card = {
    id,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "auto",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
  store.cards.set(id, card);
  return card;
}

beforeEach(() => {
  store.cards.clear();
  store.threads.clear();
  store.updateCalls.length = 0;
  busyIds.clear();
  vi.clearAllMocks();
  vi.mocked(runner.isBusy).mockImplementation((id: string) => busyIds.has(id));
});

describe("switchBackend", () => {
  it("flips a claude card to puku, clearing sessionId and rateLimitHit", async () => {
    const card = addCard({ backend: "claude", sessionId: "old", rateLimitHit: true });
    await switchBackend(card.id, "puku");
    const after = store.cards.get(card.id)!;
    expect(after.backend).toBe("puku");
    expect(after.sessionId).toBeUndefined();
    expect(after.rateLimitHit).toBe(false);
  });

  it("drops the old CLI's session numbers and keeps the folder's", async () => {
    const card = addCard({
      backend: "claude",
      stats: {
        model: "claude-opus-5-5", runsOn: { model: "claude-opus-5-5" }, contextUsed: 40, tokens: 9000,
        cache: { at: 1, ttl: 300, tokens: 9000, hit: 90 }, fiveHour: { used: 100, resetsAt: 5 }, sevenDay: { used: 14 },
        branch: "main", added: 3, removed: 1,
      },
    });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.stats).toEqual({ branch: "main", added: 3, removed: 1 });
    const bare = addCard({ backend: "claude" });
    await switchBackend(bare.id, "puku");
    expect(store.cards.get(bare.id)!.stats).toEqual({});
  });

  it("is a no-op when the target is the same as the card's current backend", async () => {
    const card = addCard({ backend: "puku" });
    await switchBackend(card.id, "puku");
    expect(runner.endSession).not.toHaveBeenCalled();
    expect(store.updateCalls.length).toBe(0);
  });

  it("drops a Claude model on a switch to puku, so puku's own choice stands", async () => {
    const card = addCard({ backend: "claude", model: "claude-fable-5-1" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.model).toBeUndefined();
  });

  it("takes the picked model with the switch", async () => {
    const card = addCard({ backend: "claude", model: "claude-fable-5-1" });
    await switchBackend(card.id, "puku", { model: "puku-ai-2.7" });
    expect(store.cards.get(card.id)!.model).toBe("puku-ai-2.7");
  });

  it("a model from another CLI moves the card to the CLI that serves it", async () => {
    const card = addCard({ backend: "claude", model: "claude-fable-5-1" });
    await switchBackend(card.id, "puku", { model: "puku-ai-2.8" });
    const after = store.cards.get(card.id)!;
    expect(after.backend).toBe("puku");
    expect(after.model).toBe("puku-ai-2.8");
  });

  it("leaves a card with no model on the new CLI's own default", async () => {
    const card = addCard({ backend: "claude" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.model).toBeUndefined();
  });

  it("on the same CLI, only changes the model, busy or not", async () => {
    const card = addCard({ backend: "puku", model: "opus-4.8" });
    busyIds.add(card.id);
    await switchBackend(card.id, "puku", { model: "puku-ai-2.8" });
    expect(runner.setModel).toHaveBeenCalledWith(card.id, "puku-ai-2.8");
    expect(runner.endSession).not.toHaveBeenCalled();
    await switchBackend(card.id, "puku", { model: "puku-ai-2.8" });
    expect(runner.setModel).toHaveBeenCalledTimes(1);
  });

  it("refuses to switch a busy card", async () => {
    const card = addCard({ backend: "claude" });
    busyIds.add(card.id);
    await expect(switchBackend(card.id, "puku")).rejects.toThrow(/Stop the thread/);
    expect(runner.endSession).not.toHaveBeenCalled();
  });

  it("throws when the card does not exist", async () => {
    await expect(switchBackend("missing", "puku")).rejects.toThrow(/No such card/);
  });

  it("downgrades YOLO when switching to puku (puku-cli has no YOLO)", async () => {
    const card = addCard({ backend: "claude", permissionMode: "bypassPermissions" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.permissionMode).toBe("auto");
  });

  it("drops xhigh effort on a switch to puku (puku-cli only takes low/medium/high/max)", async () => {
    const card = addCard({ backend: "claude", effort: "xhigh" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.effort).toBe("high");
  });

  it("keeps max on a switch to puku (puku-cli accepts max)", async () => {
    const card = addCard({ backend: "claude", effort: "max" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.effort).toBe("max");
  });

  it("keeps the same effort on a switch to claude, including a value puku wouldn't take", async () => {
    // Simulates a card that was already on puku with effort dropped to high; switching back to
    // claude must not invent xhigh. (The picker is symmetric; xhigh stays xhigh if it was.)
    const card = addCard({ backend: "puku", effort: "high" });
    await switchBackend(card.id, "claude");
    expect(store.cards.get(card.id)!.effort).toBe("high");
  });

  it("keeps YOLO when switching between claude backends (claude→claude is a no-op, puku→claude is the only direction it stays)", async () => {
    const card = addCard({ backend: "puku", permissionMode: "auto" });
    await switchBackend(card.id, "claude");
    expect(store.cards.get(card.id)!.permissionMode).toBe("auto");
  });

  it("with replay=true, re-sends the last user message after the switch", async () => {
    const card = addCard({ backend: "claude" });
    store.threads.set(card.id, [
      { kind: "user", text: "first", at: 1 },
      { kind: "result", text: "ok", isError: false, at: 2 },
      { kind: "user", text: "retry me", at: 3 },
    ]);
    await switchBackend(card.id, "puku", { replay: true });
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "retry me", { echo: false });
  });

  it("with replay=false, does not send any message", async () => {
    const card = addCard({ backend: "claude" });
    store.threads.set(card.id, [{ kind: "user", text: "hi", at: 1 }]);
    await switchBackend(card.id, "puku", { replay: false });
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });
});

describe("rerunOnModel", () => {
  it("reruns the last user message on a different model in the same CLI", async () => {
    const card = addCard({ backend: "claude", model: "claude-opus-5-5", sessionId: "old", error: "rate limit", rateLimitHit: true });
    store.threads.set(card.id, [
      { kind: "user", text: "first prompt", at: 1 },
      { kind: "result", text: "rate limit", isError: true, at: 2 },
    ]);
    await rerunOnModel(card.id, "claude-sonnet-5-5");
    const after = store.cards.get(card.id)!;
    expect(after.model).toBe("claude-sonnet-5-5");
    expect(after.sessionId).toBeUndefined();
    expect(after.error).toBeUndefined();
    expect(after.rateLimitHit).toBe(false);
    expect(runner.endSession).toHaveBeenCalledWith(card.id);
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "first prompt", { echo: false });
  });

  it("moves a puku card to the CLI that serves the model it was asked for", async () => {
    // Every model is offered now, and a model from another CLI moves the card there: one pick,
    // one thread, and the CLI and the model always agree.
    const card = addCard({ backend: "puku" });
    await rerunOnModel(card.id, "claude-sonnet-5-5");
    const after = store.cards.get(card.id)!;
    expect(after.backend).toBe("claude");
    expect(after.model).toBe("claude-sonnet-5-5");
  });

  it("keeps the same model, still clears error and rateLimitHit, and re-sends", async () => {
    const card = addCard({ backend: "claude", model: "claude-sonnet-5-5", error: "boom", rateLimitHit: true });
    store.threads.set(card.id, [{ kind: "user", text: "hi", at: 1 }]);
    await rerunOnModel(card.id, "claude-sonnet-5-5");
    const after = store.cards.get(card.id)!;
    expect(after.model).toBe("claude-sonnet-5-5");
    expect(after.error).toBeUndefined();
    expect(after.rateLimitHit).toBe(false);
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "hi", { echo: false });
  });

  it("refuses to rerun a busy card", async () => {
    const card = addCard({ backend: "claude" });
    busyIds.add(card.id);
    await expect(rerunOnModel(card.id, "claude-sonnet-5-5")).rejects.toThrow(/Stop the thread/);
    expect(runner.endSession).not.toHaveBeenCalled();
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("throws when the card does not exist", async () => {
    await expect(rerunOnModel("missing", "claude-sonnet-5-5")).rejects.toThrow(/No such card/);
  });

  it("does nothing if the thread has no user message yet", async () => {
    const card = addCard({ backend: "claude", model: "claude-opus-5-5" });
    store.threads.set(card.id, []);
    await rerunOnModel(card.id, "claude-sonnet-5-5");
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("sends the most recent user message, not the first", async () => {
    const card = addCard({ backend: "claude", model: "claude-opus-5-5" });
    store.threads.set(card.id, [
      { kind: "user", text: "first", at: 1 },
      { kind: "result", text: "rate limit", isError: true, at: 2 },
      { kind: "user", text: "second", at: 3 },
    ]);
    await rerunOnModel(card.id, "claude-sonnet-5-5");
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "second", { echo: false });
  });
});