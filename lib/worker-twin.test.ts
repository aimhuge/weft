import { describe, expect, it } from "vitest";
import { twinByRepo, twinOf, twinsOf } from "./worker-twin";
import { workerProjectPath } from "./worker-project";

const project = workerProjectPath("w1", "Weft");

describe("twinOf", () => {
  it("finds this Mac's folder of the worker project's name, never another worker's", () => {
    expect(twinOf(project, [workerProjectPath("w2", "weft"), "/Users/me/dev/ling", "/Users/me/dev/weft/"])).toBe("/Users/me/dev/weft/");
  });

  it("is null with no namesake, no project, or a project on this Mac", () => {
    expect(twinOf(project, ["/Users/me/dev/ling", "/"])).toBeNull();
    expect(twinOf(null, ["/Users/me/dev/weft"])).toBeNull();
    expect(twinOf("/Users/me/dev/weft", ["/Users/me/dev/weft"])).toBeNull();
  });
});

describe("twinsOf", () => {
  it("lists every namesake once, in order, so a caller can tell one repo from two", () => {
    expect(twinsOf(project, ["/a/weft", "/b/ling", "/c/Weft", "/a/weft"])).toEqual(["/a/weft", "/c/Weft"]);
    expect(twinsOf(null, ["/a/weft"])).toEqual([]);
  });
});

describe("twinByRepo", () => {
  it("finds the vault whose repo has the worker project's name", () => {
    const vaults = [{ label: "aimhuge/ling", folder: "/a/ling" }, { label: "aimhuge/weft", folder: "/b/code" }];
    expect(twinByRepo(project, vaults)).toBe("/b/code");
    expect(twinByRepo(workerProjectPath("w1", "nope"), vaults)).toBeNull();
    expect(twinByRepo(undefined, vaults)).toBeNull();
  });
});
