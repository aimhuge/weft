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
      "new", "reveal", "editor", "terminal", "github", "copy-path", "secrets", "services", "changelog", "sync", "run-here", "run-worker", "pin", "hide", "archive-done", "stop-running",
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
});
