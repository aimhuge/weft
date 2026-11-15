import { beforeEach, describe, expect, it, vi } from "vitest";
import { footprints, MAX_AGE_MS } from "./dev-footprint";
import { idleState, keep } from "./dev-idle-state";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__weftFootprints;
});

describe("footprints", () => {
  it("reads every pid with one top and reuses the answer for MAX_AGE_MS", async () => {
    const read = vi.fn(() => Promise.resolve("PID MEM\n1  2G\n2  10M\n"));
    const first = await footprints([1, 2], 1000, read);
    expect(first).toEqual(new Map([[1, 2 * 1024 * 1024], [2, 10 * 1024]]));
    expect(read).toHaveBeenCalledWith(["-l", "1", "-stats", "pid,mem", "-pid", "1", "-pid", "2"]);
    await footprints([1], 1000 + MAX_AGE_MS - 1, read);
    expect(read).toHaveBeenCalledTimes(1);
    await footprints([1, 3], 1001, read);
    await footprints([1], 1001 + MAX_AGE_MS, read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("answers nothing for no pids or when top fails", async () => {
    const read = vi.fn(() => Promise.reject(new Error("no top")));
    expect(await footprints([], 0, read)).toEqual(new Map());
    expect(await footprints([1], 0, read)).toEqual(new Map());
  });

  it("runs the real top by default", async () => {
    const kb = await footprints([process.pid]);
    expect(kb.get(process.pid) ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("keep", () => {
  it("takes a server out of the stop list and restarts its clock", () => {
    idleState.pending.set("untracked:1", { stopAt: 5 });
    keep("untracked:1", 42);
    expect(idleState.kept.has("untracked:1")).toBe(true);
    expect(idleState.pending.has("untracked:1")).toBe(false);
    expect(idleState.activeAt.get("untracked:1")).toBe(42);
    keep("untracked:2");
    expect(idleState.activeAt.get("untracked:2")).toBeGreaterThan(0);
  });
});
