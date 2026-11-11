// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => vi.fn());
const useVault = vi.hoisted(() => vi.fn((folders: string[]) => ({ folders })));
vi.mock("./client", () => ({ api: { settings } }));
vi.mock("./use-vault", () => ({ useVault }));

import { useBoardVaults } from "./use-board-vaults";

describe("useBoardVaults", () => {
  it("reads the board's folders, then their vaults", async () => {
    settings.mockResolvedValue({ projects: [{ path: "/a" }, { path: "/b" }] });
    const { result } = renderHook(() => useBoardVaults());
    await waitFor(() => expect(result.current).toEqual({ folders: ["/a", "/b"] }));
  });

  it("has no folders when the settings fail, and ignores a late answer", async () => {
    settings.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useBoardVaults());
    await waitFor(() => expect(settings).toHaveBeenCalled());
    expect(result.current).toEqual({ folders: [] });
    let answer: (v: unknown) => void = () => {};
    settings.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const late = renderHook(() => useBoardVaults());
    late.unmount();
    answer({ projects: [{ path: "/z" }] });
    let fail: (e: unknown) => void = () => {};
    settings.mockReturnValueOnce(new Promise((_, r) => (fail = r)));
    const late2 = renderHook(() => useBoardVaults());
    late2.unmount();
    fail(new Error("late"));
  });
});
