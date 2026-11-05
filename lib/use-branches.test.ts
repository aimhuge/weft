// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));
const { matchBranches, useBranches } = await import("./use-branches");

beforeEach(() => apiFetch.mockReset());
afterEach(cleanup);

describe("useBranches", () => {
  it("reads nothing until open, then the folder's branches", async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ branches: [{ name: "main", at: 1 }] })));
    const { result, rerender } = renderHook(({ open }) => useBranches("/r", open), { initialProps: { open: false } });
    expect(result.current).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(result.current).toEqual([{ name: "main", at: 1 }]));
  });

  it("is empty when the answer has none or the read fails", async () => {
    apiFetch.mockResolvedValueOnce(new Response("{}"));
    const a = renderHook(() => useBranches("/r", true));
    await waitFor(() => expect(a.result.current).toEqual([]));
    apiFetch.mockRejectedValueOnce(new Error("down"));
    const b = renderHook(() => useBranches("/s", true));
    await waitFor(() => expect(b.result.current).toEqual([]));
  });

  it("drops an answer that comes after the folder changed", async () => {
    let answer: (r: Response) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise<Response>((r) => (answer = r))).mockRejectedValueOnce(new Error("x"));
    const { result, rerender, unmount } = renderHook(({ cwd }) => useBranches(cwd, true), { initialProps: { cwd: "/a" } });
    rerender({ cwd: "/b" });
    await waitFor(() => expect(result.current).toEqual([]));
    answer(new Response(JSON.stringify({ branches: [{ name: "late", at: 1 }] })));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual([]);
    unmount();
  });
});

describe("matchBranches", () => {
  const all = [{ name: "main", at: 2 }, { name: "feat/Login", at: 1 }];

  it("lists all for no search, filters case-blind, and offers a valid new name", () => {
    expect(matchBranches(all, " ")).toEqual({ matches: all, create: null });
    expect(matchBranches(all, "login")).toEqual({ matches: [all[1]], create: "login" });
    expect(matchBranches(all, "main").create).toBeNull();
    expect(matchBranches(all, "a b").create).toBeNull();
  });
});
