import { describe, expect, it } from "vitest";
import { projectKeyOf, twinByRepo, twinMap, twinOf, twinsOf } from "./worker-twin";
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

describe("twinMap", () => {
  const w1 = workerProjectPath("w1", "Weft");
  const w2 = workerProjectPath("w2", "ling");
  it("maps a worker path to the one local folder of that name, ignoring case", () => {
    expect(twinMap(["/dev/weft", "/dev/app"], [w1, w2])).toEqual(new Map([[w1, "/dev/weft"]]));
  });
  it("leaves a name unmerged when two local folders share it, and skips scratch and worker paths", () => {
    expect(twinMap(["/a/weft", "/b/weft"], [w1]).size).toBe(0);
    expect(twinMap(["/tmp/weft", w1], [w1]).size).toBe(0);
    expect(twinMap(["/a/weft", "/tmp/weft"], [w1]).get(w1)).toBe("/a/weft");
  });
  it("ignores a non-worker path in the workers", () => {
    expect(twinMap(["/dev/weft"], ["/dev/weft"]).size).toBe(0);
  });
});

describe("projectKeyOf", () => {
  it("maps a card's root through the twins, else the root itself", () => {
    const w = workerProjectPath("w1", "weft");
    const key = projectKeyOf(new Map([[w, "/dev/weft"]]), (c) => (c.startsWith("/dev/weft") ? "/dev/weft" : c));
    expect(key(w)).toBe("/dev/weft");
    expect(key("/dev/weft/.wt")).toBe("/dev/weft");
    expect(key("/other")).toBe("/other");
  });
});
