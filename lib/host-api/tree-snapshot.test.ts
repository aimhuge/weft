import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ busy: [] as string[], cwd: new Map<string, string>() }));
vi.mock("../runner-state", () => ({ busyCards: () => state.busy }));
vi.mock("../store", () => ({ getCard: (id: string) => (state.cwd.has(id) ? { cwd: state.cwd.get(id) } : undefined), DATA_DIR: "/nowhere" }));

const { treeSnapshotVerb, NOT_A_WORKER } = await import("./tree-snapshot");

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const snap = { sha: "s", head: "h", at: 1, files: 2, mac: "m1mini", branch: "main" };
let home: string;
let env: Record<string, string>;
const run = (folder: unknown, over: Record<string, string | undefined> = {}) => {
  const snapshot = vi.fn(() => Promise.resolve(snap));
  const push = vi.fn(() => Promise.resolve());
  return { snapshot, push, reply: treeSnapshotVerb({ folder }, undefined, { env: { ...env, ...over } as NodeJS.ProcessEnv, snapshot, push }) };
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tree-"));
  fs.mkdirSync(path.join(home, "work", "weft"), { recursive: true });
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ workerId: W, orgId: "o", ownerUser: "u", device: `worker:${W}`, key: "wwk_x", name: "m1mini" }));
  env = { WEFT_WORKER: "1", WEFT_WORKER_HOME: home };
  state.busy = [];
  state.cwd.clear();
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("tree.snapshot", () => {
  it("snapshots the project and pushes it under the worker's id, counting the threads mid-turn there", async () => {
    const dir = path.join(home, "work", "weft");
    state.busy = ["c1", "c2", "c3", "c4"];
    state.cwd.set("c1", dir).set("c2", path.join(dir, "app")).set("c3", `${dir}-other`);
    const { reply, snapshot, push } = run("weft");
    expect(await reply).toEqual({ ...snap, running: 2 });
    expect(snapshot).toHaveBeenCalledWith(dir, { device: W, mac: "m1mini" });
    expect(push).toHaveBeenCalledWith(dir, W);
  });

  it("is a worker's alone: a Mac, or a worker that isn't enrolled, refuses", async () => {
    await expect(run("weft", { WEFT_WORKER: undefined }).reply).rejects.toThrow(NOT_A_WORKER);
    fs.rmSync(path.join(home, "worker.json"));
    await expect(run("weft").reply).rejects.toThrow(NOT_A_WORKER);
  });

  it("only takes a project that's on the worker", async () => {
    await expect(run("../weft").reply).rejects.toThrow("isn't on this worker");
    await expect(run("nope").reply).rejects.toThrow("isn't on this worker");
    await expect(run(undefined).reply).rejects.toThrow("isn't on this worker");
  });
});
