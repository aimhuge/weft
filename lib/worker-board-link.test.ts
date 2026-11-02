import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardCards, boardLink, localFolder, remoteTarget, rowCard, setBoardLink, type BoardLink } from "./worker-board-link";
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
    expect(remoteTarget("worker://w2/app", [], "w1")).toEqual({ target: "worker:w2", folder: "app", where: "worker" });
  });

  it("finds a Mac project by path or by name, and another worker's by name", () => {
    expect(remoteTarget("/Users/me/app", [row()], "w1")).toEqual({ target: "mac-1", folder: "/Users/me/app", where: "Mac" });
    expect(remoteTarget("app", [row(), row({ card_id: "c2" })], "w1")).toEqual({ target: "mac-1", folder: "/Users/me/app", where: "Mac" });
    expect(remoteTarget("site", [row({ owner_worker: "w2", folder: "site" })], "w1")).toEqual({ target: "worker:w2", folder: "site", where: "worker" });
  });

  it("never matches this worker's own rows, and names the choices when there are several", () => {
    expect(() => remoteTarget("weft", [row({ owner_worker: "w1", folder: "weft" })], "w1")).toThrow(/No project “weft”/);
    expect(() => remoteTarget("app", [row(), row({ owner_worker: "w2", folder: "app" })], "w1")).toThrow(/more than one project/);
  });

  it("lists the projects it knows when none matches, and the work root", () => {
    expect(() => remoteTarget("nope", [row(), row({ owner_worker: "w2", folder: "site" })], "w1")).toThrow(/Projects with cards: \/Users\/me\/app, worker:\/\/w2\/site\. A project on this worker is a folder under/);
    expect(() => remoteTarget("nope", [], "w1")).toThrow(/^No project “nope” on this worker or on your board\. A project/);
  });
});
