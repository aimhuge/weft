import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// The one claim flow (lib/claim-hooks.ts), shared by the edit guard (lib/claim-guard.ts) and the Bash
// guard (lib/bash-claims.ts): read the card, work out its claims, look for a clash, and ask.

const cards = new Map<string, Card>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = { ...cards.get(id)!, ...patch };
    cards.set(id, card);
    return card;
  }),
}));

const { claimPreAnswer, claimPreHook, claimPostCard, claimQuestion, claimWhy, forget, pendingEntry, remember } = await import("./claim-hooks");

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

beforeEach(() => {
  cards.clear();
  vi.clearAllMocks();
});

describe("claimPreHook", () => {
  it("finds the clash another busy card holds and the question to ask about it", async () => {
    cards.set("me", card("me"));
    cards.set("other", card("other", { title: "Fix login", claims: ["/repo/a.ts#one"] }));
    const out = await claimPreHook("me", () => ["/repo/a.ts#one"]);
    expect(out.card?.id).toBe("me");
    expect(out.keys).toEqual(["/repo/a.ts#one"]);
    expect(out.question).toBe("Card ‘Fix login’ is editing one in a.ts. Wait, or go ahead?");
    expect(out.why).toMatchObject({ category: "same-code" });
  });

  it("has no card when the session's card is gone, and asks for no keys", async () => {
    const keysFor = vi.fn(() => ["/repo/a.ts#one"]);
    expect(await claimPreHook("nobody", keysFor)).toEqual({ keys: [] });
    expect(keysFor).not.toHaveBeenCalled();
    expect(await claimPreHook(undefined, keysFor)).toEqual({ keys: [] });
  });

  it("has no clash when the tool claims nothing", async () => {
    cards.set("me", card("me"));
    const out = await claimPreHook("me", () => []);
    expect(out.card?.id).toBe("me");
    expect(out.keys).toEqual([]);
    expect(out.question).toBeUndefined();
  });

  it("waits for the keys when they are worked out asynchronously", async () => {
    cards.set("me", card("me"));
    const out = await claimPreHook("me", () => Promise.resolve(["/repo/a.ts#one"]));
    expect(out.keys).toEqual(["/repo/a.ts#one"]);
  });
});

describe("claimPreAnswer", () => {
  it("asks the question and remembers it with its reason", async () => {
    cards.set("me", card("me"));
    cards.set("other", card("other", { title: "Fix login", claims: ["/repo/a.ts#one"] }));
    const out = await claimPreHook("me", () => ["/repo/a.ts#one"]);
    const answer = claimPreAnswer(out, "ask1");
    expect(answer).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: out.question } });
    expect(claimQuestion("ask1")).toBe(out.question);
    expect(claimWhy("ask1")).toMatchObject({ category: "same-code" });
  });

  it("remembers no keys when it is given none, so the prompt has no symbol preview", async () => {
    cards.set("me", card("me"));
    const out = await claimPreHook("me", () => ["/repo/a.ts#*"]);
    claimPreAnswer(out, "ask2", []);
    expect(pendingEntry("ask2")?.keys).toEqual([]);
    expect(claimQuestion("ask2")).toBeUndefined();
  });

  it("answers nothing when there is no clash, but still remembers the keys", async () => {
    cards.set("me", card("me"));
    const out = await claimPreHook("me", () => ["/repo/a.ts#one"]);
    expect(claimPreAnswer(out, "free")).toEqual({});
    expect(claimQuestion("free")).toBeUndefined();
    expect(pendingEntry("free")?.keys).toEqual(["/repo/a.ts#one"]);
  });
});

describe("the pending calls", () => {
  it("forgets a call it recorded", () => {
    remember("gone", ["/repo/a.ts#one"], "q");
    expect(pendingEntry("gone")?.question).toBe("q");
    forget("gone");
    expect(pendingEntry("gone")).toBeUndefined();
    expect(pendingEntry(undefined)).toBeUndefined();
  });
});

describe("claimPostCard", () => {
  it("finds the card the call belonged to, or nothing", () => {
    cards.set("me", card("me"));
    expect(claimPostCard("me")?.id).toBe("me");
    expect(claimPostCard("nobody")).toBeUndefined();
    expect(claimPostCard(undefined)).toBeUndefined();
  });
});
