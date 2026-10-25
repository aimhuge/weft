// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVercelDrift } from "./use-vercel-drift";

// The rail's drift: asked of main for the board's folders, again on focus and when main says a fetch landed.

const DRIFT = [{ folder: "/web", label: "o/web", project: "web", rows: [] }];

function bridge(over: Record<string, unknown> = {}) {
  let ping: (folder: string) => void = () => undefined;
  const stop = vi.fn();
  const b = {
    envDrift: vi.fn(() => Promise.resolve(DRIFT)),
    onDrift: vi.fn((cb: (folder: string) => void) => ((ping = cb), stop)),
    ...over,
  };
  (window as unknown as { weft: unknown }).weft = { vercel: b };
  return { b, stop, ping: (f: string) => ping(f) };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("useVercelDrift", () => {
  it("asks for the folders, again on focus and on main's word, and stops listening on unmount", async () => {
    const { b, stop, ping } = bridge();
    const { result, unmount } = renderHook(() => useVercelDrift(["/web", "/api"], "k"));
    await waitFor(() => expect(result.current).toEqual(DRIFT));
    expect(b.envDrift).toHaveBeenCalledWith(["/web", "/api"]);
    act(() => void window.dispatchEvent(new Event("focus")));
    act(() => ping("/web"));
    await waitFor(() => expect(b.envDrift).toHaveBeenCalledTimes(3));
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("empties on a failed ask", async () => {
    const { b } = bridge({ envDrift: vi.fn(() => Promise.reject(new Error("down"))), onDrift: undefined });
    const { result } = renderHook(() => useVercelDrift(["/web"], "k"));
    await waitFor(() => expect(b.envDrift).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("asks nothing with no folders or an older main", () => {
    const { b } = bridge();
    renderHook(() => useVercelDrift([], "k"));
    expect(b.envDrift).not.toHaveBeenCalled();
    (window as unknown as { weft: unknown }).weft = { vercel: {} };
    const { result } = renderHook(() => useVercelDrift(["/web"], "k"));
    expect(result.current).toEqual([]);
  });
});
