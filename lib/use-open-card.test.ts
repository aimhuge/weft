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
  const view = renderHook(() => useOpenCard({ setWebBrowserOpen }));
  return { ...view, setWebBrowserOpen };
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

  it("select toggles the pane only crossing between no card and a card", () => {
    const setVisible = vi.fn();
    (window as { weft?: unknown }).weft = { browser: { setVisible } };
    const { result } = makeHook();
    mocks.thread.mockResolvedValue({ items: [] });

    act(() => result.current.select("a"));
    expect(setVisible).toHaveBeenCalledTimes(1);
    expect(setVisible).toHaveBeenCalledWith(true);

    // Another card, no crossing: the pane is already out.
    act(() => result.current.select("b"));
    expect(setVisible).toHaveBeenCalledTimes(1);

    act(() => result.current.select(null));
    expect(setVisible).toHaveBeenCalledTimes(2);
    expect(setVisible).toHaveBeenLastCalledWith(false);
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