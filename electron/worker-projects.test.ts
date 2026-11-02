import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createKnownRepos, createProjectRepos } from "./worker-projects.cjs";

function dataDir(settings: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-projects-"));
  if (settings !== undefined) fs.writeFileSync(path.join(dir, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return dir;
}

const ids: Record<string, string> = { "/a/weft": "github:aimhuge/weft", "/b/Weft": "github:fork/weft", "/c/weft": "folder:/c/weft", "/d/other": "github:x/other" };
const idFor = (folder: string) => (folder === "/e/weft" ? Promise.reject(new Error("no git")) : Promise.resolve({ id: ids[folder] ?? "" }));

describe("createProjectRepos", () => {
  it("names the GitHub repos of this Mac's projects and worker folders with that folder name", async () => {
    const repos = createProjectRepos({ dataDir: dataDir({ projects: [{ path: "/a/weft" }, { path: "/c/weft" }, { path: "/d/other" }, null], workerFolders: ["/b/Weft", "/e/weft", "/a/weft", 5] }), idFor });
    expect((await repos("WEFT")).sort()).toEqual(["github:aimhuge/weft", "github:fork/weft"]);
    expect(await repos("nothing")).toEqual([]);
  });

  it("knows nothing without settings, or with settings it can't read", async () => {
    expect(await createProjectRepos({ dataDir: dataDir(undefined), idFor })("weft")).toEqual([]);
    expect(await createProjectRepos({ dataDir: dataDir("{"), idFor })("weft")).toEqual([]);
    expect(await createProjectRepos({ dataDir: dataDir({ projects: "x" }), idFor })("weft")).toEqual([]);
  });

  it("reads a folder's remote with git by default", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wp-repo-"));
    const named = path.join(repo, "weft");
    fs.mkdirSync(named);
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q", named]);
    execFileSync("git", ["-C", named, "remote", "add", "origin", "git@github.com:AimHuge/Weft.git"]);
    expect(await createProjectRepos({ dataDir: dataDir({ projects: [{ path: named }] }) })("weft")).toEqual(["github:aimhuge/weft"]);
  });
});

describe("createKnownRepos", () => {
  it("lists every GitHub repo this Mac has a checkout of, once, sorted, skipping the rest", async () => {
    const ids: Record<string, string> = { "/a/weft": "github:ada/weft", "/b/web": "github:ada/web", "/c/weft": "github:ada/weft", "/d/x": "folder:/d/x" };
    const idFor = (f: string) => (ids[f] ? Promise.resolve({ id: ids[f] }) : Promise.reject(new Error("no git")));
    const known = createKnownRepos({ dataDir: dataDir({ projects: [{ path: "/a/weft" }, { path: "/d/x" }, { path: "/e/none" }], workerFolders: ["/b/web", "/c/weft"] }), idFor });
    expect(await known()).toEqual(["ada/web", "ada/weft"]);
  });

  it("reads each folder's git origin by default", async () => {
    expect(await createKnownRepos({ dataDir: dataDir({ projects: [{ path: path.join(os.tmpdir(), "no-such-repo-xyz") }] }) })()).toEqual([]);
  });
});
