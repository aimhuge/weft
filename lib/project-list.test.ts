import { describe, expect, it } from "vitest";
import { marked, touched } from "./project-list";

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
