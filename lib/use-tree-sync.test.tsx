// @vitest-environment jsdom
// The board keeps each synced folder's pipe while it's open (lib/use-tree-sync.ts): only in Weft's own window, reloaded
// whenever "Keep in Sync with <worker>" changes the list.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => ({ stop: vi.fn(), keepSynced: vi.fn(), realPipeDeps: vi.fn(() => ({ deps: true })) }));
vi.mock("./line-tree-sync", () => ({ keepSynced: sync.keepSynced, realPipeDeps: sync.realPipeDeps }));

const { useTreeSync } = await import("./use-tree-sync");
const { TREE_SYNC_CHANGED } = await import("./tree-sync-menu");

const A = { workerId: "w1", folder: "weft" };
const B = { workerId: "w1", folder: "ling" };
const win = window as unknown as { weft?: unknown };

afterEach(() => {
  vi.unstubAllGlobals();
  delete win.weft;
  vi.clearAllMocks();
});

describe("useTreeSync", () => {
  it("loads nothing outside Weft's own window", () => {
    const load = vi.fn(() => Promise.resolve([A]));
    renderHook(() => useTreeSync(load));
    expect(load).not.toHaveBeenCalled();
    expect(sync.keepSynced).not.toHaveBeenCalled();
  });

  it("loads nothing without WebRTC", () => {
    win.weft = {};
    vi.stubGlobal("RTCPeerConnection", undefined);
    const load = vi.fn(() => Promise.resolve([A]));
    renderHook(() => useTreeSync(load));
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps the loaded folders synced, again on a change, and lets go on unmount", async () => {
    win.weft = {};
    vi.stubGlobal("RTCPeerConnection", vi.fn());
    sync.keepSynced.mockReturnValue(sync.stop);
    const load = vi.fn().mockResolvedValueOnce([A]).mockResolvedValue([A, B]);
    const { unmount } = renderHook(() => useTreeSync(load));
    await waitFor(() => expect(sync.keepSynced).toHaveBeenCalledWith([A], { deps: true }));
    act(() => void window.dispatchEvent(new Event(TREE_SYNC_CHANGED)));
    await waitFor(() => expect(sync.keepSynced).toHaveBeenCalledWith([A, B], { deps: true }));
    expect(sync.stop).toHaveBeenCalledTimes(1);
    unmount();
    expect(sync.stop).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event(TREE_SYNC_CHANGED));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("starts nothing for an empty list, and ignores a load that lands after unmount", async () => {
    win.weft = {};
    vi.stubGlobal("RTCPeerConnection", vi.fn());
    let resolve: (t: (typeof A)[]) => void = () => {};
    const load = vi.fn().mockResolvedValueOnce([]).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = renderHook(() => useTreeSync(load));
    await waitFor(() => expect(load).toHaveBeenCalled());
    act(() => void window.dispatchEvent(new Event(TREE_SYNC_CHANGED)));
    unmount();
    await act(() => {
      resolve([A]);
      return Promise.resolve();
    });
    expect(sync.keepSynced).not.toHaveBeenCalled();
  });
});
