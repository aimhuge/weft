// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiWarm = vi.fn<(args: { cwd: string }) => Promise<unknown>>();
vi.mock("./client", () => ({ api: { warm: (args: { cwd: string }) => apiWarm(args) } }));

const readPrefs = vi.fn<() => { project?: string | null; sort?: string }>();
const writePrefs = vi.fn<(prefs: { project: string | null; sort: string }) => void>();
vi.mock("./view-prefs", () => ({ readViewPrefs: () => readPrefs(), writeViewPrefs: (p: { project: string | null; sort: string }) => writePrefs(p) }));

const { useBoardView } = await import("./use-board-view");

beforeEach(() => {
  apiWarm.mockReset();
  apiWarm.mockResolvedValue(undefined);
  readPrefs.mockReset();
  readPrefs.mockReturnValue({});
  writePrefs.mockReset();
});

afterEach(cleanup);

function makeView() {
  const select = vi.fn();
  const setWebBrowserOpen = vi.fn();
  const { result } = renderHook(() => useBoardView({ select, setWebBrowserOpen }));
  return { result, select, setWebBrowserOpen };
}

describe("useBoardView", () => {
  it("starts with no project and the newest sort", () => {
    const { result } = makeView();
    expect(result.current.project).toBeNull();
    expect(result.current.sort).toBe("newest");
  });

  it("chooseProject stores the project and writes the cookie", () => {
    const { result } = makeView();
    act(() => result.current.chooseProject("/repo"));
    expect(result.current.project).toBe("/repo");
    expect(writePrefs).toHaveBeenCalledWith({ project: "/repo", sort: "newest" });
    expect(apiWarm).toHaveBeenCalledWith({ cwd: "/repo" });
  });

  it("chooseProject(null) clears the project without warming", () => {
    const { result } = makeView();
    act(() => result.current.chooseProject("/repo"));
    act(() => result.current.chooseProject(null));
    expect(result.current.project).toBeNull();
    expect(apiWarm).toHaveBeenCalledTimes(1);
    expect(apiWarm).toHaveBeenCalledWith({ cwd: "/repo" });
  });

  it("changing project closes the open thread and hides the browser", () => {
    (window as { weft?: unknown }).weft = undefined;
    const { result, select, setWebBrowserOpen } = makeView();
    act(() => result.current.chooseProject("/repo"));
    select.mockClear();
    setWebBrowserOpen.mockClear();
    act(() => result.current.chooseProject("/other"));
    expect(select).toHaveBeenCalledWith(null);
    expect(setWebBrowserOpen).toHaveBeenCalledWith(false);
  });

  it("changing project to the same folder doesn't close the thread", () => {
    const { result, select } = makeView();
    act(() => result.current.chooseProject("/repo"));
    select.mockClear();
    act(() => result.current.chooseProject("/repo"));
    expect(select).not.toHaveBeenCalled();
  });

  it("changing project clears the card filter; the same project keeps it", () => {
    const { result } = makeView();
    act(() => result.current.chooseProject("/repo"));
    act(() => result.current.setQuery("login"));
    act(() => result.current.chooseProject("/repo"));
    expect(result.current.query).toBe("login");
    act(() => result.current.chooseProject("/other"));
    expect(result.current.query).toBe("");
  });

  it("chooseSort updates the sort and writes the cookie", () => {
    const { result } = makeView();
    act(() => result.current.chooseProject("/repo"));
    act(() => result.current.chooseSort("active"));
    expect(result.current.sort).toBe("active");
    expect(writePrefs).toHaveBeenLastCalledWith({ project: "/repo", sort: "active" });
  });

  it("loadFromPrefs reads the cookie into state", () => {
    readPrefs.mockReturnValue({ project: "/saved", sort: "oldest" });
    const { result } = makeView();
    act(() => result.current.loadFromPrefs());
    expect(result.current.project).toBe("/saved");
    expect(result.current.sort).toBe("oldest");
  });

  it("loadFromPrefs ignores an unknown sort", () => {
    readPrefs.mockReturnValue({ project: "/saved", sort: "weird" });
    const { result } = makeView();
    act(() => result.current.loadFromPrefs());
    expect(result.current.project).toBe("/saved");
    expect(result.current.sort).toBe("newest");
  });
});

describe("useBoardView review chips", () => {
  it("starts with both off and toggles each on its own, without writing the cookie", () => {
    const { result } = makeView();
    expect(result.current.reviewFilter).toEqual({ errors: false, restart: false });
    act(() => result.current.toggleReviewFilter("errors"));
    expect(result.current.reviewFilter).toEqual({ errors: true, restart: false });
    act(() => result.current.toggleReviewFilter("restart"));
    act(() => result.current.toggleReviewFilter("errors"));
    expect(result.current.reviewFilter).toEqual({ errors: false, restart: true });
    expect(writePrefs).not.toHaveBeenCalled();
  });
});
