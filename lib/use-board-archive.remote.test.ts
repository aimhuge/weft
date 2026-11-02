// @vitest-environment happy-dom
// Archiving a worker's card from the desktop board (lib/use-board-archive.ts): filed through its host
// (lib/project-host.ts), and Undo asks the same host.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const apiArchive = vi.fn(() => Promise.resolve());
vi.mock("./client", () => ({ api: { archive: (...args: unknown[]) => apiArchive(...(args as [])) } }));
const hostAct = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()));
// This Mac's host runs the board's own call; a worker's sends the verb.
vi.mock("./project-host", () => ({
  hostOf: (c: { cwd: string }) => ({
    act: (verb: string, args: unknown, local?: () => Promise<unknown>) => (c.cwd.startsWith("worker://") ? hostAct(verb, args) : (local?.() ?? Promise.resolve())),
  }),
}));

const { useBoardArchive } = await import("./use-board-archive");

const card = (over: Partial<Card> = {}): Card => ({ id: "w1", title: "Fix", column: "done", cwd: "worker://m1/ling", ...over }) as Card;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeArchive(cards: Card[]) {
  const deps = { cards, selected: null, selectedIdRef: { current: null }, select: vi.fn(), setToast: vi.fn(), notify: vi.fn() };
  return renderHook(() => useBoardArchive(deps)).result;
}

describe("the worker poll", () => {
  it("doesn't change the archive's callbacks, and they still find the newest cards", async () => {
    const deps = { selected: null, selectedIdRef: { current: null }, select: vi.fn(), setToast: vi.fn(), notify: vi.fn() };
    const { result, rerender } = renderHook(({ cards }) => useBoardArchive({ ...deps, cards }), { initialProps: { cards: [] as Card[] } });
    const before = result.current;
    rerender({ cards: [card()] });
    expect(result.current.archiveCards).toBe(before.archiveCards);
    expect(result.current.unarchive).toBe(before.unarchive);
    expect(result.current.toggleArchive).toBe(before.toggleArchive);
    expect(result.current.archiveTarget).toBe(before.archiveTarget);
    act(() => result.current.unarchive(["w1"]));
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "w1", body: { archived: false } });
  });
});

describe("a worker card's archive", () => {
  it("files it on its worker, and Undo unfiles it there", async () => {
    const result = makeArchive([card()]);
    act(() => result.current.archiveCards([card()]));
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "w1", body: { archived: true } });
    act(() => result.current.unarchive(["w1"]));
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "w1", body: { archived: false } });
    expect(apiArchive).not.toHaveBeenCalled();
  });

  it("unarchives a card the board no longer holds on this Mac", async () => {
    const result = makeArchive([]);
    act(() => result.current.unarchive(["gone"]));
    await Promise.resolve();
    expect(apiArchive).toHaveBeenCalledWith("gone", false);
  });

  it("unarchives one from its own button on its worker", async () => {
    const result = makeArchive([card({ archived: true })]);
    act(() => result.current.toggleArchive(card({ archived: true })));
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "w1", body: { archived: false } });
  });
});
