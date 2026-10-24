// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportBreak = vi.fn(() => Promise.resolve({ card: null }));
vi.mock("./client", () => ({ api: { reportBreak } }));

const { reloadedFrom, useBreakReport } = await import("./use-break-report");
type BuildError = import("./build-error").BuildError;

const nav = (type: string) => vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type } as unknown as PerformanceEntry]);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  reportBreak.mockClear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reloadedFrom", () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it("answers when the page unloaded moments before a reload", () => {
    expect(reloadedFrom(store("1000"), "reload", 3000)).toBe(1000);
  });
  it("is null for a first load, a stale or missing stamp, or a clock that went back", () => {
    expect(reloadedFrom(store("1000"), "navigate", 3000)).toBeNull();
    expect(reloadedFrom(store("1000"), "reload", 100_000)).toBeNull();
    expect(reloadedFrom(store(null), "reload", 3000)).toBeNull();
    expect(reloadedFrom(store("5000"), "reload", 3000)).toBeNull();
  });
});

describe("useBreakReport", () => {
  it("reports a build error's file once", () => {
    nav("navigate");
    const first: { e: BuildError | null } = { e: { message: "m", file: "./a.ts (1:1)" } };
    const { rerender } = renderHook(({ e }) => useBreakReport(e), { initialProps: first });
    rerender({ e: { message: "m2", file: "./a.ts (1:1)" } });
    rerender({ e: null });
    rerender({ e: { message: "m", file: null } });
    expect(reportBreak).toHaveBeenCalledTimes(1);
    expect(reportBreak).toHaveBeenCalledWith({ kind: "build", file: "./a.ts (1:1)" });
  });

  it("reports a reload with when the page left, and stamps the next leave", () => {
    nav("reload");
    const left = Date.now() - 2000;
    sessionStorage.setItem("weft-left-at", String(left));
    const { unmount } = renderHook(() => useBreakReport(null));
    expect(reportBreak).toHaveBeenCalledWith({ kind: "reload", at: left });
    expect(sessionStorage.getItem("weft-left-at")).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(Number(sessionStorage.getItem("weft-left-at"))).toBeGreaterThan(0);
    unmount();
  });

  it("shrugs off a report the server can't take", async () => {
    nav("reload");
    sessionStorage.setItem("weft-left-at", String(Date.now()));
    reportBreak.mockRejectedValueOnce(new Error("403")).mockRejectedValueOnce(new Error("403"));
    renderHook(() => useBreakReport({ message: "m", file: "./a.ts" }));
    await Promise.resolve();
    expect(reportBreak).toHaveBeenCalledTimes(2);
  });

  it("does nothing outside dev mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    nav("reload");
    sessionStorage.setItem("weft-left-at", String(Date.now()));
    renderHook(() => useBreakReport({ message: "m", file: "./a.ts" }));
    expect(reportBreak).not.toHaveBeenCalled();
  });
});
