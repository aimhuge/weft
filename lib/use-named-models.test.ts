// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamedModels, resetNamedModels, useNamedModels } from "./use-named-models";

const NAMED = [
  { id: "gpt-5", name: "The one I like" },
  { id: "claude-sonnet-4-5", name: "Sonnet" },
];

function respond(body: unknown, ok = true) {
  return vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));
}

beforeEach(() => {
  resetNamedModels();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useNamedModels", () => {
  it("reads the named models from /api/settings with the board's token", async () => {
    const fetch = respond({ gooseNamedModels: NAMED });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useNamedModels());
    await waitFor(() => expect(result.current).toEqual(NAMED));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(new Headers(init.headers).get("x-weft-token")).toBe("1");
  });

  it("asks only once, however many hooks are on screen", async () => {
    const fetch = respond({ gooseNamedModels: NAMED });
    vi.stubGlobal("fetch", fetch);
    renderHook(() => useNamedModels());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    renderHook(() => useNamedModels());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows no names where the route refuses or fails", async () => {
    const refused = respond({}, false);
    vi.stubGlobal("fetch", refused);
    const { result } = renderHook(() => useNamedModels());
    await waitFor(() => expect(refused).toHaveBeenCalled());
    expect(result.current).toEqual([]);

    resetNamedModels();
    const broken = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", broken);
    const again = renderHook(() => useNamedModels());
    await waitFor(() => expect(broken).toHaveBeenCalled());
    expect(again.result.current).toEqual([]);
  });

  it("shows no names when the settings carry none", async () => {
    vi.stubGlobal("fetch", respond({ threadPrompt: "be nice" }));
    const { result } = renderHook(() => useNamedModels());
    await waitFor(() => expect(result.current).toEqual([]));
  });
});

describe("loadNamedModels", () => {
  it("publishes what the route sent, and the listeners hear it", async () => {
    const fetch = respond({ gooseNamedModels: NAMED });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useNamedModels());
    await waitFor(() => expect(result.current).toEqual(NAMED));
    // A second load replaces the names.
    fetch.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ gooseNamedModels: [] }) } as Response));
    await loadNamedModels();
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
