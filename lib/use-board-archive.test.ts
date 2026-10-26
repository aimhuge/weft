// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const apiArchive = vi.fn<(id: string, archived: boolean) => Promise<unknown>>();
vi.mock("./client", () => ({ api: { archive: (id: string, archived: boolean) => apiArchive(id, archived) } }));

const { useBoardArchive } = await import("./use-board-archive");

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "Fix", column: "done", cwd: "/repo", tags: [], archived: false, starred: false, ...over }) as Card;

beforeEach(() => {
  apiArchive.mockReset();
  apiArchive.mockResolvedValue({ card: card() });
});

afterEach(cleanup);

// The board's own markup for a column of cards: the archive key reads it to find where the
// keyboard focus should land after a card is filed away.
function boardDom(ids: string[], extra = "") {
  document.body.innerHTML = `<div data-column="done">${ids
    .map((id) => `<div data-card-id="${id}" tabindex="0">${id}</div>`)
    .join("")}${extra}</div>`;
  return [...document.querySelectorAll<HTMLElement>("[data-card-id]")];
}

function makeArchive(over: Partial<{ cards: Card[]; selected: Card | null }> = {}) {
  const cards = over.cards ?? [card()];
  const selected = over.selected ?? null;
  const select = vi.fn();
  const setToast = vi.fn();
  const notify = vi.fn();
  const selectedIdRef: React.RefObject<string | null> = { current: null };
  const { result } = renderHook(() =>
    useBoardArchive({ cards, selected, selectedIdRef, select, setToast, notify }),
  );
  return { result, select, setToast, notify, selectedIdRef };
}

describe("useBoardArchive", () => {
  it("archiveCards calls api.archive(true) and shows an Undo toast", () => {
    const { result, setToast, notify } = makeArchive({ cards: [card({ id: "c1" }), card({ id: "c2" })] });
    act(() => result.current.archiveCards([card({ id: "c1" }), card({ id: "c2" })]));
    expect(apiArchive).toHaveBeenCalledWith("c1", true);
    expect(apiArchive).toHaveBeenCalledWith("c2", true);
    expect(setToast).toHaveBeenCalledTimes(1);
    const [text, action] = setToast.mock.calls[0] as [string, { label: string }];
    expect(text).toMatch(/Archived/);
    expect(action.label).toBe("Undo");
    // No error to surface from successful archives.
    expect(notify).not.toHaveBeenCalled();
  });

  it("archiveCards does nothing for an empty list", () => {
    const { result, setToast } = makeArchive();
    act(() => result.current.archiveCards([]));
    expect(apiArchive).not.toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalled();
  });

  it("toggleArchive on an archived card calls api.archive(false)", () => {
    const { result } = makeArchive({ cards: [card({ id: "c1", archived: true })] });
    act(() => result.current.toggleArchive(card({ id: "c1", archived: true })));
    expect(apiArchive).toHaveBeenCalledWith("c1", false);
  });

  it("toggleArchive on a non-archived card archives it (toast shown)", () => {
    const { result, setToast } = makeArchive({ cards: [card({ id: "c1", archived: false })] });
    act(() => result.current.toggleArchive(card({ id: "c1", archived: false })));
    expect(apiArchive).toHaveBeenCalledWith("c1", true);
    expect(setToast).toHaveBeenCalled();
  });

  it("unarchive clears the toast and lastArchived, then calls api.archive(false)", () => {
    const { result, setToast } = makeArchive({ cards: [card({ id: "c1" })] });
    act(() => result.current.archiveCards([card({ id: "c1" })]));
    act(() => result.current.unarchive(["c1"]));
    expect(apiArchive).toHaveBeenCalledWith("c1", false);
    expect(setToast).toHaveBeenLastCalledWith(null);
  });

  it("archiveTarget returns undefined when no card has focus and no card is open", () => {
    const { result } = makeArchive({ cards: [card({ id: "c1" })] });
    expect(result.current.archiveTarget()).toBeUndefined();
  });

  it("archiveTarget falls back to the open card when nothing has focus", () => {
    const selectedCard = card({ id: "c1" });
    const { result } = makeArchive({ cards: [selectedCard], selected: selectedCard });
    // The fallback uses the second arg, so the same card object is returned.
    expect(result.current.archiveTarget()).toBe(selectedCard);
  });

  it("archiveCards closes the thread when the open card is in the batch", () => {
    const { result, select, selectedIdRef } = makeArchive({ cards: [card({ id: "c1" })] });
    selectedIdRef.current = "c1";
    act(() => result.current.archiveCards([card({ id: "c1" })]));
    expect(select).toHaveBeenCalledWith(null);
  });

  it("archiveCards surfaces an api error through notify", async () => {
    apiArchive.mockRejectedValueOnce(new Error("down"));
    const { result, notify } = makeArchive({ cards: [card({ id: "c1" })] });
    await act(async () => {
      result.current.archiveCards([card({ id: "c1" })]);
      await Promise.resolve();
    });
    expect(notify).toHaveBeenCalled();
  });

  it("moves the keyboard focus to the next card in the column", () => {
    const els = boardDom(["c1", "c2", "c3"]);
    const { result } = makeArchive({ cards: [card({ id: "c1" }), card({ id: "c2" }), card({ id: "c3" })] });
    act(() => result.current.archiveCards([card({ id: "c1" })]));
    // c1 goes away, so the focus lands on the card below it.
    expect(document.activeElement).toBe(els[1]);
  });

  it("moves the focus to the nearest card above when the last one goes", () => {
    const els = boardDom(["c1", "c2"]);
    const { result } = makeArchive({ cards: [card({ id: "c1" }), card({ id: "c2" })] });
    act(() => result.current.archiveCards([card({ id: "c2" })]));
    expect(document.activeElement).toBe(els[0]);
  });

  it("copes with a card element that names no card", () => {
    // A card element whose data-card-id reads as nothing: the id list falls back to an empty
    // string, so the neighbour search skips it instead of matching a card called "".
    document.body.innerHTML = '<div data-column="done"><div data-card-id="c1" tabindex="0">c1</div></div>';
    const column = document.querySelector<HTMLElement>("[data-column]")!;
    const odd = document.createElement("div");
    // happy-dom's dataset is a readonly proxy, so the element's own is replaced with a plain one.
    Object.defineProperty(odd, "dataset", { value: { cardId: undefined } });
    odd.setAttribute("data-card-id", "c1");
    column.append(odd);
    const { result } = makeArchive({ cards: [card({ id: "c1" })] });
    expect(() => act(() => result.current.archiveCards([card({ id: "c1" })]))).not.toThrow();
    expect(apiArchive).toHaveBeenCalledWith("c1", true);
  });

  it("focuses nothing when the column has no other card", () => {
    boardDom(["c1"]);
    const { result } = makeArchive({ cards: [card({ id: "c1" })] });
    act(() => result.current.archiveCards([card({ id: "c1" })]));
    expect(document.activeElement).toBe(document.body);
  });

  it("unarchive surfaces an api error through notify", async () => {
    apiArchive.mockRejectedValueOnce(new Error("down"));
    const { result, notify } = makeArchive({ cards: [card({ id: "c1" })] });
    await act(async () => {
      result.current.unarchive(["c1"]);
      await Promise.resolve();
    });
    expect(notify).toHaveBeenCalled();
  });

  it("the toast's Undo puts the cards back", () => {
    const { result, setToast } = makeArchive({ cards: [card({ id: "c1" })] });
    act(() => result.current.archiveCards([card({ id: "c1" })]));
    const [, action] = setToast.mock.calls[0] as [string, { label: string; run: () => void }];
    act(() => action.run());
    expect(apiArchive).toHaveBeenCalledWith("c1", false);
    expect(result.current.lastArchived).toEqual([]);
  });

  it("keeps the last batch for Z to undo", () => {
    const { result } = makeArchive({ cards: [card({ id: "c1" }), card({ id: "c2" })] });
    act(() => result.current.archiveCards([card({ id: "c1" }), card({ id: "c2" })]));
    expect(result.current.lastArchived).toEqual(["c1", "c2"]);
  });
});
