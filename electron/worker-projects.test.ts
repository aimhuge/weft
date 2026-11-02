import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCardFolderPins, createProjectRepos } from "./worker-projects.cjs";

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

describe("createCardFolderPins", () => {
  it("pins a card's folder the first time and refuses it when the folder changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-card-folders-"));
    const pin = createCardFolderPins({ dataDir: dir });
    pin("w1", "card-1", "weft");
    pin("w1", "card-1", "weft");
    pin("w2", "card-1", "other");
    expect(() => pin("w1", "card-1", "secrets")).toThrow("was in weft when it first reached the vault, and says secrets now");
    expect(fs.statSync(path.join(dir, "vault", "worker-card-folders.json")).mode & 0o777).toBe(0o600);
    fs.writeFileSync(path.join(dir, "vault", "worker-card-folders.json"), "garbage");
    pin("w1", "card-9", "weft");
  });
});
