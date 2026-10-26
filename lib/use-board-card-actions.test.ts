// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "./types";

const apiMove = vi.fn<(id: string, column: Column) => Promise<unknown>>();
const apiReorder = vi.fn<(id: string, before: string | null) => Promise<unknown>>();
const apiMark = vi.fn<(id: string, patch: { tags?: string[] }) => Promise<unknown>>();
vi.mock("./client", () => ({
  api: {
    move: (id: string, column: Column) => apiMove(id, column),
    reorder: (id: string, before: string | null) => apiReorder(id, before),
    mark: (id: string, patch: { tags?: string[] }) => apiMark(id, patch),
  },
}));

const { useBoardCardActions } = await import("./use-board-card-actions");

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "Fix", column: "running", cwd: "/repo", tags: [], archived: false, starred: false, ...over }) as Card;

beforeEach(() => {
  apiMove.mockReset();
  apiReorder.mockReset();
  apiMark.mockReset();
  apiMove.mockResolvedValue({ card: card() });
  apiReorder.mockResolvedValue({ card: card() });
  apiMark.mockResolvedValue({ card: card() });
});

afterEach(cleanup);

function makeActions(cards: Card[] = [card()]) {
  const setDragOver = vi.fn<(column: Column | null) => void>();
  const setCards = vi.fn<(updater: (cards: Card[]) => Card[]) => void>();
  const notify = vi.fn();
  const { result } = renderHook(() => useBoardCardActions({ cards, setCards, setDragOver, notify }));
  return { result, setDragOver, setCards, notify };
}

describe("useBoardCardActions", () => {
  it("move records an own move and calls api.move", () => {
    const { result } = makeActions();
    act(() => result.current.move("c1", "needs_you"));
    expect(apiMove).toHaveBeenCalledWith("c1", "needs_you");
    act(() => result.current.move("c1", "review"));
    expect(apiMove).toHaveBeenCalledWith("c1", "review");
  });

  it("move surfaces an api error through notify", async () => {
    apiMove.mockRejectedValueOnce(new Error("down"));
    const { result, notify } = makeActions();
    act(() => result.current.move("c1", "needs_you"));
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(new Error("down"));
  });

  it("move puts the card in its new column before the server answers", () => {
    apiMove.mockReturnValueOnce(new Promise(() => {}));
    const { result, setCards } = makeActions([card({ id: "c1", column: "review" }), card({ id: "c2", column: "review" })]);
    act(() => result.current.move("c1", "done"));
    const next = setCards.mock.calls[0]![0]([card({ id: "c1", column: "review" }), card({ id: "c2", column: "review" })]);
    expect(next.map((c) => c.column)).toEqual(["done", "review"]);
  });

  it("move puts the card back when the server refuses, unless it moved again since", async () => {
    apiMove.mockRejectedValueOnce(new Error("Stop the thread before moving it."));
    const { result, setCards, notify } = makeActions([card({ id: "c1", column: "review" })]);
    act(() => result.current.move("c1", "done"));
    await Promise.resolve();
    expect(notify).toHaveBeenCalled();
    const undo = setCards.mock.calls[1]![0];
    expect(undo([card({ id: "c1", column: "done" })])[0]!.column).toBe("review");
    expect(undo([card({ id: "c1", column: "backlog" })])[0]!.column).toBe("backlog");
  });

  it("move to the card's own column or an unknown card changes nothing locally", () => {
    const { result, setCards } = makeActions([card({ id: "c1", column: "review" })]);
    act(() => result.current.move("c1", "review"));
    act(() => result.current.move("nope", "done"));
    expect(setCards).not.toHaveBeenCalled();
    expect(apiMove).toHaveBeenCalledTimes(2);
  });

  it("a refusal on a card that never moved puts it back nowhere, just says why", async () => {
    apiMove.mockRejectedValueOnce(new Error("offline"));
    const { result, setCards, notify } = makeActions([card({ id: "c1", column: "review" })]);
    // Moving to the card's own column never touched the board, so there is nothing to undo.
    act(() => result.current.move("c1", "review"));
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(new Error("offline"));
    expect(setCards).not.toHaveBeenCalled();
  });

  it("drop moves the dragged card when its column changed", () => {
    const preventDefault = vi.fn();
    const { result, setDragOver } = makeActions([card({ id: "c1", column: "running" })]);
    const event = { preventDefault, dataTransfer: { getData: () => "c1" } } as unknown as React.DragEvent;
    act(() => result.current.drop("needs_you", event));
    expect(preventDefault).toHaveBeenCalled();
    expect(setDragOver).toHaveBeenCalledWith(null);
    expect(apiMove).toHaveBeenCalledWith("c1", "needs_you");
  });

  it("drop leaves a card alone when it's already in the column", () => {
    const { result } = makeActions([card({ id: "c1", column: "needs_you" })]);
    const event = { preventDefault: vi.fn(), dataTransfer: { getData: () => "c1" } } as unknown as React.DragEvent;
    act(() => result.current.drop("needs_you", event));
    expect(apiMove).not.toHaveBeenCalled();
  });

  it("drop on an unknown id is a no-op (clears the drag state but doesn't move)", () => {
    const { result } = makeActions([]);
    const event = { preventDefault: vi.fn(), dataTransfer: { getData: () => "ghost" } } as unknown as React.DragEvent;
    act(() => result.current.drop("needs_you", event));
    expect(apiMove).not.toHaveBeenCalled();
  });

  it("tagCard adds the tag and saves it via api.mark", () => {
    const { result } = makeActions([card({ id: "c1", tags: ["bug"] })]);
    act(() => result.current.tagCard("c1", "urgent"));
    expect(apiMark).toHaveBeenCalledWith("c1", { tags: ["bug", "urgent"] });
  });

  it("tagCard is a no-op when the tag is already on the card", () => {
    const { result } = makeActions([card({ id: "c1", tags: ["bug"] })]);
    act(() => result.current.tagCard("c1", "bug"));
    expect(apiMark).not.toHaveBeenCalled();
  });

  it("tagCard is a no-op for an unknown card", () => {
    const { result } = makeActions([]);
    act(() => result.current.tagCard("ghost", "x"));
    expect(apiMark).not.toHaveBeenCalled();
  });

  it("reorder stamps a new order on the card and calls api.reorder", () => {
    const cards = [
      card({ id: "a", column: "backlog", order: 100 }),
      card({ id: "b", column: "backlog", order: 200 }),
      card({ id: "c", column: "backlog", order: 300 }),
    ];
    const { result, setCards } = makeActions(cards);
    act(() => result.current.reorder("c", "a", true));
    expect(apiReorder).toHaveBeenCalledWith("c", "a");
    // The optimistic setCards updater produces an order between the new neighbors.
    const updater = setCards.mock.calls[0]![0];
    const next = updater(cards);
    const moved = next.find((c) => c.id === "c")!;
    const neighbor = next.find((c) => c.id === "a")!;
    // The card lands before `a`, so its new order is less than a's. The "place before
    // the first card" formula subtracts ORDER_STEP from the first neighbor, so the
    // number itself can be negative — only the relative order matters.
    expect(moved.order!).toBeLessThan(neighbor.order!);
  });

  it("reorder at the end (before=false on the last sibling) calls api.reorder with null", () => {
    const cards = [
      card({ id: "a", column: "backlog", order: 100 }),
      card({ id: "b", column: "backlog", order: 200 }),
    ];
    const { result, setCards } = makeActions(cards);
    act(() => result.current.reorder("a", "b", false));
    expect(apiReorder).toHaveBeenCalledWith("a", null);
    const updater = setCards.mock.calls[0]![0];
    const next = updater(cards);
    const moved = next.find((c) => c.id === "a")!;
    const last = next.find((c) => c.id === "b")!;
    expect(moved.order!).toBeGreaterThan(last.order!);
  });

  it("reorder after a middle sibling anchors before the following card", () => {
    const cards = [
      card({ id: "a", column: "backlog", order: 100 }),
      card({ id: "b", column: "backlog", order: 200 }),
      card({ id: "c", column: "backlog", order: 300 }),
      card({ id: "d", column: "backlog", order: 400 }),
    ];
    const { result, setCards } = makeActions(cards);
    act(() => result.current.reorder("a", "b", false));

    expect(apiReorder).toHaveBeenCalledWith("a", "c");
    const updater = setCards.mock.calls[0]![0];
    const next = updater(cards);
    const moved = next.find((c) => c.id === "a")!;
    expect(moved.order!).toBeGreaterThan(200);
    expect(moved.order!).toBeLessThan(300);
  });

  it("optimistically renumbers the same slot when the neighbor gap is closed", () => {
    const cards = [
      card({ id: "a", column: "backlog", order: 100 }),
      card({ id: "b", column: "backlog", order: 101 }),
      card({ id: "c", column: "backlog", order: 300 }),
      card({ id: "d", column: "backlog", order: 400 }),
    ];
    const { result, setCards } = makeActions(cards);
    act(() => result.current.reorder("d", "b", true));

    expect(apiReorder).toHaveBeenCalledWith("d", "b");
    const updater = setCards.mock.calls[0]![0];
    const next = updater(cards);
    const ordered = next.toSorted((a, b) => a.order! - b.order!).map((c) => c.id);
    expect(ordered).toEqual(["a", "d", "b", "c"]);
    expect(next.map((c) => c.order)).toEqual([1024, 3072, 4096, 2048]);
  });

  it("reorder is a no-op for an unknown card", () => {
    const { result, setCards } = makeActions([card({ id: "a", column: "backlog" })]);
    act(() => result.current.reorder("ghost", "a", true));
    expect(apiReorder).not.toHaveBeenCalled();
    expect(setCards).not.toHaveBeenCalled();
  });

  it("reorder is a no-op when the target isn't a sibling in the card's column", () => {
    const cards = [
      card({ id: "a", column: "backlog", order: 100 }),
      card({ id: "b", column: "review", order: 200 }),
    ];
    const { result, setCards } = makeActions(cards);
    // "b" is in another column, so it isn't a sibling of "a" and there's nowhere to drop.
    act(() => result.current.reorder("a", "b", true));
    expect(apiReorder).not.toHaveBeenCalled();
    expect(setCards).not.toHaveBeenCalled();
  });

  it("reorder surfaces an api error through notify", async () => {
    apiReorder.mockRejectedValueOnce(new Error("offline"));
    const cards = [
      card({ id: "a", column: "backlog", order: 100 }),
      card({ id: "b", column: "backlog", order: 200 }),
    ];
    const { result, notify } = makeActions(cards);
    act(() => result.current.reorder("a", "b", true));
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(new Error("offline"));
  });
});
