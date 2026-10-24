import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const h = vi.hoisted(() => ({
  cards: new Map<string, Card>(),
  thread: [] as ThreadItem[],
  busy: new Set<string>(),
  order: [] as string[],
  session: { preamble: undefined as string | undefined },
  open: vi.fn(),
  endSession: vi.fn(),
  sendUserMessage: vi.fn(),
  sendMessage: vi.fn(),
  briefFor: vi.fn(),
  prebakeBrief: vi.fn(),
}));
vi.mock("./store", () => ({
  getCard: (id: string) => h.cards.get(id),
  listCards: () => [...h.cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(h.cards.get(id)!, patch),
  appendThread: (_id: string, item: ThreadItem) => h.thread.push(item),
}));
vi.mock("./runner", () => ({ endSession: h.endSession, isBusy: (id: string) => h.busy.has(id), sendMessage: h.sendMessage, sendUserMessage: h.sendUserMessage }));
vi.mock("./runner-session", () => ({ open: h.open }));
vi.mock("./runner-state", () => ({ specFor: (card: Card) => ({ cwd: card.cwd, sessionId: card.sessionId }) }));
vi.mock("./splice-brief", () => ({ briefFor: h.briefFor, prebakeBrief: h.prebakeBrief }));

import { prebakeBriefs, sendFresh } from "./splice";

const NOW = 1_000_000_000;
const cache = { at: NOW - 3600_000, ttl: 300, hit: 90, tokens: 83_000 };
const card = (id: string, over: Partial<Card> = {}) =>
  h.cards.set(id, { id, title: id, prompt: "", cwd: "/p", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, sessionId: "old", stats: { cache }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.cards.clear();
  h.thread.length = 0;
  h.busy.clear();
  h.session.preamble = undefined;
  h.open.mockImplementation(() => h.session);
  h.briefFor.mockResolvedValue("BRIEF ");
  h.prebakeBrief.mockResolvedValue(undefined);
});

describe("sendFresh", () => {
  it("closes the old session, marks the splice, and sends the message to a new one behind the brief", async () => {
    card("a");
    h.session.preamble = "PUKU ";
    await sendFresh("a", "commit this");
    expect(h.endSession).toHaveBeenCalledWith("a");
    expect(h.cards.get("a")).toMatchObject({ sessionId: undefined, stats: { cache: undefined } });
    expect(h.thread).toEqual([{ kind: "spliced", at: expect.any(Number) as unknown, brief: "BRIEF ", tokens: 83_000 }]);
    expect(h.open).toHaveBeenCalledWith({ cwd: "/p", sessionId: undefined }, "a");
    expect(h.session.preamble).toBe("PUKU BRIEF ");
    expect(h.sendUserMessage).toHaveBeenCalledWith("a", "commit this");
  });

  it("re-sends a message the thread already shows without a second user row", async () => {
    card("a");
    await sendFresh("a", "again", { echo: false });
    expect(h.sendMessage).toHaveBeenCalledWith("a", "again", { echo: false });
    expect(h.sendUserMessage).not.toHaveBeenCalled();
  });

  it("leaves the token count out when the card had no cache", async () => {
    card("a", { stats: undefined });
    await sendFresh("a", "go");
    expect(h.thread[0]).not.toHaveProperty("tokens");
  });

  it("refuses an unknown card, a Codex one, a busy one and an empty message", async () => {
    await expect(sendFresh("x", "go")).rejects.toThrow("No such card.");
    card("c", { backend: "codex" });
    await expect(sendFresh("c", "go")).rejects.toThrow(/Codex/);
    card("b");
    h.busy.add("b");
    await expect(sendFresh("b", "go")).rejects.toThrow("already running");
    card("e");
    await expect(sendFresh("e", "  ")).rejects.toThrow("Write a message first.");
    expect(h.endSession).not.toHaveBeenCalled();
  });
});

describe("prebakeBriefs", () => {
  it("bakes idle, big cards whose cache lapses within 5 minutes or did in the last few hours", () => {
    card("soon", { stats: { cache: { ...cache, at: NOW - 200_000 } } });
    card("lapsed", { stats: { cache: { ...cache, at: NOW - 3600_000 } } });
    card("warm", { stats: { cache: { ...cache, at: NOW, ttl: 3600 } } });
    card("ancient", { stats: { cache: { ...cache, at: NOW - 86_400_000 } } });
    card("small", { stats: { cache: { ...cache, tokens: 1000 } } });
    card("none", { stats: undefined });
    card("codex", { backend: "codex" });
    card("archived", { archived: true });
    card("done", { column: "done" });
    card("busy");
    h.busy.add("busy");
    h.prebakeBrief.mockRejectedValueOnce(new Error("ignored"));
    prebakeBriefs(NOW);
    expect(h.prebakeBrief.mock.calls.map((call) => (call[0] as string))).toEqual(["soon", "lapsed"]);
  });
});
