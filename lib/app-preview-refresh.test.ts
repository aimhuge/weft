// lib/app-preview-refresh.ts: the timer that keeps every shared mini app's link preview current without anyone
// opening the Share dialog. It walks the apps that have a share and makes each stale preview again, one at a time.
//
// The mini app store and the timer plumbing are mocked: the apps come from a fixture list, and the singleton that
// holds the timers is a fresh one per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  apps: [] as { id: string; share?: { id?: string } }[],
  timers: [] as ReturnType<typeof setTimeout>[],
  cleared: [] as unknown[],
}));

vi.mock("./mini-app-store", () => ({
  listApps: () => state.apps,
}));

vi.mock("./global-singleton", () => ({
  // A real singleton per test: the guard that stops a second timer depends on it keeping its timers.
  globalSingleton: <T>(key: string, init: () => T) => {
    const g = globalThis as unknown as Record<string, T | undefined>;
    return (g[key] ??= init());
  },
}));

// The share's own refresh, imported lazily by the default refresher.
vi.mock("./app-share-preview-actions", () => ({
  refreshIfStale: vi.fn(() => Promise.resolve()),
}));

const { refreshSharedPreviews, startPreviewRefresh, FIRST_REFRESH_MS, REFRESH_MS } = await import("./app-preview-refresh");

beforeEach(() => {
  state.apps = [];
  state.timers = [];
  state.cleared = [];
  // The singleton holds the live timers; each test starts with a fresh one.
  delete (globalThis as unknown as Record<string, unknown>).__weftPreviewRefresh;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshSharedPreviews", () => {
  it("refreshes only the apps that have a share", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }, { id: "a2" }, { id: "a3", share: { id: "s3" } }];
    const seen: string[] = [];
    const done = await refreshSharedPreviews((id) => {
      seen.push(id);
      return Promise.resolve();
    });
    expect(seen).toEqual(["a1", "a3"]);
    expect(done).toBe(2);
  });

  it("skips an app that can't refresh, and keeps going with the rest", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }, { id: "a2", share: { id: "s2" } }, { id: "a3", share: { id: "s3" } }];
    const seen: string[] = [];
    const done = await refreshSharedPreviews((id) => {
      seen.push(id);
      if (id === "a2") return Promise.reject(new Error("signed out"));
      return Promise.resolve();
    });
    expect(seen).toEqual(["a1", "a2", "a3"]);
    expect(done).toBe(2);
  });

  it("does nothing when no app is shared", async () => {
    state.apps = [{ id: "a1" }];
    const done = await refreshSharedPreviews(() => {
      return Promise.reject(new Error("should not be called"));
    });
    expect(done).toBe(0);
  });

  it("refreshes through the share's own refresher when none is given", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    const { refreshIfStale } = await import("./app-share-preview-actions");
    vi.mocked(refreshIfStale).mockClear();
    const done = await refreshSharedPreviews();
    expect(vi.mocked(refreshIfStale)).toHaveBeenCalledWith("a1");
    expect(done).toBe(1);
  });
});

describe("startPreviewRefresh", () => {
  it("refreshes after FIRST_REFRESH_MS, then every REFRESH_MS", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    let calls = 0;
    startPreviewRefresh(() => {
      calls += 1;
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(FIRST_REFRESH_MS);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(calls).toBe(2);
  });

  it("starts only once, however many times it's called", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    let calls = 0;
    startPreviewRefresh(() => {
      calls += 1;
      return Promise.resolve();
    });
    startPreviewRefresh(() => {
      calls += 1;
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(FIRST_REFRESH_MS);
    expect(calls).toBe(1);
  });

  it("doesn't run two ticks at once", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    let running = 0;
    let calls = 0;
    startPreviewRefresh(() => {
      calls += 1;
      running += 1;
      expect(running).toBe(1);
      running -= 1;
      return Promise.resolve();
    });
    // Two ticks land on the same moment: the second waits for the first.
    await vi.advanceTimersByTimeAsync(FIRST_REFRESH_MS);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(calls).toBe(2);
  });

  it("skips a tick that lands while the last refresh is still running", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    startPreviewRefresh(async () => {
      calls += 1;
      await held;
    });
    // The first tick starts and stays running; the next one lands before it finishes.
    await vi.advanceTimersByTimeAsync(FIRST_REFRESH_MS);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    // The next tick after the first finished runs again.
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(calls).toBe(2);
  });

  it("stops the timers when the returned function is called", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    let calls = 0;
    const stop = startPreviewRefresh(() => {
      calls += 1;
      return Promise.resolve();
    });
    stop();
    await vi.advanceTimersByTimeAsync(FIRST_REFRESH_MS + REFRESH_MS);
    expect(calls).toBe(0);
  });

  it("hands the second caller a stop that clears the timers too", async () => {
    state.apps = [{ id: "a1", share: { id: "s1" } }];
    let calls = 0;
    const refresh = () => {
      calls += 1;
      return Promise.resolve();
    };
    startPreviewRefresh(refresh);
    const secondStop = startPreviewRefresh(refresh);
    // The second caller's teardown has to clear the timers the first caller started.
    secondStop();
    await vi.advanceTimersByTimeAsync(FIRST_REFRESH_MS + REFRESH_MS);
    expect(calls).toBe(0);
  });
});
