import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardCards, boardLink, boardMacProjects, boardMacs, localFolder, projectRows, remoteTarget, rowCard, setBoardLink, type BoardLink } from "./worker-board-link";
import type { Card } from "./types";
import type { BoardRow } from "./worker-registry";

let root = "";
const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  card_id: "c1",
  folder: "/Users/me/app",
  owner_device: "mac-1",
  owner_worker: null,
  card: { id: "c1", title: "Fix it", column: "running", updatedAt: 5, cwd: "/elsewhere" },
  updated_at: "t",
  ...over,
});

function link(rows: BoardRow[] = []): BoardLink {
  return { workerId: "w1", root, cards: vi.fn(() => Promise.resolve(rows)), newCard: vi.fn(() => Promise.resolve("cmd-1")), setLists: vi.fn(() => Promise.resolve(null)) };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wbl-"));
  fs.mkdirSync(path.join(root, "weft"));
});
afterEach(() => {
  setBoardLink(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("boardLink", () => {
  it("throws until the worker binds one", () => {
    expect(() => boardLink()).toThrow(/can't reach your board/);
    const l = link();
    setBoardLink(l);
    expect(boardLink()).toBe(l);
  });
});

describe("rowCard", () => {
  it("puts a Mac card on its path and a worker card on worker://", () => {
    expect(rowCard(row()).cwd).toBe("/Users/me/app");
    expect(rowCard(row({ owner_worker: "w2", folder: "app" })).cwd).toBe("worker://w2/app");
  });

  it("puts a Mac card on mac://<Mac>/<path> once the Mac's label is known", () => {
    expect(rowCard(row(), new Map([["mac-1", "MacBook-Air-3"]])).cwd).toBe("mac://MacBook-Air-3/Users/me/app");
  });

  it("draws a sealed field as the lock, since a worker holds no workspace key", () => {
    const sealed = { $sealed: 1, v: 1, n: "n", c: "c" };
    const card = rowCard(row({ card: { id: "c1", title: sealed, lastLine: sealed, column: "review" } }));
    expect(card.title).toBe("🔒 sealed");
    expect(card.lastLine).toBeUndefined();
    expect(card.column).toBe("review");
  });
});

describe("boardCards", () => {
  it("is this worker's own cards plus every other synced card, never its own row twice", async () => {
    setBoardLink(link([row(), row({ card_id: "mine", owner_worker: "w1", folder: "weft" }), row({ card_id: "own-local", owner_worker: "w2", folder: "x" })]));
    const own = [{ id: "own-local", cwd: "/w/weft" } as Card];
    const cards = await boardCards(own);
    expect(cards.map((c) => c.id)).toEqual(["own-local", "c1"]);
    expect(cards[1]?.cwd).toBe("mac://mac-1/Users/me/app");
  });
});

describe("boardMacs", () => {
  it("is the link's Macs, or none when the link predates them or the read fails", async () => {
    const macs = [{ device: "mac-1", name: "Air" }];
    expect(await boardMacs({ macs: () => Promise.resolve(macs) })).toEqual(macs);
    expect(await boardMacs({})).toEqual([]);
    expect(await boardMacs({ macs: () => Promise.reject(new Error("no function")) })).toEqual([]);
  });

  it("reads the bound link by default", async () => {
    setBoardLink({ ...link(), macs: () => Promise.resolve([{ device: "mac-1", name: "Air" }]) });
    expect(await boardMacs()).toEqual([{ device: "mac-1", name: "Air" }]);
  });
});

describe("localFolder", () => {
  const l = () => ({ workerId: "w1", root });

  it("is the thread's own folder for an empty one", () => {
    expect(localFolder("  ", l(), "/w/own")).toBe("/w/own");
  });

  it("takes this worker's worker:// path, a path under the work root and a project name there", () => {
    expect(localFolder("worker://w1/weft", l(), "")).toBe(path.join(root, "weft"));
    expect(localFolder(path.join(root, "weft"), l(), "")).toBe(path.join(root, "weft"));
    expect(localFolder("weft", l(), "")).toBe(path.join(root, "weft"));
  });

  it("is null for another host's project", () => {
    expect(localFolder("worker://w2/weft", l(), "")).toBeNull();
    expect(localFolder("mac://Air/weft", l(), "")).toBeNull();
    expect(localFolder("/Users/me/app", l(), "")).toBeNull();
    expect(localFolder(path.join(root, "missing"), l(), "")).toBeNull();
    expect(localFolder("missing", l(), "")).toBeNull();
    expect(localFolder("a/b", l(), "")).toBeNull();
    expect(localFolder("~/nowhere-weft-test", l(), "")).toBeNull();
  });

  it("throws on a broken worker path", () => {
    expect(() => localFolder("worker://w1", l(), "")).toThrow(/isn't a project/);
  });
});

describe("remoteTarget", () => {
  beforeEach(() => setBoardLink(link()));

  it("sends a worker:// path to that worker", () => {
    expect(remoteTarget("worker://w2/app", [], "w1")).toEqual({ target: "worker:w2", folder: "app", where: "worker", address: "worker://w2/app" });
  });

  it("finds a Mac project by path or by name, and another worker's by name", () => {
    const mac = { target: "mac-1", folder: "/Users/me/app", where: "Mac", address: "mac://mac-1/Users/me/app" };
    expect(remoteTarget("/Users/me/app", [row()], "w1")).toEqual(mac);
    expect(remoteTarget("app", [row(), row({ card_id: "c2" })], "w1")).toEqual(mac);
    expect(remoteTarget("site", [row({ owner_worker: "w2", folder: "site" })], "w1")).toEqual({ target: "worker:w2", folder: "site", where: "worker", address: "worker://w2/site" });
  });

  it("never matches this worker's own rows, and names the choices when there are several", () => {
    expect(() => remoteTarget("weft", [row({ owner_worker: "w1", folder: "weft" })], "w1")).toThrow(/No project “weft”/);
    expect(() => remoteTarget("app", [row(), row({ owner_worker: "w2", folder: "app" })], "w1")).toThrow(
      "“app” is more than one project on your board. Pass one of these as the folder: mac://mac-1/Users/me/app, worker://w2/app.",
    );
  });

  it("lists the projects it knows when none matches, and the work root", () => {
    expect(() => remoteTarget("nope", [row(), row({ owner_worker: "w2", folder: "site" })], "w1")).toThrow(/Projects: mac:\/\/mac-1\/Users\/me\/app, worker:\/\/w2\/site\. A project on this worker is a folder under/);
    expect(() => remoteTarget("nope", [], "w1")).toThrow(/^No project “nope” on this worker or on your board\. A project.*mac:\/\/<Mac>\/<path>, and shows here once Sync is on for it \(Settings → Sync on that Mac\)\.$/);
  });

  describe("mac://", () => {
    const air = "a".repeat(64);
    const mini = "b".repeat(64);
    const macs = [
      { device: air, name: "MacBook-Air-3" },
      { device: mini, name: "mini" },
    ];
    const rows = [row({ owner_device: air }), row({ card_id: "c2", owner_device: mini }), row({ card_id: "c3", owner_device: mini, folder: "/Users/me/dev/site" })];

    it("tells two Macs with the same path apart, by name (case aside), id or the start of it", () => {
      expect(() => remoteTarget("/Users/me/app", rows, "w1", macs)).toThrow("Pass one of these as the folder: mac://MacBook-Air-3/Users/me/app, mac://mini/Users/me/app.");
      expect(remoteTarget("mac://macbook-air-3/Users/me/app", rows, "w1", macs)).toEqual({ target: air, folder: "/Users/me/app", where: "Mac", address: "mac://MacBook-Air-3/Users/me/app" });
      expect(remoteTarget(`mac://${mini}/Users/me/app`, rows, "w1", macs).target).toBe(mini);
      expect(remoteTarget("mac://bbbbbbbb/Users/me/app", rows, "w1", macs).target).toBe(mini);
    });

    it("takes a project name on that Mac, and a folder with no cards there as written", () => {
      expect(remoteTarget("mac://mini/site", rows, "w1", macs).folder).toBe("/Users/me/dev/site");
      expect(remoteTarget("mac://mini/fresh", rows, "w1", macs).folder).toBe("fresh");
      expect(remoteTarget("mac://mini//Users/me/new", rows, "w1", macs)).toMatchObject({ target: mini, folder: "/Users/me/new", address: "mac://mini/Users/me/new" });
    });

    it("lists both folders when a name is two projects on that Mac", () => {
      const two = [...rows, row({ card_id: "c4", owner_device: mini, folder: "/Users/me/old/site" })];
      expect(() => remoteTarget("mac://mini/site", two, "w1", macs)).toThrow(
        "“mac://mini/site” is more than one project on that Mac. Pass one of these as the folder: mac://mini/Users/me/dev/site, mac://mini/Users/me/old/site.",
      );
    });

    it("reaches a Mac with no cards yet by its name", () => {
      expect(remoteTarget("mac://mini/Users/me/app", [], "w1", macs).target).toBe(mini);
    });

    it("expands a ~ path to that Mac's published home, else the home its cards show, else asks for the full path", () => {
      expect(remoteTarget("mac://mini/~/dev/new", rows, "w1", macs, [{ device: mini, home: "/Users/pub/", folders: [] }])).toMatchObject({ target: mini, folder: "/Users/pub/dev/new" });
      expect(remoteTarget("mac://mini/~/dev/site", rows, "w1", macs)).toMatchObject({ target: mini, folder: "/Users/me/dev/site" });
      expect(() => remoteTarget("mac://mini/~/dev/site", [], "w1", macs)).toThrow("Can't tell where ~ is on that Mac from its cards: pass the full path, like mac://mini/Users/<you>/dev/site.");
    });

    it("matches a bare ~ path against the Macs' folders", () => {
      expect(remoteTarget("~/dev/site", rows, "w1", macs)).toMatchObject({ target: mini, folder: "/Users/me/dev/site" });
      expect(() => remoteTarget("~/app", rows, "w1", macs)).toThrow(/mac:\/\/MacBook-Air-3\/Users\/me\/app, mac:\/\/mini\/Users\/me\/app/);
      expect(() => remoteTarget("~/site", [row({ owner_worker: "w2", folder: "site" })], "w1", macs)).toThrow(/No project “~\/site”/);
    });

    it("collapses one Mac seen under two device ids (a re-pair) to its live one", () => {
      const old = "d".repeat(64);
      const repaired = "e".repeat(64);
      const twice = [row({ owner_device: old, folder: "/Users/me/dev/weft" }), row({ card_id: "c2", owner_device: repaired, folder: "/Users/me/dev/weft" })];
      expect(remoteTarget("/Users/me/dev/weft", twice, "w1", [{ device: repaired, name: "Mac" }])).toMatchObject({ target: repaired, address: "mac://Mac/Users/me/dev/weft" });
      const both = [
        { device: repaired, name: "Mac" },
        { device: old, name: "Mac" },
      ];
      expect(remoteTarget("~/dev/weft", twice, "w1", both)).toMatchObject({ target: repaired, address: "mac://eeeeeeeeeeee/Users/me/dev/weft" });
      expect(() => remoteTarget("/Users/me/dev/weft", twice, "w1")).toThrow("mac://dddddddddddd/Users/me/dev/weft, mac://eeeeeeeeeeee/Users/me/dev/weft.");
    });

    it("refuses a broken path and an unknown Mac, naming the Macs it knows", () => {
      expect(() => remoteTarget("mac://mini", rows, "w1", macs)).toThrow(/isn't a Mac project/);
      expect(() => remoteTarget("mac://nope/Users/me/app", rows, "w1", macs)).toThrow("No Mac “nope” on your board. Your Macs: MacBook-Air-3, mini.");
    });
  });

  describe("a Mac's published projects", () => {
    const air = { device: "mac-1", name: "MacBook-Air-3" };
    const fresh = [{ device: "mac-1", home: "/Users/me", folders: ["/Users/me/dev/weft-mobile", "/Users/me/app"] }];

    it("finds a project with no cards by path, name or ~ path under that Mac's home", () => {
      for (const name of ["/Users/me/dev/weft-mobile", "weft-mobile", "~/dev/weft-mobile", "~/dev/weft-mobile/"]) {
        expect(remoteTarget(name, [], "w1", [air], fresh)).toEqual({ target: "mac-1", folder: "/Users/me/dev/weft-mobile", where: "Mac", address: "mac://MacBook-Air-3/Users/me/dev/weft-mobile" });
      }
    });

    it("reads ~ as the Mac's published home, never this worker's", () => {
      const other = [{ device: "mac-1", home: "/Users/alex", folders: ["/Users/alex/dev/weft-mobile"] }];
      expect(remoteTarget("~/dev/weft-mobile", [], "w1", [air], other).folder).toBe("/Users/alex/dev/weft-mobile");
      expect(remoteTarget("mac://MacBook-Air-3/~/dev/new", [], "w1", [air], other).folder).toBe("/Users/alex/dev/new");
      expect(() => remoteTarget("~/dev/nope", [], "w1", [air], other)).toThrow(/No project “~\/dev\/nope”/);
    });

    it("is one project when it has cards too, and finds a name on a mac:// path among them", () => {
      expect(remoteTarget("app", [row()], "w1", [air], fresh).address).toBe("mac://MacBook-Air-3/Users/me/app");
      expect(remoteTarget("mac://MacBook-Air-3/weft-mobile", [], "w1", [air], fresh).folder).toBe("/Users/me/dev/weft-mobile");
    });

    it("lists the published projects when none matches", () => {
      expect(() => remoteTarget("nope", [], "w1", [air], fresh)).toThrow(/Projects: mac:\/\/MacBook-Air-3\/Users\/me\/dev\/weft-mobile, mac:\/\/MacBook-Air-3\/Users\/me\/app\./);
    });

    it("falls back to the folder's own home when the Mac's isn't a path", () => {
      expect(remoteTarget("~/app", [], "w1", [air], [{ device: "mac-1", home: "", folders: ["/Users/me/app"] }]).folder).toBe("/Users/me/app");
    });

    it("turns each folder into a row with no card", () => {
      expect(projectRows(fresh)[0]).toEqual({ card_id: "", folder: "/Users/me/dev/weft-mobile", owner_device: "mac-1", owner_worker: null, card: null, updated_at: "" });
    });
  });
});

describe("boardMacProjects", () => {
  it("is the link's projects, or none when the link predates them or the read fails", async () => {
    const rows = [{ device: "mac-1", home: "/Users/me", folders: ["/Users/me/app"] }];
    expect(await boardMacProjects({ macProjects: () => Promise.resolve(rows) })).toEqual(rows);
    expect(await boardMacProjects({})).toEqual([]);
    expect(await boardMacProjects({ macProjects: () => Promise.reject(new Error("no function")) })).toEqual([]);
  });

  it("reads the bound link by default", async () => {
    setBoardLink({ ...link(), macProjects: () => Promise.resolve([]) });
    expect(await boardMacProjects()).toEqual([]);
  });
});
