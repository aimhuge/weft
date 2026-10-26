// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSkill, SkillReviewState, SkillScan } from "./types";

const registry = vi.hoisted(() => ({
  search: vi.fn<(q: string, cwd?: string, signal?: AbortSignal) => Promise<{ skills: RemoteSkill[] }>>(),
  scans: vi.fn<(cwd?: string) => Promise<{ scans: Record<string, SkillScan> }>>(),
  review: vi.fn<(where: unknown) => Promise<SkillReviewState>>(),
  reviewState: vi.fn<(where: unknown) => Promise<SkillReviewState>>(),
}));
vi.mock("./skill-registry-client", () => ({ skillRegistry: registry }));

const pane = vi.hoisted(() => ({ openInPane: vi.fn<(url: string) => void>() }));
vi.mock("./open-in-pane", () => pane);

import type { ReviewWhere } from "./skill-registry-client";
import { fileUrl, openLocalReview, useLibraryScans, useSkillReview, useSkillSearch } from "./use-skill-search";

const skill = (name: string): RemoteSkill => ({
  id: `owner/repo/${name}`, source: "owner/repo", name, installs: 1, installed: false,
});

const scan: SkillScan = {
  verdict: "clean", findings: [], license: { spdx: "MIT", kind: "permissive", file: "LICENSE" },
  hosts: [], files: 1, bytes: 10,
};

const RUNNING: SkillReviewState = { status: "running", page: "/tmp/review.html" };
const DONE: SkillReviewState = {
  status: "done",
  page: "/tmp/review.html",
  review: {
    verdict: "safe", summary: "fine", whatItDoes: "nothing", concerns: [], falsePositives: [],
    dataFlow: "none", license: "MIT", recommendation: "ok", model: "test", reviewedAt: "2026-01-01",
  },
};

beforeEach(() => {
  registry.search.mockReset().mockResolvedValue({ skills: [] });
  registry.scans.mockReset().mockResolvedValue({ scans: {} });
  registry.review.mockReset().mockResolvedValue({ status: "none" });
  registry.reviewState.mockReset().mockResolvedValue({ status: "none" });
  pane.openInPane.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Runs the clock forward and lets the promises it started settle.
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("useSkillSearch", () => {
  it("does nothing for a query under two characters", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSkillSearch("a", "/proj"));
    expect(result.current.skills).toEqual([]);
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(registry.search).not.toHaveBeenCalled();
  });

  it("trims the query and ignores a whitespace-only one", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSkillSearch("   ", "/proj"));
    expect(result.current.loading).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(registry.search).not.toHaveBeenCalled();
  });

  it("debounces the search by 400ms", () => {
    vi.useFakeTimers();
    renderHook(() => useSkillSearch("de", "/proj"));
    vi.advanceTimersByTime(399);
    expect(registry.search).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(registry.search).toHaveBeenCalledTimes(1);
    expect(registry.search).toHaveBeenCalledWith("de", "/proj", expect.any(AbortSignal));
  });

  it("returns the results for the current query", async () => {
    vi.useFakeTimers();
    registry.search.mockResolvedValue({ skills: [skill("deck")] });
    const { result } = renderHook(() => useSkillSearch("de", "/proj"));
    expect(result.current.loading).toBe(true);
    await tick(400);
    expect(result.current.skills).toEqual([skill("deck")]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("reports an Error as its message", async () => {
    vi.useFakeTimers();
    registry.search.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useSkillSearch("de", "/proj"));
    await tick(400);
    expect(result.current.error).toBe("offline");
    expect(result.current.skills).toEqual([]);
  });

  it("reports a non-Error rejection as a string", async () => {
    vi.useFakeTimers();
    registry.search.mockRejectedValue("nope");
    const { result } = renderHook(() => useSkillSearch("de", "/proj"));
    await tick(400);
    expect(result.current.error).toBe("nope");
  });

  it("does not set an error when a request was aborted by a new query", async () => {
    vi.useFakeTimers();
    let rejectFirst!: (err: unknown) => void;
    registry.search.mockReturnValueOnce(new Promise((_r, reject) => { rejectFirst = reject; }));
    const { result, rerender } = renderHook(({ q }) => useSkillSearch(q, "/proj"), { initialProps: { q: "de" } });
    await tick(400);
    expect(registry.search).toHaveBeenCalledTimes(1);

    rerender({ q: "dec" });
    await act(async () => {
      rejectFirst(new Error("aborted"));
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(result.current.error).toBeUndefined();
  });

  it("keeps loading until the results for the current query arrive", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (r: { skills: RemoteSkill[] }) => void;
    registry.search.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { result, rerender } = renderHook(({ q }) => useSkillSearch(q, "/proj"), { initialProps: { q: "de" } });
    await tick(400);
    expect(result.current.loading).toBe(true);

    // The first query's results are for the old q, so the new one is still loading.
    rerender({ q: "dec" });
    await act(async () => {
      resolveFirst({ skills: [skill("deck")] });
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.skills).toEqual([]);
  });
});

describe("useLibraryScans", () => {
  it("loads the scans when active", async () => {
    registry.scans.mockResolvedValue({ scans: { deck: scan } });
    const { result } = renderHook(() => useLibraryScans("/proj", true));
    await waitFor(() => expect(result.current.scans).toEqual({ deck: scan }));
    expect(registry.scans).toHaveBeenCalledWith("/proj");
  });

  it("does not load when inactive", () => {
    const { result } = renderHook(() => useLibraryScans("/proj", false));
    expect(result.current.scans).toEqual({});
    expect(registry.scans).not.toHaveBeenCalled();
  });

  it("empties the scans when the load fails", async () => {
    registry.scans.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLibraryScans("/proj", true));
    await waitFor(() => expect(registry.scans).toHaveBeenCalled());
    expect(result.current.scans).toEqual({});
  });

  it("refetches when reload is called", async () => {
    registry.scans.mockResolvedValueOnce({ scans: { deck: scan } });
    const { result } = renderHook(() => useLibraryScans("/proj", true));
    await waitFor(() => expect(result.current.scans).toEqual({ deck: scan }));

    registry.scans.mockResolvedValueOnce({ scans: { deck: scan, other: scan } });
    await act(async () => {
      result.current.reload();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.scans).toEqual({ deck: scan, other: scan }));
    expect(registry.scans).toHaveBeenCalledTimes(2);
  });
});

describe("fileUrl", () => {
  it("encodes spaces in the path", () => {
    expect(fileUrl("/my folder/review.html")).toBe("file:///my%20folder/review.html");
  });
});

describe("openLocalReview", () => {
  it("opens the pane for a running review", async () => {
    registry.review.mockResolvedValue(RUNNING);
    await openLocalReview("/proj", "deck");
    expect(registry.review).toHaveBeenCalledWith({ cwd: "/proj", name: "deck" });
    expect(pane.openInPane).toHaveBeenCalledWith(fileUrl(RUNNING.page));
  });

  it("does not open the pane when there is no review", async () => {
    registry.review.mockResolvedValue({ status: "none" });
    await openLocalReview("/proj", "deck");
    expect(pane.openInPane).not.toHaveBeenCalled();
  });
});

describe("useSkillReview", () => {
  it("starts from the initial state", () => {
    const { result } = renderHook(() => useSkillReview({ cwd: "/proj", name: "deck" }, DONE));
    expect(result.current.state).toEqual(DONE);
  });

  it("resets when the initial state changes", () => {
    const { result, rerender } = renderHook(({ initial }) => useSkillReview({ cwd: "/proj", name: "deck" }, initial), {
      initialProps: { initial: RUNNING as SkillReviewState },
    });
    expect(result.current.state).toEqual(RUNNING);
    rerender({ initial: DONE });
    expect(result.current.state).toEqual(DONE);
  });

  it("resets when the target changes", () => {
    const { result, rerender } = renderHook(({ where }) => useSkillReview(where, RUNNING), {
      initialProps: { where: { cwd: "/proj", name: "deck" } as ReviewWhere },
    });
    expect(result.current.state).toEqual(RUNNING);
    rerender({ where: { cwd: "/proj", name: "other" } });
    expect(result.current.state).toEqual(RUNNING);
  });

  it("opens a review and shows its page in the pane", async () => {
    registry.review.mockResolvedValue(RUNNING);
    const { result } = renderHook(() => useSkillReview({ cwd: "/proj", name: "deck" }));
    await act(async () => {
      await result.current.open();
    });
    expect(registry.review).toHaveBeenCalledWith({ cwd: "/proj", name: "deck" });
    expect(result.current.state).toEqual(RUNNING);
    expect(pane.openInPane).toHaveBeenCalledWith(fileUrl(RUNNING.page));
  });

  it("does not open the pane for a review that is none", async () => {
    registry.review.mockResolvedValue({ status: "none" });
    const { result } = renderHook(() => useSkillReview({ cwd: "/proj", name: "deck" }));
    await act(async () => {
      await result.current.open();
    });
    expect(result.current.state).toEqual({ status: "none" });
    expect(pane.openInPane).not.toHaveBeenCalled();
  });

  it("does nothing without a target", async () => {
    const { result } = renderHook(() => useSkillReview(null));
    await act(async () => {
      await result.current.open();
    });
    expect(registry.review).not.toHaveBeenCalled();
    expect(pane.openInPane).not.toHaveBeenCalled();
  });

  it("polls the review state every 3 seconds while running, and stops when done", async () => {
    vi.useFakeTimers();
    // A fresh object each time, like a JSON reply: the state changes, so the effect re-arms the timer.
    registry.reviewState.mockImplementation(() => Promise.resolve({ ...RUNNING }));
    const { result } = renderHook(() => useSkillReview({ cwd: "/proj", name: "deck" }, RUNNING));
    expect(registry.reviewState).not.toHaveBeenCalled();

    await tick(3000);
    expect(registry.reviewState).toHaveBeenCalledTimes(1);
    expect(registry.reviewState).toHaveBeenCalledWith({ cwd: "/proj", name: "deck" });

    await tick(3000);
    expect(registry.reviewState).toHaveBeenCalledTimes(2);

    // The review finishes: the state changes and polling stops.
    registry.reviewState.mockResolvedValue(DONE);
    await tick(3000);
    expect(result.current.state).toEqual(DONE);

    await tick(9000);
    expect(registry.reviewState).toHaveBeenCalledTimes(3);
  });

  it("stops polling after 100 polls", async () => {
    vi.useFakeTimers();
    registry.reviewState.mockImplementation(() => Promise.resolve({ ...RUNNING }));
    renderHook(() => useSkillReview({ cwd: "/proj", name: "deck" }, RUNNING));

    for (let i = 0; i < 100; i++) {
      await tick(3000);
    }
    expect(registry.reviewState).toHaveBeenCalledTimes(100);

    // The 101st tick is past the limit, so no more calls.
    await tick(3000);
    expect(registry.reviewState).toHaveBeenCalledTimes(100);
  });

  it("swallows a poll error", async () => {
    vi.useFakeTimers();
    registry.reviewState.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useSkillReview({ cwd: "/proj", name: "deck" }, RUNNING));
    await tick(3000);
    expect(registry.reviewState).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual(RUNNING);
  });
});
