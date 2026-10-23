// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoutState } from "./scout-view";
import { POLL_MS, useScout } from "./use-scout";

const idle: ScoutState = { report: null, running: false };
const busy: ScoutState = { report: null, running: true };

let reply: ScoutState | null | undefined;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
  Promise.resolve({ json: () => Promise.resolve(reply === undefined ? {} : { scout: reply }) } as Response),
);

beforeEach(() => {
  reply = idle;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useScout", () => {
  it("reads nothing without a folder, and posts nothing", () => {
    const { result } = renderHook(() => useScout(null));
    expect(result.current.scout).toBeNull();
    result.current.rescout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the folder's scout, and again on focus", async () => {
    const { result } = renderHook(() => useScout("/p q"));
    await waitFor(() => expect(result.current.scout).toEqual(idle));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/scout?cwd=%2Fp%20q");
    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads a missing scout as null and ignores failed reads", async () => {
    reply = undefined;
    const { result } = renderHook(() => useScout("/p"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.scout).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    window.dispatchEvent(new Event("focus"));
    await act(async () => {});
    expect(result.current.scout).toBeNull();
  });

  it("hides another folder's scout and drops a read that lands after unmount", async () => {
    const { result, rerender, unmount } = renderHook(({ cwd }) => useScout(cwd), { initialProps: { cwd: "/a" } });
    await waitFor(() => expect(result.current.scout).toEqual(idle));
    reply = busy;
    rerender({ cwd: "/b" });
    expect(result.current.scout).toBeNull();
    unmount();
    await act(async () => {});
  });

  it("polls while a run is going, and stops when it ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    reply = busy;
    const { result } = renderHook(() => useScout("/p"));
    await waitFor(() => expect(result.current.scout?.running).toBe(true));
    const before = fetchMock.mock.calls.length;
    reply = idle;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(result.current.scout?.running).toBe(false);
    const after = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  it("re-scouts and marks a finding started with a guarded POST, showing the answer", async () => {
    const { result } = renderHook(() => useScout("/p"));
    await waitFor(() => expect(result.current.scout).toEqual(idle));
    reply = busy;
    act(() => result.current.rescout());
    await waitFor(() => expect(result.current.scout).toEqual(busy));
    expect(fetchMock).toHaveBeenCalledWith("/api/scout", {
      method: "POST",
      headers: { "content-type": "application/json", "x-weft-token": "1" },
      body: JSON.stringify({ cwd: "/p" }),
    });
    act(() => result.current.started("f1"));
    const bodies = () => fetchMock.mock.calls.map((c) => c[1]?.body);
    await waitFor(() => expect(bodies()).toContain(JSON.stringify({ cwd: "/p", started: "f1" })));
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    act(() => result.current.rescout());
    await act(async () => {});
  });
});
