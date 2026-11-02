import { describe, expect, it } from "vitest";
import { marked, touched, withFolder } from "./project-list";

describe("touched", () => {
  it("puts the folder first with the new time, unhidden and still pinned", () => {
    const list = [{ path: "/a", lastUsedAt: 1 }, { path: "/b", lastUsedAt: 2, pinned: true, hidden: true }];
    expect(touched(list, "/b", 9, 40)).toEqual([{ path: "/b", lastUsedAt: 9, pinned: true }, { path: "/a", lastUsedAt: 1 }]);
    expect(touched(list, "/c", 9, 40)[0]).toEqual({ path: "/c", lastUsedAt: 9 });
  });

  it("drops the oldest past max, but keeps pinned ones", () => {
    const list = [{ path: "/a", lastUsedAt: 2 }, { path: "/old", lastUsedAt: 1, pinned: true }, { path: "/b", lastUsedAt: 0 }];
    expect(touched(list, "/new", 9, 2).map((p) => p.path)).toEqual(["/new", "/a", "/old"]);
  });
});

describe("marked", () => {
  it("sets and clears marks, leaving no false flags behind", () => {
    const list = [{ path: "/a", lastUsedAt: 1 }];
    const pinned = marked(list, "/a", { pinned: true });
    expect(pinned).toEqual([{ path: "/a", lastUsedAt: 1, pinned: true }]);
    expect(marked(pinned, "/a", { pinned: false, hidden: false })).toEqual([{ path: "/a", lastUsedAt: 1 }]);
  });

  it("saves a folder that wasn't on the list", () => {
    expect(marked([], "/cards", { hidden: true })).toEqual([{ path: "/cards", lastUsedAt: 0, hidden: true }]);
  });
});

describe("withFolder", () => {
  it("adds a folder once, takes it off, and drops the key with the last one", () => {
    let list = withFolder([{ path: "/a", lastUsedAt: 1, pinned: true }], "/a", "/api", true);
    list = withFolder(list, "/a", "/api", true);
    expect(list).toEqual([{ path: "/a", lastUsedAt: 1, pinned: true, folders: ["/api"] }]);
    list = withFolder(list, "/a", "/docs", true);
    expect(list[0]!.folders).toEqual(["/api", "/docs"]);
    list = withFolder(withFolder(list, "/a", "/api", false), "/a", "/docs", false);
    expect(list).toEqual([{ path: "/a", lastUsedAt: 1, pinned: true }]);
  });

  it("never adds the project to itself, and saves a project only cards ran in", () => {
    expect(withFolder([], "/a", "/a", true)).toEqual([{ path: "/a", lastUsedAt: 0 }]);
    expect(withFolder([], "/a", "/api", true)).toEqual([{ path: "/a", lastUsedAt: 0, folders: ["/api"] }]);
  });

  it("keeps a project's folders when it's used again", () => {
    expect(touched([{ path: "/a", lastUsedAt: 1, folders: ["/api"] }], "/a", 9, 40)).toEqual([{ path: "/a", lastUsedAt: 9, folders: ["/api"] }]);
  });
});
