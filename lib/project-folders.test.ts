import { describe, expect, it } from "vitest";
import { load, withSettingsDir } from "./settings.harness";

withSettingsDir();

// The folders added to a project are saved in settings, survive a reload and go out to the board.
describe("project folders", () => {
  it("adds and removes a project's folders, kept across a reload", async () => {
    const s = await load();
    const { projectFolders, setProjectFolder } = await import("./project-folders");
    expect(projectFolders("/a")).toEqual([]);
    s.touchProject("/a");
    setProjectFolder("/a", "/api", true);
    setProjectFolder("/a", "/docs", true);
    expect(projectFolders("/a")).toEqual(["/api", "/docs"]);
    const again = await load();
    expect(again.listProjects().find((p) => p.path === "/a")?.folders).toEqual(["/api", "/docs"]);
    const reloaded = await import("./project-folders");
    reloaded.setProjectFolder("/a", "/api", false);
    expect(reloaded.projectFolders("/a")).toEqual(["/docs"]);
  });
});
