// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBoardRepos } from "./use-board-repos";

const apiMock = vi.hoisted(() => ({ settings: vi.fn(), github: vi.fn() }));
vi.mock("./client", () => ({ api: apiMock }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useBoardRepos", () => {
  it("lists the GitHub repos of the board's projects, once each", async () => {
    apiMock.settings.mockResolvedValue({ projects: [{ path: "/a" }, { path: "/b" }, { path: "/c" }] });
    apiMock.github.mockResolvedValue({
      folders: [{ repo: "o/a" }, { repo: null }, { repo: "o/a" }],
    });
    const { result } = renderHook(() => useBoardRepos(true));
    await waitFor(() => expect(result.current).toEqual(["o/a"]));
    expect(apiMock.github).toHaveBeenCalledWith(["/a", "/b", "/c"]);
  });

  it("asks nothing while inactive and gives an empty list on failure", async () => {
    renderHook(() => useBoardRepos(false));
    expect(apiMock.settings).not.toHaveBeenCalled();
    apiMock.settings.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useBoardRepos(true));
    await waitFor(() => expect(apiMock.settings).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("opens on the last list it found, then checks again", async () => {
    apiMock.settings.mockResolvedValue({ projects: [{ path: "/a" }] });
    apiMock.github.mockResolvedValue({ folders: [{ repo: "o/a" }] });
    const first = renderHook(() => useBoardRepos(true));
    await waitFor(() => expect(first.result.current).toEqual(["o/a"]));
    first.unmount();
    apiMock.github.mockResolvedValue({ folders: [{ repo: "o/b" }] });
    const { result } = renderHook(() => useBoardRepos(true));
    expect(result.current).toEqual(["o/a"]);
    await waitFor(() => expect(result.current).toEqual(["o/b"]));
  });
});
