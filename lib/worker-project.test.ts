// The pure half of a worker project (lib/worker-project.ts): the worker:// path a worker's project carries,
// the folder a Mac can act on, and the summaries and menus the board draws from them.
import { describe, expect, it } from "vitest";
import type { ProjectSummary, ProjectWorker } from "./board-view";
import type { Card, Column } from "./types";
import {
  EMPTY_WORKER_BOARD,
  isWorkerCard,
  isWorkerProject,
  localColumns,
  localPath,
  offlineMessage,
  parseWorkerProject,
  withWorkerProjects,
  workerLabel,
  workerProjectMenu,
  workerProjectPath,
} from "./worker-project";

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({ path: "/dev/app", lastActivity: 0, cards: 0, running: 0, needsYou: 0, ...over });

const card = (over: Partial<Card> = {}): Card => ({ id: "c1", cwd: "/dev/app", ...over }) as Card;

describe("worker paths", () => {
  it("names a worker's project with the worker and the folder", () => {
    expect(workerProjectPath("w1", "ling")).toBe("worker://w1/ling");
    expect(workerProjectPath("w1", "a/b")).toBe("worker://w1/a/b");
  });

  it("knows which paths belong to a worker", () => {
    expect(isWorkerProject("worker://w1/ling")).toBe(true);
    expect(isWorkerProject("/dev/app")).toBe(false);
    expect(isWorkerProject("")).toBe(false);
    expect(isWorkerProject(null)).toBe(false);
    expect(isWorkerProject(undefined)).toBe(false);
  });

  it("knows which cards run on a worker", () => {
    expect(isWorkerCard({ cwd: "worker://w1/ling" })).toBe(true);
    expect(isWorkerCard({ cwd: "/dev/app" })).toBe(false);
  });

  it("reads the worker and the folder back out of a path", () => {
    expect(parseWorkerProject("worker://w1/ling")).toEqual({ workerId: "w1", folder: "ling" });
    expect(parseWorkerProject("worker://w1/a/b")).toEqual({ workerId: "w1", folder: "a/b" });
  });

  it("has no worker for anything that isn't a worker path", () => {
    expect(parseWorkerProject("/dev/app")).toBeNull();
    expect(parseWorkerProject("worker://w1")).toBeNull();
    expect(parseWorkerProject("worker://w1/")).toBeNull();
    expect(parseWorkerProject("worker:///ling")).toBeNull();
  });
});

describe("localPath", () => {
  it("keeps a folder this Mac has and drops a worker's", () => {
    expect(localPath("/dev/app")).toBe("/dev/app");
    expect(localPath("worker://w1/ling")).toBeNull();
    expect(localPath(null)).toBeNull();
    // A missing path stays missing; the type carries it through.
    expect(localPath(undefined)).toBeUndefined();
  });
});

describe("workerLabel", () => {
  it("says where the project lives, and when the worker is gone", () => {
    expect(workerLabel({ name: "m1mini", status: "online" })).toBe("on m1mini");
    expect(workerLabel({ name: "m1mini", status: "busy" })).toBe("on m1mini");
    expect(workerLabel({ name: "m1mini", status: "offline" })).toBe("on m1mini · offline");
  });
});

describe("offlineMessage", () => {
  it("says the worker is offline and that nothing ran here", () => {
    expect(offlineMessage("m1mini")).toBe("m1mini is offline, so this didn't start. Nothing ran on this Mac; try again once it's back.");
  });
});

describe("withWorkerProjects", () => {
  it("marks a local summary that names a worker", () => {
    const out = withWorkerProjects([summary({ path: "worker://w1/ling" })], [{ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "busy" }]);
    expect(out).toEqual([summary({ path: "worker://w1/ling", worker: { name: "m1mini", status: "busy" } })]);
  });

  it("adds a row for a worker project with no cards yet", () => {
    const out = withWorkerProjects([], [{ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online" }]);
    expect(out).toEqual([{ path: "worker://w1/ling", lastActivity: 0, cards: 0, running: 0, needsYou: 0, worker: { name: "m1mini", status: "online" } }]);
  });

  it("leaves a local project's summary alone", () => {
    const out = withWorkerProjects([summary({ path: "/dev/app", cards: 3 })], []);
    expect(out).toEqual([summary({ path: "/dev/app", cards: 3 })]);
  });

  it("doesn't add a second row for a project the summaries already have", () => {
    const out = withWorkerProjects([summary({ path: "worker://w1/ling", cards: 2 })], [{ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online" }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cards: 2, worker: { name: "m1mini", status: "online" } });
  });
});

describe("localColumns", () => {
  it("takes the worker's cards out of every column", () => {
    const byColumn = new Map<Column, Card[]>([
      ["review", [card({ id: "l1" }), card({ id: "w1", cwd: "worker://w1/ling" })]],
      ["running", [card({ id: "w2", cwd: "worker://w2/other" })]],
    ]);
    const out = localColumns(byColumn);
    expect(out.get("review")?.map((c) => c.id)).toEqual(["l1"]);
    expect(out.get("running")).toEqual([]);
  });

  it("keeps the columns that have nothing in them", () => {
    const out = localColumns(new Map<Column, Card[]>([["done", []]]));
    expect(out.get("done")).toEqual([]);
    expect(out.has("done")).toBe(true);
  });
});

describe("workerProjectMenu", () => {
  it("offers only a new thread, and says where it runs", () => {
    const worker: ProjectWorker = { name: "m1mini", status: "online" };
    expect(workerProjectMenu("ling", worker)).toEqual([{ id: "new", label: "New Thread in ling", enabled: true, detail: "on m1mini" }]);
  });

  it("can't start a thread on a worker that's offline", () => {
    const worker: ProjectWorker = { name: "m1mini", status: "offline" };
    expect(workerProjectMenu("ling", worker)).toEqual([{ id: "new", label: "New Thread in ling", enabled: false, detail: "on m1mini · offline" }]);
  });
});

describe("EMPTY_WORKER_BOARD", () => {
  it("is signed out with nothing on it", () => {
    expect(EMPTY_WORKER_BOARD).toEqual({ signedIn: false, projects: [], cards: [] });
  });
});
