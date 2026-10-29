// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "./types";

const mocks = vi.hoisted(() => ({ thread: vi.fn() }));
// mergeThread stays real: the merge is what this hook is being tested for.
vi.mock("./client", async (orig) => ({
  ...(await orig<typeof import("./client")>()),
  api: { thread: mocks.thread },
}));

import { useOpenCard } from "./use-open-card";

const item = (text: string): ThreadItem => ({ kind: "assistant", text, at: 0 });

// A hook with its own web-browser fallback, the board's pane setter.
function makeHook() {
  const setWebBrowserOpen = vi.fn<(open: boolean) => void>();
  const openPane = vi.fn<() => void>();
  const view = renderHook(() => useOpenCard({ setWebBrowserOpen, openPane }));
  return { ...view, setWebBrowserOpen, openPane };
}

beforeEach(() => {
  mocks.thread.mockReset();
  delete (window as { weft?: unknown }).weft;
});

afterEach(cleanup);

describe("useOpenCard", () => {
  it("starts closed, with an empty thread and nothing unseen", () => {
    const { result } = makeHook();
    expect(result.current.selectedId).toBeNull();
    expect(result.current.lastOpenId).toBeNull();
    expect(result.current.thread).toEqual([]);
    expect(result.current.streaming).toBe("");
    expect(result.current.renameId).toBeNull();
    expect(result.current.unseen.size).toBe(0);
    expect(result.current.selectedRef.current).toBeNull();
    expect(mocks.thread).not.toHaveBeenCalled();
  });

  it("select opens the card: it selects, remembers it, mirrors it, clears rename, unseen, thread and stream", async () => {
    const { result } = makeHook();
    act(() => {
      result.current.setRenameId("a");
      result.current.setUnseen(new Set(["a", "b"]));
      result.current.setThread([item("old")]);
      result.current.setStreaming("half a reply");
    });
    mocks.thread.mockResolvedValue({ items: [item("new")] });

    act(() => result.current.select("a"));
    await act(async () => {});

    expect(result.current.selectedId).toBe("a");
    expect(result.current.lastOpenId).toBe("a");
    expect(result.current.selectedRef.current).toBe("a");
    expect(result.current.renameId).toBeNull();
    expect([...result.current.unseen]).toEqual(["b"]);
    expect(result.current.streaming).toBe("");
    // The merge put the live item back on top of the fetched snapshot.
    expect(result.current.thread).toEqual([item("new")]);
    expect(mocks.thread).toHaveBeenCalledWith("a");
  });

  it("select leaves unseen as it is when the card wasn't unseen", () => {
    const { result } = makeHook();
    const unseen = new Set(["b"]);
    act(() => result.current.setUnseen(unseen));
    mocks.thread.mockResolvedValue({ items: [] });

    act(() => result.current.select("a"));

    expect(result.current.unseen).toBe(unseen);
  });

  it("select(null) closes the card and keeps the last one you opened", () => {
    const { result } = makeHook();
    mocks.thread.mockResolvedValue({ items: [] });
    act(() => result.current.select("a"));

    act(() => result.current.select(null));

    expect(result.current.selectedId).toBeNull();
    expect(result.current.lastOpenId).toBe("a");
    expect(result.current.selectedRef.current).toBeNull();
  });

  it("select shows the pane for every card, and hides it when the card closes", () => {
    const setVisible = vi.fn();
    (window as { weft?: unknown }).weft = { browser: { setVisible } };
    const { result } = makeHook();
    mocks.thread.mockResolvedValue({ items: [] });

    act(() => result.current.select("a"));
    expect(setVisible).toHaveBeenCalledTimes(1);
    // The card's id goes with the ask, so the shell makes this card's view and not the one that
    // happened to be active.
    expect(setVisible).toHaveBeenCalledWith(true, "a");

    // Another card: the pane is asked for again, so a pane closed earlier comes back.
    act(() => result.current.select("b"));
    expect(setVisible).toHaveBeenCalledTimes(2);
    expect(setVisible).toHaveBeenLastCalledWith(true, "b");

    act(() => result.current.select(null));
    expect(setVisible).toHaveBeenCalledTimes(3);
    expect(setVisible).toHaveBeenLastCalledWith(false, null);
  });

  it("select opens the pane's column for a card, and leaves it alone when the card closes", () => {
    const { result, openPane } = makeHook();
    mocks.thread.mockResolvedValue({ items: [] });

    act(() => result.current.select("a"));
    expect(openPane).toHaveBeenCalledTimes(1);

    act(() => result.current.select("b"));
    expect(openPane).toHaveBeenCalledTimes(2);

    // Closing the card doesn't close the column: it is the card that goes, not the pane.
    act(() => result.current.select(null));
    expect(openPane).toHaveBeenCalledTimes(2);
  });

  it("keeps select's identity across renders, so the effects that depend on it don't re-run", () => {
    // The board passes a useState setter and a fresh openPane arrow, so neither may change
    // select's identity — the effects that depend on it would re-subscribe on every render.
    const setWebBrowserOpen = vi.fn<(open: boolean) => void>();
    const openPane = vi.fn<() => void>();
    const { result, rerender } = renderHook(() => useOpenCard({ setWebBrowserOpen, openPane }));
    const first = result.current.select;
    rerender();
    expect(result.current.select).toBe(first);
  });

  it("select falls back to setWebBrowserOpen without the desktop bridge", () => {
    const { result, setWebBrowserOpen } = makeHook();
    mocks.thread.mockResolvedValue({ items: [] });

    act(() => result.current.select("a"));
    expect(setWebBrowserOpen).toHaveBeenCalledWith(true);

    act(() => result.current.select(null));
    expect(setWebBrowserOpen).toHaveBeenLastCalledWith(false);
  });

  it("loadThread replaces the thread without merge", async () => {
    const { result } = makeHook();
    act(() => {
      result.current.setSelectedId("a");
      result.current.setThread([item("live"), item("live 2")]);
    });
    mocks.thread.mockResolvedValue({ items: [item("snapshot")] });

    act(() => result.current.loadThread("a"));
    await act(async () => {});

    expect(mocks.thread).toHaveBeenCalledWith("a");
    expect(result.current.thread).toEqual([item("snapshot")]);
  });

  it("loadThread merges over the live items when asked", async () => {
    const { result } = makeHook();
    act(() => {
      result.current.setSelectedId("a");
      result.current.setThread([item("newer live"), item("live past the end")]);
    });
    mocks.thread.mockResolvedValue({ items: [item("snapshot"), item("snapshot 2")] });

    act(() => result.current.loadThread("a", { merge: true }));
    await act(async () => {});

    // The live items are newer than the snapshot, so they sit on top of it.
    expect(result.current.thread).toEqual([item("newer live"), item("live past the end")]);
  });

  it("loadThread ignores a reply for a card that is no longer open", async () => {
    const { result } = makeHook();
    act(() => {
      result.current.setSelectedId("b");
      result.current.setThread([item("shown")]);
    });
    mocks.thread.mockResolvedValue({ items: [item("stale")] });

    act(() => result.current.loadThread("a"));
    await act(async () => {});

    expect(mocks.thread).toHaveBeenCalledWith("a");
    expect(result.current.thread).toEqual([item("shown")]);
  });

  it("loadThread swallows a failed fetch", async () => {
    const { result } = makeHook();
    act(() => result.current.setSelectedId("a"));
    mocks.thread.mockRejectedValue(new Error("offline"));

    act(() => result.current.loadThread("a"));
    await act(async () => {});

    expect(result.current.thread).toEqual([]);
  });
});