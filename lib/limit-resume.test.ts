// Tests for lib/limit-resume.ts: when the 15-min limit poll sees a window drop from 100% to <100%
// (lib/limit-history.ts recordLimits fires setOnLimitReset), resumeParkedCards replays the last user
// message of every parked card on that backend, the same way switchBackend does for rateLimitHit cards.
// These tests stub the store and the runner; no live sessions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

type StoreHandle = {
  cards: Map<string, Card>;
  threads: Map<string, ThreadItem[]>;
};

const store: StoreHandle = {
  cards: new Map(),
  threads: new Map(),
};

const busyIds = new Set<string>();
const sent: Array<{ id: string; text: string; echo: boolean | undefined }> = [];

vi.mock("./store", () => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => store.cards.get(id),
  getThread: (id: string) => store.threads.get(id) ?? [],
  listCards: () => [...store.cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = store.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  },
}));

vi.mock("./runner", () => ({
  isBusy: vi.fn((id: string) => busyIds.has(id)),
  sendMessage: vi.fn((id: string, text: string, opts?: { echo?: boolean }) => {
    sent.push({ id, text, echo: opts?.echo });
  }),
}));

const { resumeParkedCards, resumeParkedOnModels } = await import("./limit-resume");

function addCard(over: Partial<Card> = {}): Card {
  const id = over.id ?? `card-${store.cards.size + 1}`;
  const card: Card = {
    id,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "default",
    column: "needs_you",
    rateLimitHit: true,
    error: "You hit your limit",
    lastLine: "Claude Code hit its plan limit",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
  store.cards.set(card.id, card);
  return card;
}

function seedThread(id: string, items: ThreadItem[]) {
  store.threads.set(id, items);
}

beforeEach(() => {
  store.cards.clear();
  store.threads.clear();
  busyIds.clear();
  sent.length = 0;
});

describe("resumeParkedCards", () => {
  it("replays the last user message of a parked card on the matching backend", () => {
    const card = addCard();
    seedThread(card.id, [
      { kind: "user", text: "first ask", at: 1 },
      { kind: "assistant", text: "doing it", at: 2 },
      { kind: "user", text: "please continue", at: 3 },
    ]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(1);
    expect(sent).toEqual([{ id: card.id, text: "please continue", echo: false }]);
    expect(store.cards.get(card.id)).toMatchObject({
      rateLimitHit: false,
      error: undefined,
      autoResumedAt: 5000,
      lastLine: "Auto-resumed after 5-hour reset",
    });
  });

  it("leaves a card parked on another CLI's plan alone", () => {
    // Each CLI has its own plan (lib/plan-pools.ts): a puku card is waiting on Puku's allowance, not
    // on Claude Code's 5-hour window, so Claude's reset does not release it.
    const claude = addCard();
    const puku = addCard({ id: "p1", backend: "puku" });
    seedThread(claude.id, [{ kind: "user", text: "ask", at: 1 }]);
    seedThread(puku.id, [{ kind: "user", text: "ask", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(1);
    expect(sent.map((s) => s.id)).toEqual([claude.id]);
    expect(store.cards.get(puku.id)?.rateLimitHit).toBe(true);
    expect(store.cards.get(puku.id)?.autoResumedAt).toBeUndefined();
  });

  it("does not touch cards on another plan", () => {
    const claude = addCard();
    const codex = addCard({ id: "c1", backend: "codex" });
    seedThread(claude.id, [{ kind: "user", text: "ask", at: 1 }]);
    seedThread(codex.id, [{ kind: "user", text: "ask", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(1);
    expect(sent.map((s) => s.id)).toEqual([claude.id]);
    expect(store.cards.get(codex.id)?.rateLimitHit).toBe(true);
    expect(store.cards.get(codex.id)?.autoResumedAt).toBeUndefined();
  });

  it("skips archived cards and leaves them flagged", () => {
    const card = addCard({ archived: true });
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(0);
    expect(sent).toEqual([]);
    expect(store.cards.get(card.id)?.rateLimitHit).toBe(true);
    expect(store.cards.get(card.id)?.autoResumedAt).toBeUndefined();
  });

  it("skips cards that aren't flagged with rateLimitHit", () => {
    const card = addCard({ rateLimitHit: false, error: undefined });
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(0);
    expect(sent).toEqual([]);
  });

  it("skips cards that aren't in Needs you", () => {
    const card = addCard({ column: "running" });
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(0);
    expect(sent).toEqual([]);
  });

  it("skips busy cards (user just started a turn manually) and leaves them flagged", () => {
    const card = addCard();
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    busyIds.add(card.id);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(0);
    expect(sent).toEqual([]);
    expect(store.cards.get(card.id)?.rateLimitHit).toBe(true);
    expect(store.cards.get(card.id)?.autoResumedAt).toBeUndefined();
  });

  it("skips a card whose thread has no user message yet", () => {
    const card = addCard();
    seedThread(card.id, [{ kind: "assistant", text: "system note", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(0);
    expect(sent).toEqual([]);
    expect(store.cards.get(card.id)?.rateLimitHit).toBe(true);
  });

  it("labels the lastLine by window: 'weekly' for the seven-day window", () => {
    const card = addCard();
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    resumeParkedCards("claude", "seven_day", 5000);
    expect(store.cards.get(card.id)?.lastLine).toBe("Auto-resumed after weekly reset");
  });

  it("resumes multiple parked cards on the pool in one call", () => {
    const a = addCard();
    const b = addCard({ id: "b" });
    const c = addCard({ id: "c", backend: "codex" });
    seedThread(a.id, [{ kind: "user", text: "a", at: 1 }]);
    seedThread(b.id, [{ kind: "user", text: "b", at: 1 }]);
    seedThread(c.id, [{ kind: "user", text: "c", at: 1 }]);
    const resumed = resumeParkedCards("claude", "five_hour", 5000);
    expect(resumed).toBe(2);
    expect(sent.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(sent.map((s) => s.text).sort()).toEqual(["a", "b"]);
  });

  it("records why it resumed: a window reset", () => {
    const card = addCard();
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    resumeParkedCards("claude", "five_hour", 5000);
    expect(store.cards.get(card.id)?.autoResumedReason).toBe("reset");
  });
});

describe("resumeParkedOnModels", () => {
  // The upgrade path (lib/limit-upgrade.ts): the user raised their plan, the models that were capped
  // have room again, and the cards parked on those models are free to run.

  it("resumes a parked card on a model that was freed", () => {
    const card = addCard({ model: "claude-opus-5-5" });
    seedThread(card.id, [{ kind: "user", text: "keep going", at: 1 }]);
    const resumed = resumeParkedOnModels(["claude-opus-5-5"], 5000);
    expect(resumed).toBe(1);
    expect(sent).toEqual([{ id: card.id, text: "keep going", echo: false }]);
    expect(store.cards.get(card.id)).toMatchObject({
      rateLimitHit: false,
      autoResumedAt: 5000,
      autoResumedReason: "upgrade",
      lastLine: "Auto-resumed after a plan upgrade",
    });
  });

  it("leaves a card parked on another model alone", () => {
    // A card on Sonnet was never parked by Opus's cap, so the upgrade says nothing about it.
    const opus = addCard({ model: "claude-opus-5-5" });
    const sonnet = addCard({ id: "s1", model: "claude-sonnet-5-5" });
    seedThread(opus.id, [{ kind: "user", text: "ask", at: 1 }]);
    seedThread(sonnet.id, [{ kind: "user", text: "ask", at: 1 }]);
    const resumed = resumeParkedOnModels(["claude-opus-5-5"], 5000);
    expect(resumed).toBe(1);
    expect(sent.map((s) => s.id)).toEqual([opus.id]);
    expect(store.cards.get(sonnet.id)?.rateLimitHit).toBe(true);
  });

  it("resumes a card whose model matches whatever case the store holds", () => {
    const card = addCard({ model: "claude-opus-5-5" });
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    expect(resumeParkedOnModels(["Claude-Opus-5-5"], 5000)).toBe(1);
    expect(sent.map((s) => s.id)).toEqual([card.id]);
  });

  it("does nothing when no model was freed", () => {
    const card = addCard({ model: "claude-opus-5-5" });
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    expect(resumeParkedOnModels([], 5000)).toBe(0);
    expect(sent).toEqual([]);
    expect(store.cards.get(card.id)?.rateLimitHit).toBe(true);
  });

  it("skips busy cards, the same way the reset path does", () => {
    const card = addCard({ model: "claude-opus-5-5" });
    seedThread(card.id, [{ kind: "user", text: "ask", at: 1 }]);
    busyIds.add(card.id);
    expect(resumeParkedOnModels(["claude-opus-5-5"], 5000)).toBe(0);
    expect(sent).toEqual([]);
    expect(store.cards.get(card.id)?.rateLimitHit).toBe(true);
  });
});
