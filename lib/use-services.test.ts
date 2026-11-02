// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceEntry } from "./types";

const api = vi.hoisted(() => ({ services: vi.fn(), serviceAction: vi.fn() }));
vi.mock("./client", () => ({ api }));

const { IDLE_POLL_MS, useServices } = await import("./use-services");
const prefs = await import("./services-prefs");

const svc: ServiceEntry = {
  id: "cli:c1",
  kind: "cli",
  label: "Claude",
  state: "running",
  cpu: 1.2,
  memKb: 4096,
  startedAt: 0,
  procs: [{ pid: 100, ppid: 1, cpu: 1.2, memKb: 4096, command: "claude" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the cookie between tests so REFRESH_CHOICES-driven re-renders don't leak.
  document.cookie = "weft-services-refresh=; path=/; max-age=0";
  api.services.mockResolvedValue({ services: [svc] });
  api.serviceAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.cookie = "weft-services-refresh=; path=/; max-age=0";
});

describe("useServices", () => {
  it("loads the list, and again on focus", async () => {
    const { result } = renderHook(() => useServices());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.services).toEqual([svc]);
    expect(result.current.workers).toEqual([]);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(api.services).toHaveBeenCalledTimes(2));
  });

  it("keeps the workers' dev servers the list brought", async () => {
    const workers = [{ workerId: "w1", worker: "m1mini", servers: [] }];
    api.services.mockResolvedValue({ services: [svc], workers });
    const { result } = renderHook(() => useServices());
    await waitFor(() => expect(result.current.workers).toEqual(workers));
  });

  it("polls at IDLE_POLL_MS while closed, and at the open-drawer rate while open", async () => {
    vi.useFakeTimers();
    // While closed, IDLE_POLL_MS is the only cadence.
    const { rerender } = renderHook(({ active }) => useServices(active), { initialProps: { active: false } });
    await act(() => Promise.resolve());
    expect(api.services).toHaveBeenCalledTimes(1);
    await act(() => {
      vi.advanceTimersByTime(IDLE_POLL_MS - 1);
      return Promise.resolve();
    });
    expect(api.services).toHaveBeenCalledTimes(1);
    await act(() => {
      vi.advanceTimersByTime(1);
      return Promise.resolve();
    });
    expect(api.services).toHaveBeenCalledTimes(2);
    // Open the drawer: the effect re-runs (one immediate call) and starts the prefs-driven rate (2000ms).
    rerender({ active: true });
    expect(api.services).toHaveBeenCalledTimes(3);
    await act(() => {
      vi.advanceTimersByTime(2_000);
      return Promise.resolve();
    });
    expect(api.services).toHaveBeenCalledTimes(4);
  });

  it("treats refreshMs = 0 as paused: the initial load still runs, the interval does not", async () => {
    vi.useFakeTimers();
    document.cookie = "weft-services-refresh=0; path=/";
    const { result } = renderHook(() => useServices(true));
    await act(() => Promise.resolve());
    expect(result.current.refreshMs).toBe(0);
    expect(api.services).toHaveBeenCalledTimes(1);
    await act(() => {
      vi.advanceTimersByTime(60_000);
      return Promise.resolve();
    });
    expect(api.services).toHaveBeenCalledTimes(1);
  });

  it("re-reads refreshMs when the prefs event fires", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useServices(true));
    await act(() => Promise.resolve());
    expect(result.current.refreshMs).toBe(prefs.DEFAULT_REFRESH_MS);
    document.cookie = "weft-services-refresh=5000; path=/";
    await act(() => {
      window.dispatchEvent(new Event("weft-services-refresh"));
      return Promise.resolve();
    });
    expect(result.current.refreshMs).toBe(5_000);
  });

  it("keeps the last list and says what went wrong; a stale answer is dropped", async () => {
    const { result } = renderHook(() => useServices());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    api.services.mockRejectedValueOnce(new Error("down"));
    await act(() => result.current.reload());
    expect(result.current.error).toBe("down");
    expect(result.current.services).toEqual([svc]);
    api.services.mockRejectedValueOnce("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBe("plain");
    // Slow then fast: the slow resolution must be discarded, the fast error kept.
    let release!: (v: unknown) => void;
    api.services.mockReturnValueOnce(new Promise((r) => (release = r))).mockRejectedValueOnce(new Error("newer"));
    await act(async () => {
      const slow = result.current.reload();
      await result.current.reload();
      release({ services: [] });
      await slow;
    });
    expect(result.current.services).toEqual([svc]);
    expect(result.current.error).toBe("newer");
    // Slow then fast: a stale error must be dropped, the fresh success must clear the error.
    api.services.mockReturnValueOnce(new Promise((_, r) => (release = r))).mockResolvedValueOnce({ services: [svc] });
    await act(async () => {
      const slow = result.current.reload();
      await result.current.reload();
      release(new Error("old"));
      await slow.catch(() => {});
    });
    expect(result.current.error).toBeNull();
  });

  it("kills by id, kills by pid, restarts by id, and reloads after each", async () => {
    const { result } = renderHook(() => useServices());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => result.current.kill({ id: "cli:c1" }));
    expect(api.serviceAction).toHaveBeenCalledWith({ action: "kill", id: "cli:c1" });
    await act(() => result.current.kill({ pid: 100 }));
    expect(api.serviceAction).toHaveBeenLastCalledWith({ action: "kill", pid: 100 });
    await act(() => result.current.restart("dev:c1"));
    expect(api.serviceAction).toHaveBeenLastCalledWith({ action: "restart", id: "dev:c1" });
    // One call per action, then a reload; three actions = three reloads.
    expect(api.services).toHaveBeenCalledTimes(4);
  });
});
