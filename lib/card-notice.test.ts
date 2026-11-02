// @vitest-environment happy-dom
// A card's change noticed wherever it runs: a worker's cards, read every few seconds, chime and announce like this Mac's.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "./types";

const announce = vi.hoisted(() => vi.fn());
const playChime = vi.hoisted(() => vi.fn());
vi.mock("./board-helpers", () => ({ announce }));
vi.mock("./chimes", () => ({ playChime }));

const { noticeCard, useWorkerNotices } = await import("./card-notice");

const card = (column: Column, over: Partial<Card> = {}) => ({ id: "k1", title: "Fix", column, cwd: "worker://w1/ling", ...over }) as Card;

function ctx() {
  return {
    ownMoves: { current: new Map<string, { column: Column; at: number }>() },
    selectedRef: { current: null as string | null },
    select: vi.fn(),
    setUnseen: vi.fn(),
    awayMove: vi.fn(),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("noticeCard", () => {
  it("announces, chimes and marks a move it didn't make, and opens the card from the notification", () => {
    const c = ctx();
    noticeCard(card("needs_you"), { column: "running" }, c);
    expect(announce).toHaveBeenCalledWith(expect.objectContaining({ id: "k1" }), expect.any(Function));
    (announce.mock.calls[0] as [Card, () => void])[1]();
    expect(c.select).toHaveBeenCalledWith("k1");
    expect(playChime).toHaveBeenCalledWith("needs_you");
    expect(c.awayMove).toHaveBeenCalledWith("k1", "needs_you", true);
    const mark = c.setUnseen.mock.calls[0]?.[0] as (prev: ReadonlySet<string>) => ReadonlySet<string>;
    expect([...mark(new Set())]).toEqual(["k1"]);
    const had = new Set(["k1"]);
    expect(mark(had)).toBe(had);
  });

  it("stays quiet for your own drag and an unmoved card, and chimes a new error", () => {
    const c = ctx();
    c.ownMoves.current.set("k1", { column: "done", at: Date.now() });
    noticeCard(card("done"), { column: "review" }, c);
    expect(playChime).not.toHaveBeenCalled();
    expect(c.ownMoves.current.has("k1")).toBe(false);
    expect(c.awayMove).toHaveBeenCalledWith("k1", "done", false);
    noticeCard(card("review", { error: "boom" }), { column: "review" }, c);
    expect(playChime).toHaveBeenCalledWith("error");
    expect(announce).toHaveBeenCalledOnce();
  });
});

describe("useWorkerNotices", () => {
  it("takes the first read as the baseline, then notices each change once", () => {
    const c = ctx();
    const { rerender } = renderHook(({ cards }) => useWorkerNotices(cards, c), { initialProps: { cards: [card("running")] } });
    expect(announce).not.toHaveBeenCalled();
    rerender({ cards: [card("needs_you")] });
    expect(announce).toHaveBeenCalledOnce();
    expect(playChime).toHaveBeenCalledWith("needs_you");
    rerender({ cards: [card("needs_you"), card("running", { id: "k2" })] });
    expect(announce).toHaveBeenCalledOnce();
  });
});
