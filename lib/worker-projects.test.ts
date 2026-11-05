// A worker publishing its projects' snapshots (lib/worker-projects.ts): on a change once things settle, on a timer,
// never mid-turn unless the last pass is long past, and an unchanged folder only once REFRESH_MS has gone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "./project-reads";
import { EVERY_MS, REFRESH_MS, SETTLE_MS, createProjectPublisher } from "./worker-projects";

const snap = (score: number, at = 0): ProjectSnapshot => ({ at, quality: { root: "/w", score, sections: [], coverageAt: null }, scout: null, pile: null, backlog: null });

function setup(over: Partial<Parameters<typeof createProjectPublisher>[0]> = {}) {
  let clock = 1_000_000;
  const scores: Record<string, number> = { ling: 70, weft: 80 };
  const deps = {
    folders: vi.fn(() => Object.keys(scores)),
    read: vi.fn((folder: string) => snap(scores[folder] ?? 0, clock)),
    put: vi.fn<(folder: string, s: ProjectSnapshot) => Promise<unknown>>(() => Promise.resolve()),
    idle: vi.fn(() => true),
    log: vi.fn(),
    now: () => clock,
  };
  const pub = createProjectPublisher({ ...deps, ...over });
  return { pub, deps, scores, tick: (ms: number) => (clock += ms) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createProjectPublisher", () => {
  it("sends every folder, then only what changed until the refresh is due", async () => {
    const t = setup();
    await t.pub.publish();
    expect(t.deps.put).toHaveBeenCalledTimes(2);
    t.tick(60_000);
    t.scores.ling = 71;
    await t.pub.publish();
    expect(t.deps.put).toHaveBeenCalledTimes(3);
    const [folder, sent] = t.deps.put.mock.calls.at(-1) ?? [];
    expect(folder).toBe("ling");
    expect(sent?.quality?.score).toBe(71);
    t.tick(REFRESH_MS);
    await t.pub.publish();
    expect(t.deps.put).toHaveBeenCalledTimes(5);
  });

  it("waits out a running turn, unless the last pass is long past", async () => {
    const t = setup();
    await t.pub.publish();
    t.deps.idle.mockReturnValue(false);
    t.scores.ling = 10;
    t.tick(60_000);
    await t.pub.publish();
    expect(t.deps.put).toHaveBeenCalledTimes(2);
    t.tick(REFRESH_MS);
    await t.pub.publish();
    expect(t.deps.put).toHaveBeenCalledTimes(4);
  });

  it("logs a folder that fails and carries on with the rest", async () => {
    const t = setup();
    t.deps.put.mockRejectedValueOnce(new Error("unknown worker key"));
    await t.pub.publish();
    expect(t.deps.log).toHaveBeenCalledWith("Weft Worker: publishing ling: unknown worker key");
    expect(t.deps.put).toHaveBeenCalledWith("weft", expect.anything());
  });

  it("doesn't start a second pass while one is going", async () => {
    let release: () => void = () => {};
    const t = setup({ put: vi.fn(() => new Promise<unknown>((r) => (release = () => r(null)))) });
    const first = t.pub.publish();
    await t.pub.publish();
    expect(t.deps.read).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(t.deps.read).toHaveBeenCalledTimes(2));
    release();
    await first;
  });

  it("publishes once a burst of changes settles, and on its timer until stopped", async () => {
    const t = setup();
    const stop = t.pub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.deps.read).toHaveBeenCalledTimes(2);
    t.scores.ling = 1;
    t.pub.changed();
    t.pub.changed();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(t.deps.read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(EVERY_MS - SETTLE_MS);
    expect(t.deps.read).toHaveBeenCalledTimes(6);
    t.pub.changed();
    stop();
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(t.deps.read).toHaveBeenCalledTimes(6);
  });

  it("keeps its own clock when it's given none", async () => {
    const put = vi.fn(() => Promise.resolve());
    const pub = createProjectPublisher({ folders: () => ["ling"], read: () => snap(1), put, idle: () => true, log: vi.fn() });
    await pub.publish();
    await pub.publish();
    expect(put).toHaveBeenCalledTimes(1);
  });
});
