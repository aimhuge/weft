import { describe, expect, it, vi } from "vitest";
import { load, withSettingsDir } from "./settings.harness";

withSettingsDir();

describe("settings: projects and folders", () => {
  it("touchProject puts the folder first without duplicating; removeProject drops it", async () => {
    const s = await load();
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
    s.touchProject("/a");
    s.touchProject("/b");
    s.touchProject("/a");
    expect(s.listProjects().map((p) => p.path)).toEqual(["/a", "/b"]);
    s.removeProject("/a");
    expect(s.listProjects().map((p) => p.path)).toEqual(["/b"]);
    vi.restoreAllMocks();
  });

  it("keeps at most 40 recent projects", async () => {
    const s = await load();
    for (let i = 0; i < 45; i++) s.touchProject(`/p${i}`);
    expect(s.listProjects()).toHaveLength(40);
  });

  it("turns GitHub issue sync on and off per folder, without duplicates, and keeps it across a reload", async () => {
    let s = await load();
    expect(s.issueFolders()).toEqual([]);
    s.setIssueSync("/a", true);
    s.setIssueSync("/b", true);
    s.setIssueSync("/a", true);
    expect(s.issueFolders()).toEqual(["/b", "/a"]);
    s = await load();
    expect(s.issueFolders()).toEqual(["/b", "/a"]);
    s.setIssueSync("/b", false);
    expect(s.issueFolders()).toEqual(["/a"]);
  });

  it("remembers the folders allowed for every card, without duplicates, across a reload", async () => {
    let s = await load();
    expect(s.allowedFolders()).toEqual([]);
    s.allowFolder("/Users/me/Downloads");
    s.allowFolder("/Users/me/Music");
    s.allowFolder("/Users/me/Downloads");
    expect(s.allowedFolders()).toEqual(["/Users/me/Downloads", "/Users/me/Music"]);
    s = await load();
    expect(s.allowedFolders()).toEqual(["/Users/me/Downloads", "/Users/me/Music"]);
  });

  it("takes a trusted folder back out, leaving the others in the order they were allowed", async () => {
    let s = await load();
    s.allowFolder("/Users/me/Downloads");
    s.allowFolder("/Users/me/Music");
    s.allowFolder("/Users/me/Pictures");
    s.unallowFolder("/Users/me/Music");
    expect(s.allowedFolders()).toEqual(["/Users/me/Downloads", "/Users/me/Pictures"]);
    s = await load();
    expect(s.allowedFolders()).toEqual(["/Users/me/Downloads", "/Users/me/Pictures"]);
  });

  it("is quiet revoking a folder that was never allowed", async () => {
    const s = await load();
    s.unallowFolder("/Users/me/Never");
    expect(s.allowedFolders()).toEqual([]);
  });

  it("turns cloud sync on and off per folder, without duplicates, and keeps it across a reload", async () => {
    let s = await load();
    expect(s.syncFolders()).toEqual([]);
    s.setSyncFolder("/a", true);
    s.setSyncFolder("/b", true);
    s.setSyncFolder("/a", true);
    expect(s.syncFolders()).toEqual(["/b", "/a"]);
    s = await load();
    expect(s.syncFolders()).toEqual(["/b", "/a"]);
    s.setSyncFolder("/b", false);
    expect(s.syncFolders()).toEqual(["/a"]);
  });

  it("settingsView exposes syncFolders alongside issueFolders", async () => {
    const s = await load();
    s.setIssueSync("/iss", true);
    s.setSyncFolder("/sync", true);
    const view = s.settingsView();
    expect(view.issueFolders).toEqual(["/iss"]);
    expect(view.syncFolders).toEqual(["/sync"]);
  });
});
