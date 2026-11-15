import { describe, expect, it } from "vitest";
import { projectMenu, type ProjectMenuState } from "./project-menu";

const base: ProjectMenuState = {
  pinned: false, hidden: false, done: 0, live: 0, openIn: true, synced: false, syncable: true, syncStatus: "Not Synced", onWorker: false,
};
const ids = (s: Partial<ProjectMenuState>) =>
  projectMenu("weft", { ...base, ...s }).flatMap((i) => ("id" in i ? [i.id] : []));
const item = (id: string, s: Partial<ProjectMenuState> = {}) =>
  projectMenu("weft", { ...base, ...s }).find((i) => "id" in i && i.id === id);

describe("projectMenu", () => {
  it("offers every action, named for the project, with keys", () => {
    expect(ids({})).toEqual([
      "new", "reveal", "editor", "terminal", "github", "copy-path", "add-folder", "secrets", "services", "changelog", "share", "sync", "run-here", "run-worker", "pin", "hide", "archive-done", "stop-running",
    ]);
    expect(item("new")).toEqual({ id: "new", label: "New Thread in weft", accelerator: "N" });
  });

  it("leaves out Open in Editor and Terminal when the shell can't do them", () => {
    expect(ids({ openIn: false })).not.toContain("editor");
    expect(ids({ openIn: false })).not.toContain("terminal");
  });

  it("flips Pin and Hide to Unpin and Show", () => {
    expect(ids({ pinned: true, hidden: true })).toEqual(expect.arrayContaining(["unpin", "show"]));
    expect(ids({ pinned: true })).not.toContain("pin");
  });

  it("counts the cards the bulk items touch, and greys them out at zero", () => {
    expect(item("archive-done")).toMatchObject({ label: "Archive Done Cards", enabled: false });
    expect(item("archive-done", { done: 1 })).toMatchObject({ label: "Archive 1 Card in Done", enabled: true });
    expect(item("stop-running", { live: 3 })).toMatchObject({ label: "Stop All 3 Running", enabled: true });
    expect(item("archive-done", { done: 4 })).toMatchObject({ label: "Archive All 4 in Done" });
    expect(item("stop-running", { live: 1 })).toMatchObject({ label: "Stop 1 Running Card" });
    expect(item("stop-running")).toMatchObject({ label: "Stop Running Cards", enabled: false });
  });

  it("offers Sync for a project that isn't syncing, and Don't Sync for one that is", () => {
    expect(item("sync")).toMatchObject({ label: "Sync weft", enabled: true });
    expect(item("sync", { synced: true })).toMatchObject({ label: "Don't Sync weft" });
  });

  it("shows where sync stands beside the Sync item", () => {
    expect(item("sync")).toMatchObject({ label: "Sync weft", detail: "Not Synced" });
    expect(item("sync", { syncStatus: "Synced 7m ago" })).toMatchObject({ detail: "Synced 7m ago" });
  });

  it("offers Share… with S, greyed out without an account to share from", () => {
    expect(item("share")).toMatchObject({ label: "Share weft…", enabled: true, accelerator: "S" });
    expect(item("share", { syncable: false })).toMatchObject({ enabled: false });
    expect(item("share", { syncable: false, synced: true })).toMatchObject({ enabled: true });
  });

  it("greys out Sync when there's no account to sync to", () => {
    expect(item("sync", { syncable: false })).toMatchObject({ label: "Sync weft", enabled: false });
    // A project that already syncs can always be turned off, even without an account.
    expect(item("sync", { syncable: false, synced: true })).toMatchObject({ label: "Don't Sync weft", enabled: true });
  });

  it("ticks where the project's new threads run, this machine or the worker", () => {
    expect(item("run-here")).toMatchObject({ label: "Run on This Machine", checked: true, accelerator: "M" });
    expect(item("run-worker")).toMatchObject({ label: "Run on Worker", checked: false, enabled: true, accelerator: "W" });
    expect(item("run-worker", { onWorker: true })).toMatchObject({ checked: true });
    expect(item("run-here", { onWorker: true })).toMatchObject({ checked: false });
  });

  it("greys out Run on Worker without an account, unless the project already runs there", () => {
    expect(item("run-worker", { syncable: false })).toMatchObject({ enabled: false });
    expect(item("run-worker", { syncable: false, onWorker: true })).toMatchObject({ enabled: true });
  });

  it("offers Add Folder…, and a Remove item for each folder already added", () => {
    expect(item("add-folder")).toEqual({ id: "add-folder", label: "Add Folder…", accelerator: "O" });
    expect(item("remove-folder:/Users/me/api", { folders: ["/Users/me/api"] })).toEqual({ id: "remove-folder:/Users/me/api", label: "Remove api", detail: "/Users/me/api" });
    expect(item("remove-folder:/", { folders: ["/"] })).toMatchObject({ label: "Remove /" });
  });
});

describe("projectMenu, other machines", () => {
  const mini = { name: "m1mini", offline: false, pull: "worker://w/weft", sync: { path: "worker://w/weft", on: true }, runThere: false };
  const air = { name: "MacBook-Air-3", offline: true, pull: "mac:abcdef0123/weft" };
  const menu = (s: Partial<ProjectMenuState>) => projectMenu("weft", { ...base, ...s });

  it("groups each machine's items in a submenu, and its tick replaces the two Run on items", () => {
    const items = menu({ machines: [mini, air], submenus: true });
    expect(items.flatMap((i) => ("id" in i ? [i.id] : []))).not.toContain("run-here");
    const groups = items.filter((i) => "submenu" in i);
    expect(groups).toEqual([
      {
        label: "m1mini",
        submenu: [
          { id: "pull-wip:worker://w/weft", label: "Bring Its Uncommitted Work Here", enabled: true },
          { id: "sync-tree:worker://w/weft", label: "Keep in Sync with This Mac", checked: true },
          { id: "move-tree:worker://w/weft", label: "Move weft There", enabled: true, detail: "Sends this Mac's work, then new threads start there" },
          { type: "separator" },
          { id: "run-worker", label: "Start New Threads There", checked: false },
        ],
      },
      { label: "MacBook-Air-3", detail: "offline", submenu: [{ id: "pull-wip:mac:abcdef0123/weft", label: "Bring Its Uncommitted Work Here", enabled: false }] },
    ]);
  });

  it("a ticked machine sends new threads back here when picked", () => {
    const [group] = menu({ machines: [{ name: "m1mini", offline: false, runThere: true }], submenus: true, onWorker: true }).filter((i) => "submenu" in i);
    expect(group).toEqual({ label: "m1mini", submenu: [{ id: "run-here", label: "Start New Threads There", checked: true }] });
  });

  it("keeps the plain Run on items when no machine takes new threads", () => {
    expect(ids({ machines: [air], submenus: true })).toEqual(expect.arrayContaining(["run-here", "run-worker"]));
  });

  it("says how a sync stands under Keep in Sync", () => {
    const paused = { ...mini, sync: { ...mini.sync, note: "Paused: m1mini: Waiting for commit abc1234 to be pushed" } };
    const group = menu({ machines: [paused], submenus: true }).find((i) => "submenu" in i) as unknown as { submenu: unknown[] };
    expect(group.submenu).toContainEqual({ id: "sync-tree:worker://w/weft", label: "Keep in Sync with This Mac", checked: true, detail: "Paused: m1mini: Waiting for commit abc1234 to be pushed" });
  });

  it("on a shell without submenus, names the machine as a heading and in each item", () => {
    const items = menu({ machines: [mini], submenus: false });
    const at = items.findIndex((i) => "id" in i && i.id === "machine:m1mini");
    expect(items.slice(at, at + 6)).toEqual([
      { id: "machine:m1mini", label: "m1mini", enabled: false },
      { id: "pull-wip:worker://w/weft", label: "Bring m1mini's Uncommitted Work Here", enabled: true },
      { id: "sync-tree:worker://w/weft", label: "Keep in Sync with m1mini", checked: true },
      { id: "move-tree:worker://w/weft", label: "Move weft to m1mini", enabled: true, detail: "Sends this Mac's work, then new threads start there" },
      { type: "separator" },
      // Top-level items keep their keys.
      { id: "run-worker", label: "Start New Threads on m1mini", checked: false, accelerator: "W" },
    ]);
  });
});
