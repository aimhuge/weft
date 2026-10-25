// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiWarm = vi.fn<(args: { cwd: string }) => Promise<unknown>>();
const apiIntake = vi.fn<(folder: string) => Promise<{ text: string | null }>>();
vi.mock("./client", () => ({ api: { warm: (args: { cwd: string }) => apiWarm(args), intake: (folder: string) => apiIntake(folder) } }));

const openIntake = vi.fn<(folder: string, result: unknown) => void>();
vi.mock("./intake-open", () => ({ openIntake: (folder: string, result: unknown) => openIntake(folder, result) }));

const readPrefs = vi.fn<() => { project?: string | null; sort?: string }>();
const writePrefs = vi.fn<(prefs: { project: string | null; sort: string }) => void>();
vi.mock("./view-prefs", () => ({ readViewPrefs: () => readPrefs(), writeViewPrefs: (p: { project: string | null; sort: string }) => writePrefs(p) }));

const { useBoardView } = await import("./use-board-view");

beforeEach(() => {
  apiWarm.mockReset();
  apiWarm.mockResolvedValue(undefined);
  apiIntake.mockReset();
  apiIntake.mockResolvedValue({ text: null });
  readPrefs.mockReset();
  readPrefs.mockReturnValue({});
  writePrefs.mockReset();
  openIntake.mockReset();
});

afterEach(cleanup);

function makeView() {
  const select = vi.fn();
  const setWebBrowserOpen = vi.fn();
  const { result } = renderHook(() => useBoardView({ select, setWebBrowserOpen }));
  return { result, select, setWebBrowserOpen };
}

describe("project intake", () => {
  it("takes a chosen project in and shows what it took in", async () => {
    const taken = { text: "Moved 2 secrets from .env.local into 🔐." };
    apiIntake.mockResolvedValue(taken);
    const { result } = makeView();
    await act(() => {
      result.current.chooseProject("/repo");
      return Promise.resolve();
    });
    expect(apiIntake).toHaveBeenCalledWith("/repo");
    expect(openIntake).toHaveBeenCalledWith("/repo", taken);
  });

  it("stays quiet when nothing was taken in, or the call fails", async () => {
    const { result } = makeView();
    await act(() => {
      result.current.chooseProject("/repo");
      return Promise.resolve();
    });
    apiIntake.mockRejectedValue(new Error("offline"));
    await act(() => {
      result.current.chooseProject("/other");
      return Promise.resolve();
    });
    expect(openIntake).not.toHaveBeenCalled();
  });

  it("takes in the saved project on (re)connect, and none without one", async () => {
    readPrefs.mockReturnValue({ project: "/saved" });
    const { result } = makeView();
    await act(() => {
      result.current.loadFromPrefs();
      return Promise.resolve();
    });
    expect(apiIntake).toHaveBeenCalledWith("/saved");
    readPrefs.mockReturnValue({ project: null });
    apiIntake.mockClear();
    await act(() => {
      result.current.loadFromPrefs();
      return Promise.resolve();
    });
    expect(apiIntake).not.toHaveBeenCalled();
  });
});

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
