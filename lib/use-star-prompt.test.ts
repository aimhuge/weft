// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markStarAsked, STAR_PROMPT_AFTER, STAR_PROMPT_KEY, STAR_SNOOZE_MS } from "./star-prompt";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

const others = vi.hoisted(() => ({ sync: false, phone: false, splash: false }));
vi.mock("./use-sync-prompt", () => ({ syncAskedThisLaunch: () => others.sync }));
vi.mock("./use-testflight", () => ({ phoneOfferedThisLaunch: () => others.phone }));
vi.mock("./use-release-splash", () => ({ splashShownThisLaunch: () => others.splash }));

const welcome = vi.hoisted(() => ({ loadWelcome: vi.fn() }));
vi.mock("./welcome-client", () => welcome);

const { loadStarred, starWeft, useStarPrompt } = await import("./use-star-prompt");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const serve = (r: Response | Error) =>
  apiFetch.mockImplementation(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r.clone())));

const N = STAR_PROMPT_AFTER;

function reset() {
  vi.clearAllMocks();
  localStorage.clear();
  markStarAsked(false);
  Object.assign(others, { sync: false, phone: false, splash: false });
  welcome.loadWelcome.mockResolvedValue({ welcome: true });
  serve(json({ starred: false }));
}

beforeEach(reset);

describe("loadStarred", () => {
  it("reads the route", async () => {
    expect(await loadStarred()).toBe(false);
    expect(apiFetch).toHaveBeenCalledWith("/api/star");
  });

  it("is null when gh can't tell or the fetch fails", async () => {
    for (const r of [json({ starred: null }), json({}), json({}, 500), new Error("down")]) {
      serve(r);
      expect(await loadStarred()).toBeNull();
    }
  });
});

describe("starWeft", () => {
  it("POSTs and returns whether it starred", async () => {
    serve(json({ ok: true }));
    expect(await starWeft()).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith("/api/star", { method: "POST" });
  });

  it("is false on a failed answer or fetch", async () => {
    for (const r of [json({ ok: false }), json({}, 500), new Error("down")]) {
      serve(r);
      expect(await starWeft()).toBe(false);
    }
  });
});

describe("useStarPrompt", () => {
  it("opens with one-click starring once enough threads have finished", async () => {
    const { result } = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(result.current.open).toEqual({ gh: true }));
  });

  it("opens with the page instead when gh can't tell", async () => {
    serve(json({ starred: null }));
    const { result } = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(result.current.open).toEqual({ gh: false }));
  });

  it("never asks someone who already starred, and remembers it", async () => {
    serve(json({ starred: true }));
    const { result } = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(localStorage.getItem(STAR_PROMPT_KEY)).toBe("done"));
    expect(result.current.open).toBeNull();
  });

  it("Later snoozes it, Don't ask ends it", async () => {
    const now = Date.now();
    const first = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(first.result.current.open).not.toBeNull());
    act(() => first.result.current.later());
    expect(first.result.current.open).toBeNull();
    expect(Number(localStorage.getItem(STAR_PROMPT_KEY))).toBeGreaterThanOrEqual(now + STAR_SNOOZE_MS);

    reset();
    const second = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(second.result.current.open).not.toBeNull());
    act(() => second.result.current.done());
    expect(second.result.current.open).toBeNull();
    expect(localStorage.getItem(STAR_PROMPT_KEY)).toBe("done");
  });

  it("asks once a launch", async () => {
    const first = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(first.result.current.open).not.toBeNull());
    first.unmount();
    localStorage.clear();
    apiFetch.mockClear();
    const second = renderHook(() => useStarPrompt(N));
    await act(async () => {});
    expect(second.result.current.open).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches nothing until the cheap local checks pass", async () => {
    const cases: Array<() => void> = [
      () => localStorage.setItem(STAR_PROMPT_KEY, "done"),
      () => (others.sync = true),
      () => (others.phone = true),
      () => (others.splash = true),
    ];
    for (const arrange of cases) {
      reset();
      arrange();
      const { result, unmount } = renderHook(() => useStarPrompt(N));
      await act(async () => {});
      expect(result.current.open).toBeNull();
      expect(apiFetch).not.toHaveBeenCalled();
      unmount();
    }
    reset();
    const { result } = renderHook(() => useStarPrompt(N - 1));
    await act(async () => {});
    expect(result.current.open).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("stays closed when not welcomed, or another dialog opened while it read", async () => {
    welcome.loadWelcome.mockResolvedValue({ welcome: false });
    const a = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await act(async () => {});
    expect(a.result.current.open).toBeNull();
    a.unmount();

    reset();
    welcome.loadWelcome.mockImplementation(() => {
      others.phone = true;
      return Promise.resolve({ welcome: true });
    });
    const b = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await act(async () => {});
    expect(b.result.current.open).toBeNull();
  });

  it("does nothing after unmounting mid-read, or once another mount asked", async () => {
    const a = renderHook(() => useStarPrompt(N));
    a.unmount();
    await act(async () => {});
    expect(a.result.current.open).toBeNull();

    reset();
    welcome.loadWelcome.mockImplementation(() => {
      markStarAsked();
      return Promise.resolve({ welcome: true });
    });
    const b = renderHook(() => useStarPrompt(N));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await act(async () => {});
    expect(b.result.current.open).toBeNull();
  });

  it("swallows a failing welcome read", async () => {
    welcome.loadWelcome.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStarPrompt(N));
    await act(async () => {});
    expect(result.current.open).toBeNull();
  });
});
