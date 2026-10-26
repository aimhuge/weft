// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));
const { BIG_PROMPT, suggestIsolate, useIsolate } = await import("./use-isolate");

beforeEach(() => apiFetch.mockReset().mockResolvedValue(new Response("{}")));
afterEach(cleanup);

describe("suggestIsolate", () => {
  it("suggests isolation when other cards are busy here or the prompt is big", () => {
    expect(suggestIsolate(0, 10)).toBe(false);
    expect(suggestIsolate(1, 10)).toBe(true);
    expect(suggestIsolate(0, BIG_PROMPT + 1)).toBe(true);
  });
});

describe("useIsolate", () => {
  it("starts off and never warms the pool until switched on, then warms per folder", () => {
    const { result, rerender } = renderHook(({ cwd }) => useIsolate(cwd), { initialProps: { cwd: "/repo" } });
    expect(result.current.isolated).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
    act(() => result.current.toggleIsolated());
    expect(result.current.isolated).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith("/api/worktrees", expect.objectContaining({ method: "POST", body: JSON.stringify({ cwd: "/repo" }) }));
    rerender({ cwd: "/other" });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    act(() => result.current.notePrompt("x".repeat(20)));
    expect(result.current.promptLength).toBe(20);
  });

  it("picks a branch, which turns a worktree on, and forgets it for another folder", () => {
    const { result, rerender } = renderHook(({ cwd }) => useIsolate(cwd), { initialProps: { cwd: "/repo" } });
    expect(result.current.branch).toBe("");
    act(() => result.current.pickBranch("feat/x"));
    expect(result.current).toMatchObject({ branch: "feat/x", isolated: true });
    act(() => result.current.setIsolated(false));
    expect(result.current).toMatchObject({ branch: "feat/x", isolated: false });
    rerender({ cwd: "/other" });
    expect(result.current.branch).toBe("");
  });

  it("shrugs off a failed warm", () => {
    const failed = { catch: vi.fn() };
    apiFetch.mockReturnValue(failed);
    const { result } = renderHook(() => useIsolate("/repo"));
    act(() => result.current.toggleIsolated());
    expect(failed.catch).toHaveBeenCalledOnce();
    expect(result.current.isolated).toBe(true);
  });
});
