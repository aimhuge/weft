// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copilotLaneOpen,
  foldedColumns,
  isFolded,
  copilotLanePeek,
  setCopilotLaneOpen,
  setColumnFolded,
  setCopilotLanePeek,
  setShowBacklog,
  setShowProgress,
  setViewMode,
  showBacklog,
  showProgress,
  subscribeBoardPrefs,
  viewMode,
} from "./board-prefs";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "weft-show-backlog=; path=/; max-age=0";
  document.cookie = "weft-backlog-folded=; path=/; max-age=0";
  document.cookie = "weft-folded-columns=; path=/; max-age=0";
  document.cookie = "weft-show-progress=; path=/; max-age=0";
  document.cookie = "weft-copilot-lane=; path=/; max-age=0";
  document.cookie = "weft-copilot-peek=; path=/; max-age=0";
  document.cookie = "weft-view-mode=; path=/; max-age=0";
});

describe("foldedColumns", () => {
  it("folds nothing by default, and on the server", () => {
    expect(foldedColumns()).toBe("");
    vi.stubGlobal("document", undefined);
    expect(foldedColumns()).toBe("");
  });

  it("folds and opens each column through the cookie, and tells subscribers", () => {
    const onChange = vi.fn();
    const stop = subscribeBoardPrefs(onChange);
    setColumnFolded("backlog", true);
    setColumnFolded("done", true);
    setColumnFolded("done", true);
    expect(foldedColumns()).toBe("backlog,done");
    expect(isFolded(foldedColumns(), "done")).toBe(true);
    expect(isFolded(foldedColumns(), "review")).toBe(false);
    setColumnFolded("backlog", false);
    expect(foldedColumns()).toBe("done");
    setColumnFolded("done", false);
    expect(foldedColumns()).toBe("");
    expect(onChange).toHaveBeenCalledTimes(5);
    stop();
  });

  it("keeps a Backlog folded under the old Backlog-only cookie, until a column is folded or opened", () => {
    document.cookie = "weft-backlog-folded=1; path=/";
    expect(foldedColumns()).toBe("backlog");
    setColumnFolded("review", true);
    expect(foldedColumns()).toBe("backlog,review");
    document.cookie = "weft-folded-columns=; path=/; max-age=0";
    document.cookie = "weft-backlog-folded=0; path=/";
    expect(foldedColumns()).toBe("");
  });
});

describe("showBacklog", () => {
  it("is off by default", () => {
    expect(showBacklog()).toBe(false);
  });

  it("follows setShowBacklog through the cookie", () => {
    setShowBacklog(true);
    expect(document.cookie).toContain("weft-show-backlog=1");
    expect(showBacklog()).toBe(true);
    setShowBacklog(false);
    expect(document.cookie).toContain("weft-show-backlog=0");
    expect(showBacklog()).toBe(false);
  });

  it("is off on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(showBacklog()).toBe(false);
  });
});

describe("showProgress", () => {
  it("is on by default and off only once turned off (quiet mode)", () => {
    expect(showProgress()).toBe(true);
    setShowProgress(false);
    expect(document.cookie).toContain("weft-show-progress=0");
    expect(showProgress()).toBe(false);
    setShowProgress(true);
    expect(showProgress()).toBe(true);
  });

  it("is on on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(showProgress()).toBe(true);
  });
});

describe("copilotLaneOpen", () => {
  it("is minimized by default and follows setCopilotLaneOpen", () => {
    expect(copilotLaneOpen()).toBe(false);
    setCopilotLaneOpen(true);
    expect(document.cookie).toContain("weft-copilot-lane=1");
    expect(copilotLaneOpen()).toBe(true);
    setCopilotLaneOpen(false);
    expect(copilotLaneOpen()).toBe(false);
  });

  it("is minimized on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(copilotLaneOpen()).toBe(false);
  });
});

describe("copilotLanePeek", () => {
  it("is hidden by default and follows setCopilotLanePeek", () => {
    expect(copilotLanePeek()).toBe(false);
    setCopilotLanePeek(true);
    expect(document.cookie).toContain("weft-copilot-peek=1");
    expect(copilotLanePeek()).toBe(true);
    setCopilotLanePeek(false);
    expect(copilotLanePeek()).toBe(false);
  });

  it("is hidden on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(copilotLanePeek()).toBe(false);
  });
});

describe("viewMode", () => {
  it("is the board by default and follows setViewMode through the cookie", () => {
    expect(viewMode()).toBe("board");
    setViewMode("list");
    expect(document.cookie).toContain("weft-view-mode=list");
    expect(viewMode()).toBe("list");
    setViewMode("board");
    expect(viewMode()).toBe("board");
  });

  it("is the board on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(viewMode()).toBe("board");
  });
});

describe("subscribeBoardPrefs", () => {
  it("tells subscribers about each change until they unsubscribe", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeBoardPrefs(onChange);
    setShowBacklog(true);
    setShowBacklog(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    setShowBacklog(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
