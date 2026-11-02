// @vitest-environment happy-dom
// A worker's card dragged or moved on the desktop board (lib/use-board-card-actions.ts): it isn't one of this Mac's
// cards, so it moves through the optimistic overlay and its host's card.update (lib/project-host.ts).
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "./types";

const apiMove = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock("./client", () => ({ api: { move: (...args: unknown[]) => apiMove(...args) } }));
const act_ = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()));
vi.mock("./project-host", () => ({ hostOf: () => ({ act: act_ }) }));
const patchNow = vi.hoisted(() => vi.fn((_id: string, _fields: unknown, call: () => Promise<unknown>) => call().then(() => {})));
vi.mock("./optimistic-cards", () => ({ patchNow }));

const { useBoardCardActions } = await import("./use-board-card-actions");

const card = (over: Partial<Card> = {}): Card => ({ id: "w1", title: "Fix", column: "review", cwd: "worker://m1/ling", ...over }) as Card;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeActions(remote: Card[]) {
  const setCards = vi.fn();
  const setDragOver = vi.fn<(column: Column | null) => void>();
  const notify = vi.fn();
  const { result } = renderHook(() => useBoardCardActions({ cards: [], remote, setCards, setDragOver, notify }));
  return { result, setCards, notify };
}

describe("a worker card's move", () => {
  it("draws the new column at once and sends a card.update to its host", async () => {
    const { result, setCards } = makeActions([card()]);
    act(() => result.current.move("w1", "done"));
    await Promise.resolve();
    expect(patchNow).toHaveBeenCalledWith("w1", { column: "done" }, expect.any(Function));
    expect(act_).toHaveBeenCalledWith("card.update", { id: "w1", body: { column: "done" } });
    expect(setCards).not.toHaveBeenCalled();
    expect(apiMove).not.toHaveBeenCalled();
  });

  it("tells the board when the worker refuses", async () => {
    const boom = new Error("busy");
    act_.mockRejectedValueOnce(boom);
    const { result, notify } = makeActions([card()]);
    act(() => result.current.move("w1", "done"));
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).toHaveBeenCalledWith(boom);
  });

  it("moves when dropped on another column", () => {
    const { result } = makeActions([card()]);
    const e = { preventDefault: vi.fn(), dataTransfer: { getData: () => "w1" } } as unknown as React.DragEvent;
    act(() => result.current.drop("done", e));
    expect(patchNow).toHaveBeenCalledWith("w1", { column: "done" }, expect.any(Function));
  });
});
