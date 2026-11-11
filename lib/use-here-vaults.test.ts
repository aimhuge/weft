// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api: { settings } }));

import { useHereVaults } from "./use-here-vaults";

const w = window as unknown as { weft?: unknown };
afterEach(() => {
  delete w.weft;
  vi.clearAllMocks();
});

describe("useHereVaults", () => {
  it("is empty with no bridge (a plain browser)", () => {
    const { result } = renderHook(() => useHereVaults(true));
    expect(result.current.bridge).toBeNull();
    expect(result.current.byRepo.size).toBe(0);
    expect(settings).not.toHaveBeenCalled();
  });

  it("maps this Mac's vaults by repo, first folder wins, and loads again on reload", async () => {
    const overview = vi.fn().mockResolvedValue({
      vaults: [
        { id: "github:a/b", folder: "/one" },
        { id: "github:a/b", folder: "/two" },
        { id: "folder:/x", folder: "/x" },
      ],
    });
    w.weft = { vault: { overview } };
    settings.mockResolvedValue({ projects: [{ path: "/one" }, { path: "/two" }] });
    const { result } = renderHook(() => useHereVaults(true));
    await waitFor(() => expect(result.current.byRepo.get("a/b")?.folder).toBe("/one"));
    expect(result.current.byRepo.size).toBe(1);
    expect(overview).toHaveBeenCalledWith(["/one", "/two"]);
    act(() => result.current.reload());
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(2));
  });

  it("drops an answer that lands after unmount", async () => {
    let answer: (v: unknown) => void = () => {};
    w.weft = { vault: { overview: vi.fn(() => new Promise((r) => (answer = r))) } };
    settings.mockResolvedValue({ projects: [] });
    const { unmount } = renderHook(() => useHereVaults(true));
    await waitFor(() => expect(settings).toHaveBeenCalled());
    unmount();
    answer({ vaults: [] });
    let fail: (e: unknown) => void = () => {};
    w.weft = { vault: { overview: vi.fn(() => new Promise((_, r) => (fail = r))) } };
    const second = renderHook(() => useHereVaults(true));
    await waitFor(() => expect(settings).toHaveBeenCalledTimes(2));
    second.unmount();
    fail(new Error("late"));
  });

  it("is empty when the load fails, and idle while inactive", async () => {
    w.weft = { vault: { overview: vi.fn().mockRejectedValue(new Error("locked")) } };
    settings.mockResolvedValue({ projects: [] });
    const { result } = renderHook(() => useHereVaults(true));
    await waitFor(() => expect(settings).toHaveBeenCalled());
    expect(result.current.byRepo.size).toBe(0);
    settings.mockClear();
    const { unmount } = renderHook(() => useHereVaults(false));
    expect(settings).not.toHaveBeenCalled();
    unmount();
  });
});
