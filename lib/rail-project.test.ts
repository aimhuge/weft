import { describe, expect, it } from "vitest";
import { githubFolders, railProjects } from "./rail-project";
import { workerProjectPath } from "./worker-project";

const worker = workerProjectPath("w1", "weft");
const folders = ["/Users/me/dev/ling", "/Users/me/dev/weft"];

describe("railProjects", () => {
  it("reads a Mac project, or all of them, as it is", () => {
    expect(railProjects("/Users/me/dev/ling", folders, [])).toEqual({ repo: "/Users/me/dev/ling", host: "/Users/me/dev/ling" });
    expect(railProjects(null, folders, [])).toEqual({ repo: null, host: null });
  });

  it("reads a worker project's twin for the per-repo drawers, and the project for the per-host ones", () => {
    expect(railProjects(worker, folders, [])).toEqual({ repo: "/Users/me/dev/weft", host: worker });
    expect(railProjects(worker, [], [{ label: "aimhuge/weft", folder: "/x/code" }])).toEqual({ repo: "/x/code", host: worker });
  });

  it("matches nothing with no twin, rather than every project", () => {
    expect(railProjects(worker, ["/Users/me/dev/ling"], [])).toEqual({ repo: worker, host: worker });
  });
});

describe("githubFolders", () => {
  it("adds the worker project in view once", () => {
    expect(githubFolders(folders, worker)).toEqual([...folders, worker]);
    expect(githubFolders([...folders, worker], worker)).toEqual([...folders, worker]);
    expect(githubFolders(folders, "/Users/me/dev/ling")).toEqual(folders);
    expect(githubFolders(folders, null)).toEqual(folders);
  });
});
