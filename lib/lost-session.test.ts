import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const h = vi.hoisted(() => ({
  cards: new Map<string, Partial<Card>>(),
  thread: [] as ThreadItem[],
  sendFresh: vi.fn(),
}));
vi.mock("./store", () => ({
  getCard: (id: string) => h.cards.get(id),
  getThread: () => h.thread,
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(h.cards.get(id)!, patch),
}));
vi.mock("./splice", () => ({ sendFresh: h.sendFresh }));

import { isLostSessionError, resumeLostSession } from "./lost-session";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  h.cards.clear();
  h.thread.length = 0;
  h.sendFresh.mockResolvedValue(undefined);
});

describe("isLostSessionError", () => {
  it("spots the CLI's missing-session error, wrapped or not", () => {
    expect(isLostSessionError("Claude Code returned an error result: No conversation found with session ID: abc")).toBe(true);
    expect(isLostSessionError("Rate limit reached")).toBe(false);
  });

  it("counts puku's refusal of a transcript past its size cap as lost too", () => {
    const tooLarge = "Failed to resume session: Reconstructed transcript is too large to resume safely (8.8 MiB > 8.0 MiB, 542 messages).";
    expect(isLostSessionError(`Claude Code returned an error result\n${tooLarge}`)).toBe(true);
  });
});

describe("resumeLostSession", () => {
  it("drops the lost id and re-sends the last message fresh, without echoing it", async () => {
    h.cards.set("a", { sessionId: "gone", forkedFrom: "x" });
    h.thread.push({ kind: "user", text: "first", at: 0 }, { kind: "user", text: "last", at: 1 }, { kind: "result", text: "err", isError: true, at: 2 });
    expect(resumeLostSession("a", "gone")).toBe(true);
    expect(h.cards.get("a")).toMatchObject({ sessionId: undefined, forkedFrom: undefined });
    await flush();
    expect(h.sendFresh).toHaveBeenCalledWith("a", "last", { echo: false });
  });

  it("does nothing when the card no longer names that session (the second report) or none was resumed", () => {
    h.cards.set("a", { sessionId: "new" });
    expect(resumeLostSession("a", "gone")).toBe(false);
    expect(resumeLostSession("a", undefined)).toBe(false);
    expect(resumeLostSession("missing", "gone")).toBe(false);
    expect(h.cards.get("a")?.sessionId).toBe("new");
  });

  it("only clears the session when the thread has no message to re-send", async () => {
    h.cards.set("a", { sessionId: "gone" });
    expect(resumeLostSession("a", "gone")).toBe(true);
    await flush();
    expect(h.sendFresh).not.toHaveBeenCalled();
  });

  it("keeps a failed fresh start on the card as its error", async () => {
    h.cards.set("a", { sessionId: "gone" });
    h.thread.push({ kind: "user", text: "go", at: 0 });
    h.sendFresh.mockRejectedValueOnce(new Error("This thread is already running."));
    resumeLostSession("a", "gone");
    await flush();
    expect(h.cards.get("a")?.error).toBe("This thread is already running.");
    h.sendFresh.mockRejectedValueOnce("plain");
    h.cards.get("a")!.sessionId = "gone";
    resumeLostSession("a", "gone");
    await flush();
    expect(h.cards.get("a")?.error).toBe("plain");
  });
});
