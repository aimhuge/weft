// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSyncStatus } from "./cloud-sync-view";

const api = vi.hoisted(() => ({
  cloudSync: vi.fn(),
  cloudSyncSetFolder: vi.fn(),
  cloudSyncNow: vi.fn(),
}));
vi.mock("./client", () => ({ api }));

const { POLL_MS, useCloudSync } = await import("./use-cloud-sync");

const EMPTY: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const STATUS: CloudSyncStatus = { waiting: 2, lastSyncAt: 1000, uploaded: 5, lastError: null, signedOut: false, noWorkspace: false };
const SIGNED_OUT: CloudSyncStatus = { ...EMPTY, signedOut: true };

beforeEach(() => {
  vi.clearAllMocks();
  api.cloudSync.mockResolvedValue({ folders: ["/a"], status: STATUS });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCloudSync", () => {
  it("starts with the empty status, then loads folders and status from the server", async () => {
    const { result } = renderHook(() => useCloudSync());
    expect(result.current.folders).toEqual([]);
    expect(result.current.status).toEqual(EMPTY);
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.folders).toEqual(["/a"]));
    expect(result.current.status).toEqual(STATUS);
    expect(api.cloudSync).toHaveBeenCalledTimes(1);
  });

  it("reloads on window focus", async () => {
    renderHook(() => useCloudSync());
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalledTimes(1));
    await act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalledTimes(2));
  });

  it("reports errors from the initial load and clears them on the next answer", async () => {
    api.cloudSync.mockRejectedValueOnce(new Error("Server down"));
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.error).toBe("Server down"));
    api.cloudSync.mockRejectedValueOnce("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBe("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
  });

  it("polls only while active", async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ active }) => useCloudSync(active), { initialProps: { active: false } });
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.cloudSync).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    const before = api.cloudSync.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.cloudSync.mock.calls.length).toBe(before + 2);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.cloudSync.mock.calls.length).toBe(before + 2);
  });

  it("drops an answer that arrives after a newer fetch started", async () => {
    let slow: (v: unknown) => void = () => undefined;
    api.cloudSync.mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));
    const { result } = renderHook(() => useCloudSync());
    api.cloudSync.mockResolvedValueOnce({ folders: ["/fresh"], status: STATUS });
    await act(() => result.current.reload());
    expect(result.current.folders).toEqual(["/fresh"]);
    act(() => slow({ folders: ["/stale"], status: STATUS }));
    await act(() => Promise.resolve());
    expect(result.current.folders).toEqual(["/fresh"]);
  });

  it("setFolder posts the change and applies the server's folders + status", async () => {
    api.cloudSyncSetFolder.mockResolvedValueOnce({ folder: "/b", on: true, folders: ["/a", "/b"], status: SIGNED_OUT });
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.folders).toEqual(["/a"]));
    await act(() => result.current.setFolder("/b", true));
    expect(api.cloudSyncSetFolder).toHaveBeenCalledWith("/b", true);
    expect(result.current.folders).toEqual(["/a", "/b"]);
    expect(result.current.status.signedOut).toBe(true);
  });

  it("adds a folder to the list at once, before the server answers", async () => {
    let answer: (v: unknown) => void = () => undefined;
    api.cloudSyncSetFolder.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.folders).toEqual(["/a"]));
    act(() => {
      void result.current.setFolder("/b", true);
    });
    // The switch is already on while the call is still waiting.
    expect(result.current.folders).toEqual(["/a", "/b"]);
    await act(async () => {
      answer({ folders: ["/a", "/b"], status: STATUS });
      await Promise.resolve();
    });
    expect(result.current.folders).toEqual(["/a", "/b"]);
  });

  it("takes a folder off the list at once, before the server answers", async () => {
    let answer: (v: unknown) => void = () => undefined;
    api.cloudSyncSetFolder.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.folders).toEqual(["/a"]));
    act(() => {
      void result.current.setFolder("/a", false);
    });
    // The folder is gone while the call is still waiting.
    expect(result.current.folders).toEqual([]);
    await act(async () => {
      answer({ folders: [], status: STATUS });
      await Promise.resolve();
    });
    expect(result.current.folders).toEqual([]);
  });

  it("reloads what the server has when a folder can't be set, and says why", async () => {
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.folders).toEqual(["/a"]));
    expect(api.cloudSync).toHaveBeenCalledTimes(1);
    api.cloudSyncSetFolder.mockRejectedValueOnce(new Error("nope"));
    await act(() => expect(result.current.setFolder("/b", true)).rejects.toThrow("nope"));
    // The refusal asks the server what it has.
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalledTimes(2));
    expect(result.current.folders).toEqual(["/a"]);
  });

  it("syncNow posts { sync: true } and applies the returned status", async () => {
    api.cloudSyncNow.mockResolvedValueOnce({ status: { ...STATUS, waiting: 0 } });
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.folders).toEqual(["/a"]));
    await act(() => result.current.syncNow());
    expect(api.cloudSyncNow).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual({ ...STATUS, waiting: 0 });
  });
});
