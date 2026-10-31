import { describe, expect, it } from "vitest";
import type { CloudSyncStatus } from "./cloud-sync-view";
import { projectSyncLine, syncDot, syncLine } from "./sync-menu";

const OK: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const NOW = 10 * 60_000;

describe("syncLine", () => {
  it("asks you to sign in first, whatever else is set", () => {
    expect(syncLine({ ...OK, signedOut: true, noWorkspace: true, lastError: "x" }, ["/a"], NOW)).toEqual({ text: "Sign in to sync", sub: null, tone: "off" });
  });

  it("says there's no workspace before it reports an error", () => {
    expect(syncLine({ ...OK, noWorkspace: true, lastError: "x" }, ["/a"], NOW)).toEqual({
      text: "No workspace yet",
      sub: "Open the web board to claim yours",
      tone: "off",
    });
  });

  it("shows the last error as the second line", () => {
    expect(syncLine({ ...OK, lastError: "HTTP 500" }, ["/a"], NOW)).toEqual({ text: "Sync failed", sub: "HTTP 500", tone: "error" });
    expect(syncLine({ ...OK, lastError: "HTTP 500" }, [], NOW).tone).toBe("error");
  });

  it("says sync is off when no project uploads", () => {
    expect(syncLine({ ...OK, waiting: 3 }, [], NOW)).toEqual({ text: "Sync is off", sub: "No project uploads its threads", tone: "off" });
  });

  it("counts the items waiting, with the project count beneath", () => {
    expect(syncLine({ ...OK, waiting: 1 }, ["/a"], NOW)).toEqual({ text: "Syncing 1 item…", sub: "1 project sync to weft.zip", tone: "busy" });
    expect(syncLine({ ...OK, waiting: 4 }, ["/a", "/b"], NOW)).toEqual({ text: "Syncing 4 items…", sub: "2 projects sync to weft.zip", tone: "busy" });
  });

  it("says how long ago it last synced", () => {
    expect(syncLine({ ...OK, lastSyncAt: NOW - 5 * 60_000 }, ["/a"], NOW)).toEqual({ text: "Synced 5m ago", sub: "1 project sync to weft.zip", tone: "ok" });
  });

  it("says it hasn't synced yet when nothing ever uploaded", () => {
    expect(syncLine(OK, ["/a", "/b"], NOW)).toEqual({ text: "Not synced yet", sub: "2 projects sync to weft.zip", tone: "off" });
  });
});

describe("syncDot", () => {
  it("shows a dot for an upload under way or a failure", () => {
    expect(syncDot({ ...OK, waiting: 2 }, ["/a"])).toBe("busy");
    expect(syncDot({ ...OK, lastError: "boom" }, [])).toBe("error");
  });

  it("shows none when there's nothing to know", () => {
    expect(syncDot(OK, [])).toBeNull();
    expect(syncDot({ ...OK, waiting: 2 }, [])).toBeNull();
    expect(syncDot({ ...OK, lastSyncAt: 5 }, ["/a"])).toBeNull();
    expect(syncDot(OK, ["/a"])).toBeNull();
    expect(syncDot({ ...OK, signedOut: true, waiting: 2 }, ["/a"])).toBeNull();
  });
});

describe("projectSyncLine", () => {
  it("says Not Synced for a project that isn't opted in, however the others are doing", () => {
    expect(projectSyncLine("/a", { ...OK, lastSyncAt: NOW - 60_000 }, ["/b"], NOW)).toEqual({ text: "Not Synced", sub: null, tone: "off" });
    expect(projectSyncLine("/a", OK, [], NOW)).toEqual({ text: "Not Synced", sub: null, tone: "off" });
  });

  it("says how long ago it synced", () => {
    expect(projectSyncLine("/a", { ...OK, lastSyncAt: NOW - 7 * 60_000 }, ["/a"], NOW)).toEqual({ text: "Synced 7m ago", sub: null, tone: "ok" });
  });

  it("says it's syncing while items wait", () => {
    expect(projectSyncLine("/a", { ...OK, waiting: 2, lastSyncAt: NOW }, ["/a"], NOW)).toEqual({ text: "Syncing…", sub: null, tone: "busy" });
  });

  it("names the failure", () => {
    expect(projectSyncLine("/a", { ...OK, lastError: "HTTP 500" }, ["/a"], NOW)).toEqual({ text: "Sync Failed", sub: "HTTP 500", tone: "error" });
  });

  it("asks you to sign in, or to claim a workspace, when it can't sync at all", () => {
    expect(projectSyncLine("/a", { ...OK, signedOut: true }, ["/a"], NOW)).toEqual({ text: "Sign in to sync", sub: null, tone: "off" });
    expect(projectSyncLine("/a", { ...OK, noWorkspace: true }, ["/a"], NOW)).toEqual({ text: "No workspace yet", sub: null, tone: "off" });
  });

  it("says Not Synced when it hasn't synced yet", () => {
    expect(projectSyncLine("/a", OK, ["/a"], NOW)).toEqual({ text: "Not Synced", sub: null, tone: "off" });
  });
});
