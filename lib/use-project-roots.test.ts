// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const list = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api: { list } }));
const { useProjectRoots } = await import("./use-project-roots");

describe("useProjectRoots", () => {
  it("folds a worktree into its repo, and asks the server once per new folder", async () => {
    list.mockResolvedValue({ roots: { "/wt/a": "/repo" } });
    const { result } = renderHook(() => useProjectRoots());
    expect(result.current.rootOf("/wt/a")).toBe("/wt/a");
    await act(async () => {
      result.current.resolveFolders(["/wt/a"]);
      await Promise.resolve();
    });
    expect(result.current.rootOf("/wt/a")).toBe("/repo");
    result.current.resolveFolders(["/wt/a"]);
    expect(list).toHaveBeenCalledOnce();
    list.mockRejectedValueOnce(new Error("down"));
    await act(async () => {
      result.current.resolveFolders(["/other"]);
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.resolvedFolders.current.has("/other")).toBe(true);
  });
});
