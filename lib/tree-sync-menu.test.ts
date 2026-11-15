// "Keep in Sync with <worker>" (lib/tree-sync-menu.ts): which worker twins of a project this Mac syncs, and turning one
// on or off through /api/tree-sync.
import { describe, expect, it, vi } from "vitest";
import { isMoveTree, isTreeSync, moveToWorker, syncedFolders, syncTwins, toggleTreeSync, TREE_SYNC_CHANGED } from "./tree-sync-menu";

const W = "1A2B3C4D-0000-4000-8000-00000000ABCD";

describe("syncedFolders", () => {
  it("lists main's folders, and none when main can't say", async () => {
    const folders = [{ workerId: "w1", folder: "weft" }];
    const api = vi.fn(() => Promise.resolve({ folders }));
    expect(await syncedFolders(api)).toEqual(folders);
    expect(api).toHaveBeenCalledWith({ op: "list" });
    expect(await syncedFolders(() => Promise.reject(new Error("older shell")))).toEqual([]);
    expect(await syncedFolders(() => Promise.resolve({ folders: "nope" }))).toEqual([]);
  });
});

describe("syncTwins", () => {
  it("keeps the worker twins, marked on when synced under any case of the id", () => {
    const twins = [
      { path: `worker://${W}/weft`, name: "Mini", offline: false },
      { path: `worker://${W}/ling`, name: "Mini", offline: true },
      { path: "/Users/me/dev/weft", name: "here", offline: false },
    ];
    expect(syncTwins(twins, [{ workerId: W.toLowerCase(), folder: "weft" }])).toEqual([
      { ...twins[0], on: true },
      { ...twins[1], on: false },
    ]);
  });
});

describe("isTreeSync", () => {
  it("knows a sync item by its id", () => {
    expect(isTreeSync("sync-tree:worker://w1/weft")).toBe(true);
    expect(isTreeSync("sync")).toBe(false);
  });
});

describe("toggleTreeSync", () => {
  const twin = { path: `worker://${W}/weft`, name: "Mini", offline: false, on: false };

  it("turns sync on, tells the board, and says what it means", async () => {
    const api = vi.fn(() => Promise.resolve({ ok: true }));
    const notify = vi.fn();
    const toast = await toggleTreeSync(twin, api, notify);
    expect(api).toHaveBeenCalledWith({ op: "enable", workerId: W, folder: "weft", workerName: "Mini" });
    expect(notify).toHaveBeenCalled();
    expect(toast).toBe("weft now syncs with Mini while Weft is open: changes on either side reach the other in a second or two.");
  });

  it("turns sync off", async () => {
    const api = vi.fn(() => Promise.resolve({ ok: true }));
    const toast = await toggleTreeSync({ ...twin, on: true }, api, () => {});
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ op: "disable" }));
    expect(toast).toBe("weft no longer syncs with Mini. Each keeps its files as they are now.");
  });

  it("refuses a project that isn't a worker's, and leaves the board alone when the api fails", async () => {
    const api = vi.fn(() => Promise.resolve({}));
    const notify = vi.fn();
    await expect(toggleTreeSync({ ...twin, path: "/dev/weft" }, api, notify)).rejects.toThrow("isn't a worker's project");
    await expect(toggleTreeSync(twin, () => Promise.reject(new Error("Sync wasn't turned on.")), notify)).rejects.toThrow("wasn't turned on");
    expect(api).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("dispatches the change on the window by default", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    try {
      await toggleTreeSync(twin, () => Promise.resolve({}));
      expect((dispatch.mock.calls[0]?.[0] as Event).type).toBe(TREE_SYNC_CHANGED);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("moveToWorker", () => {
  const twin = { path: `worker://${W}/weft`, name: "Mini", offline: false, on: false };
  const target = { workerId: W, folder: "weft", workerName: "Mini" };

  it("has this Mac lead, turns sync on, and tells the board", async () => {
    const api = vi.fn(() => Promise.resolve({ ok: true }));
    const notify = vi.fn();
    expect(await moveToWorker(twin, api, notify)).toBe("Sending weft's uncommitted work to Mini; it stays in sync, and new threads start there.");
    expect(api.mock.calls).toEqual([[{ op: "lead", ...target }], [{ op: "enable", ...target }]]);
    expect(notify).toHaveBeenCalled();
  });

  it("only leads when sync is already on, and refuses a project that isn't a worker's", async () => {
    const api = vi.fn(() => Promise.resolve({ ok: true }));
    await moveToWorker({ ...twin, on: true }, api, vi.fn());
    expect(api.mock.calls).toEqual([[{ op: "lead", ...target }]]);
    await expect(moveToWorker({ ...twin, path: "/dev/weft" }, api, vi.fn())).rejects.toThrow("isn't a worker's project");
  });

  it("knows a move item by its id", () => {
    expect(isMoveTree("move-tree:worker://w/weft")).toBe(true);
    expect(isMoveTree("sync-tree:worker://w/weft")).toBe(false);
  });
});
