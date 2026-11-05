import { describe, expect, it } from "vitest";
import { boardDigest, markSeen, lastSeen, rememberSeen, snapshot, withDigest } from "./copilot-digest";
import type { Card } from "./types";

const card = (over: Partial<Card> & { id: string }): Card => ({
  title: `Card ${over.id}`,
  prompt: "",
  cwd: "/tmp",
  backend: "claude",
  permissionMode: "default",
  column: "running",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("boardDigest", () => {
  it("reports cards that moved to Review, Needs you, or failed since the snapshot", () => {
    const before = [card({ id: "a" }), card({ id: "b" }), card({ id: "c" }), card({ id: "d" })];
    const seen = snapshot(before);
    const now = [
      card({ id: "a", column: "review", lastLine: "Added the login page\nmore" }),
      card({ id: "b", column: "needs_you", pending: { id: "p", toolName: "Bash", title: "Run npm test", input: {} } }),
      card({ id: "c", column: "review", error: "Rate limited" }),
      card({ id: "d" }),
    ];
    const digest = boardDigest(now, seen);
    expect(digest.split("\n")).toEqual([
      "[Weft board update since your last message, not written by the user. Context only: the swim lanes already show this, so mention it only when it changes your answer]",
      '- Finished, in Review: "Card a" (a): Added the login page',
      '- Needs you: "Card b" (b): Run npm test',
      '- Error: "Card c" (c): Rate limited',
    ]);
  });

  it("is empty when nothing changed, and leaves out the copilot and archived cards", () => {
    const cards = [card({ id: "a", column: "review" }), card({ id: "copilot", role: "copilot", column: "review" })];
    expect(boardDigest(cards, snapshot(cards))).toBe("");
    const archived = card({ id: "x", column: "review", archived: true });
    expect(boardDigest([archived], {})).toBe("");
  });

  it("reports a new card that finished since the snapshot", () => {
    expect(boardDigest([card({ id: "new", column: "review" })], {})).toContain('"Card new" (new)');
  });

  it("without a snapshot, uses activity after the copilot's last turn", () => {
    const cards = [
      card({ id: "old", column: "review", lastActivity: 100 }),
      card({ id: "fresh", column: "needs_you", lastActivity: 300, lastLine: "Which db?" }),
    ];
    const digest = boardDigest(cards, undefined, 200);
    expect(digest).toContain('- Needs you: "Card fresh" (fresh): Which db?');
    expect(digest).not.toContain("old");
  });

  it("caps the list", () => {
    const cards = Array.from({ length: 13 }, (_, i) => card({ id: `c${i}`, column: "review" }));
    const lines = boardDigest(cards, {}).split("\n");
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe("- …and 3 more (see list_cards)");
  });
});

describe("withDigest", () => {
  it("puts the digest before the user's text, or sends the text alone", () => {
    expect(withDigest("", "hi")).toBe("hi");
    expect(withDigest("[update]\n- x", "hi")).toBe("[update]\n- x\n\nhi");
  });
});

describe("markSeen", () => {
  it("records the copilot's own move so it isn't reported back", () => {
    const cards = [card({ id: "a" })];
    rememberSeen(snapshot(cards));
    markSeen("a", "review");
    expect(lastSeen()?.a!.column).toBe("review");
    expect(boardDigest([card({ id: "a", column: "review" })], lastSeen())).toBe("");
  });
});

describe("boardDigest edge cases", () => {
  it("without a snapshot, falls back to updatedAt and reports an error only if the card changed since", () => {
    const cards = [
      card({ id: "stale", column: "review", error: "old failure", updatedAt: 100 }),
      card({ id: "broke", column: "running", error: "Rate limited", updatedAt: 300 }),
    ];
    expect(boardDigest(cards, undefined, 200).split("\n").slice(1)).toEqual(['- Error: "Card broke" (broke): Rate limited']);
  });

  it("names a card that needs you even when it says nothing about why", () => {
    expect(boardDigest([card({ id: "q", column: "needs_you" })], {})).toContain('- Needs you: "Card q" (q)');
    expect(boardDigest([card({ id: "q", column: "needs_you" })], {})).not.toContain("(q):");
  });

  it("doesn't report an error again once the copilot has seen it", () => {
    const seen = { a: { column: "running" as const, error: "boom" } };
    expect(boardDigest([card({ id: "a", error: "boom" })], seen)).toBe("");
  });
});

describe("markSeen for a card it never saw", () => {
  it("leaves the snapshot alone", () => {
    rememberSeen({});
    markSeen("ghost", "done");
    expect(lastSeen()).toEqual({});
  });
});
