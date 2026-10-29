// lib/share-view.ts: pure view-side logic for the share viewer. How a poll merges by seq, how the
// load-earlier and poll-after cursors are computed, and when the "Load earlier" button is hidden.
import { describe, expect, it } from "vitest";
import { canLoadEarlier, mergeShareLive, newestSeq, oldestSeq, publicPane, toShareCard } from "./share-view";
import type { Card, ThreadItem } from "./types";
import type { ShareLive } from "./share-types";

function makeItem(seq: number, text: string): ThreadItem {
  return { kind: "user", text, at: seq };
}

function makeLive(over: Partial<ShareLive> = {}): ShareLive {
  const card: Card = {
    id: "c1",
    title: "T",
    prompt: "p",
    cwd: "/x",
    backend: "claude",
    permissionMode: "auto",
    column: "running",
    createdAt: 0,
    updatedAt: 0,
  };
  return {
    card,
    items: [],
    hasOlder: false,
    pane: null,
    blobUrls: {},
    showChat: true,
    ...over,
  };
}

describe("mergeShareLive", () => {
  it("prepends new items in seq order, newest first", () => {
    const prev = makeLive({ items: [{ seq: 3, item: makeItem(3, "old-3") }, { seq: 2, item: makeItem(2, "old-2") }] });
    const next = makeLive({ items: [{ seq: 5, item: makeItem(5, "new-5") }, { seq: 4, item: makeItem(4, "new-4") }] });
    const merged = mergeShareLive(prev, next);
    expect(merged.items.map((i) => i.seq)).toEqual([5, 4, 3, 2]);
  });

  it("replaces an item at the same seq in place", () => {
    const prev = makeLive({ items: [{ seq: 3, item: makeItem(3, "before") }, { seq: 2, item: makeItem(2, "stays") }] });
    const next = makeLive({ items: [{ seq: 3, item: makeItem(3, "after") }] });
    const merged = mergeShareLive(prev, next);
    expect(merged.items.map((i) => i.seq)).toEqual([3, 2]);
    const first = merged.items[0]!;
    expect(first.item.kind).toBe("user");
    if (first.item.kind === "user") expect(first.item.text).toBe("after");
  });

  it("takes the latest card, pane and merged blob URLs from next", () => {
    const prev = makeLive({ card: { ...makeLive().card, title: "old" }, blobUrls: { a: "u-a", c: "u-c" } });
    const nextCard: ShareLive["card"] = { ...prev.card, title: "new" };
    const next = makeLive({ card: nextCard, blobUrls: { a: "u-a2", b: "u-b" } });
    const merged = mergeShareLive(prev, next);
    expect(merged.card.title).toBe("new");
    expect(merged.blobUrls).toEqual({ a: "u-a2", b: "u-b", c: "u-c" });
  });

  it("unionizes hasOlder so either side's flag wins", () => {
    const a = makeLive({ hasOlder: true });
    const b = makeLive({ hasOlder: false });
    expect(mergeShareLive(a, b).hasOlder).toBe(true);
    expect(mergeShareLive(makeLive({ hasOlder: false }), makeLive({ hasOlder: true })).hasOlder).toBe(true);
  });

  it("handles an empty prev (the first poll response)", () => {
    const prev = makeLive();
    const next = makeLive({ items: [{ seq: 1, item: makeItem(1, "first") }] });
    expect(mergeShareLive(prev, next).items.map((i) => i.seq)).toEqual([1]);
  });

  it("takes showChat from next", () => {
    expect(mergeShareLive(makeLive(), makeLive({ showChat: true })).showChat).toBe(true);
    expect(mergeShareLive(makeLive({ showChat: true }), makeLive({ showChat: false })).showChat).toBe(false);
    expect(mergeShareLive(makeLive({ showChat: false }), makeLive({ showChat: true })).showChat).toBe(true);
  });

  it("drops what the viewer already has when the sharer hides the chat mid-view", () => {
    const prev = makeLive({
      items: [{ seq: 3, item: makeItem(3, "old-3") }, { seq: 2, item: makeItem(2, "old-2") }],
      hasOlder: true,
      blobUrls: { a: "u-a", b: "u-b" },
    });
    const next = makeLive({ items: [{ seq: 4, item: makeItem(4, "new-4") }], hasOlder: true, showChat: false, blobUrls: { b: "u-b2", c: "u-c" } });
    const merged = mergeShareLive(prev, next);
    expect(merged.showChat).toBe(false);
    expect(merged.items).toEqual([]);
    expect(merged.hasOlder).toBe(false);
    // The blob URLs are still merged, so the card's picture keeps rendering.
    expect(merged.blobUrls).toEqual({ a: "u-a", b: "u-b2", c: "u-c" });
  });

  it("takes the card and the pane from next even when the chat is hidden", () => {
    const prev = makeLive({ card: { ...makeLive().card, title: "old" }, pane: { kind: "site", url: "https://old", label: "old" } });
    const next = makeLive({ card: { ...makeLive().card, title: "new" }, pane: { kind: "site", url: "https://new", label: "new" }, showChat: false });
    const merged = mergeShareLive(prev, next);
    expect(merged.card.title).toBe("new");
    expect(merged.pane).toEqual({ kind: "site", url: "https://new", label: "new" });
  });
});

describe("newestSeq", () => {
  it("returns 0 for an empty list", () => {
    expect(newestSeq(makeLive())).toBe(0);
  });
  it("returns the first item's seq (newest first)", () => {
    expect(newestSeq(makeLive({ items: [{ seq: 9, item: makeItem(9, "x") }, { seq: 2, item: makeItem(2, "y") }] }))).toBe(9);
  });
});

describe("oldestSeq", () => {
  it("returns 0 for an empty list", () => {
    expect(oldestSeq(makeLive())).toBe(0);
  });
  it("returns the smallest seq, even when the list is unordered", () => {
    expect(oldestSeq(makeLive({ items: [{ seq: 9, item: makeItem(9, "x") }, { seq: 2, item: makeItem(2, "y") }, { seq: 5, item: makeItem(5, "z") }] }))).toBe(2);
  });
});

describe("canLoadEarlier", () => {
  it("is false on the very first page (no items)", () => {
    expect(canLoadEarlier(makeLive({ hasOlder: true }))).toBe(false);
  });
  it("is false when hasOlder is false", () => {
    expect(canLoadEarlier(makeLive({ items: [{ seq: 1, item: makeItem(1, "x") }], hasOlder: false }))).toBe(false);
  });
  it("is true when hasOlder is true and there are items", () => {
    expect(canLoadEarlier(makeLive({ items: [{ seq: 1, item: makeItem(1, "x") }], hasOlder: true }))).toBe(true);
  });
});
describe("toShareCard", () => {
  const REF = `blob:sha256:${"c".repeat(64)}`;

  it("keeps what the viewer draws and nothing else of the card", () => {
    const card = {
      id: "c1",
      title: "Pricing page",
      emoji: "💸",
      column: "review",
      tags: ["feature", 7, "cloud-sync"],
      thumb: REF,
      cwd: "/Users/me/secret-project",
      sessionId: "sess-1",
      pending: { id: "p", title: "Allow rm -rf?" },
      tasks: [{ command: "curl -H token" }],
    };
    expect(toShareCard(card)).toEqual({ id: "c1", title: "Pricing page", emoji: "💸", column: "review", tags: ["feature", "cloud-sync"], thumb: REF });
  });

  it("drops a thumb that is a path on the owner's Mac", () => {
    expect(toShareCard({ id: "c1", title: "T", column: "running", thumb: "/api/attachments/pane.jpg" })).toEqual({ id: "c1", title: "T", column: "running" });
  });

  it("still answers for a missing or odd card", () => {
    expect(toShareCard(undefined)).toEqual({ id: "", title: "", column: "backlog" });
    expect(toShareCard("nope")).toEqual({ id: "", title: "", column: "backlog" });
    expect(toShareCard({ id: 4, title: null })).toEqual({ id: "", title: "", column: "backlog" });
  });
});

describe("publicPane", () => {
  it("keeps the label of a page only the owner can open but not its address", () => {
    expect(publicPane({ kind: "local", url: "file:///Users/me/.weft/show/plan/index.html", label: "plan/index.html" })).toEqual({ kind: "local", url: "", label: "plan/index.html" });
  });

  it("leaves other panes as they are", () => {
    const site = { kind: "site", url: "https://example.com", label: "example.com" } as const;
    expect(publicPane(site)).toBe(site);
    expect(publicPane(null)).toBeNull();
  });
});
