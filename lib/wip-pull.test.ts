import { describe, expect, it, vi } from "vitest";

// The real pieces, for the one test that runs the default wiring.
const real = vi.hoisted(() => ({
  send: vi.fn(() => Promise.resolve({ commandId: "cmd-9" })),
  result: vi.fn(() => Promise.resolve({ status: "done", error: null, result: { ok: true, value: { running: 0 } } })),
  wait: vi.fn((read: () => Promise<unknown>) => read()),
  fetch: vi.fn(() => Promise.resolve({})),
  apply: vi.fn(() => Promise.resolve({ mac: "m1mini", changed: 1, install: false })),
}));
vi.mock("./worker-host-verbs", () => ({ sendWorkerHostVerb: real.send }));
vi.mock("./workers-account", () => ({ commandResult: real.result }));
vi.mock("./worker-command-wait", () => ({ waitForCommand: real.wait }));
vi.mock("./wip-snapshot", () => ({ fetchWip: real.fetch, applyWip: real.apply }));
vi.mock("./device-id", () => ({ deviceId: () => "d".repeat(64) }));
vi.mock("./repos", () => ({ projectRoot: (cwd: string) => cwd.replace(/\/sub$/, "") }));
vi.mock("./runner-state", () => ({ busyCards: () => ["c1", "gone"] }));
vi.mock("./store", () => ({ getCard: (id: string) => (id === "c1" ? { cwd: "/elsewhere" } : undefined) }));

const { pullWip, pulledNote } = await import("./wip-pull");
type Deps = NonNullable<Parameters<typeof pullWip>[2]>;

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const FROM = `worker://${W}/weft`;
const applied = { sha: "s", head: "h", at: 1, files: 2, mac: "m1mini", branch: "main", changed: 2, install: false };

function deps(over: Partial<Deps> = {}) {
  const d: Deps = {
    send: vi.fn(() => Promise.resolve({ commandId: "cmd-1" })),
    wait: vi.fn(() => Promise.resolve({ status: "done" as const, error: null, result: { ok: true, cardId: "", value: { running: 1 } } })),
    fetch: vi.fn(() => Promise.resolve(applied)),
    apply: vi.fn(() => Promise.resolve(applied)),
    self: () => "a".repeat(64),
    root: (folder) => folder,
    busy: () => ["/elsewhere", "/repo-two"],
    ...over,
  };
  return d;
}

describe("pullWip", () => {
  it("asks the worker for its project's snapshot, fetches it and checks it out here", async () => {
    const d = deps();
    expect(await pullWip("/repo", FROM, d)).toEqual({ ...applied, running: 1 });
    expect(d.send).toHaveBeenCalledWith(W, "weft");
    expect(d.wait).toHaveBeenCalledWith("cmd-1");
    expect(d.fetch).toHaveBeenCalledWith("/repo", W);
    expect(d.apply).toHaveBeenCalledWith("/repo", W, "a".repeat(64));
  });

  it("only pulls from a worker's project", async () => {
    await expect(pullWip("/repo", "/Users/me/other", deps())).rejects.toThrow("Pick one of your Weft Workers' projects");
  });

  it("won't rewrite files under a thread that's running here", async () => {
    const one = deps({ busy: () => ["/repo"] });
    await expect(pullWip("/repo", FROM, one)).rejects.toThrow("1 thread still running in repo here. Stop it first: a pull rewrites the files under it.");
    expect(one.send).not.toHaveBeenCalled();
    await expect(pullWip("/repo", FROM, deps({ busy: () => ["/repo", "/repo/sub"] }))).rejects.toThrow("2 threads still running in repo here. Stop them first");
  });

  it("says why the worker didn't send its work", async () => {
    const waited = (r: unknown) => deps({ wait: () => Promise.resolve(r as never) });
    await expect(pullWip("/repo", FROM, waited({ status: "pending", error: null }))).rejects.toThrow("didn't answer");
    await expect(pullWip("/repo", FROM, waited({ status: "claimed", error: null }))).rejects.toThrow("still sending");
    await expect(pullWip("/repo", FROM, waited({ status: "failed", error: "This project isn't on a branch" }))).rejects.toThrow("isn't on a branch");
    await expect(pullWip("/repo", FROM, waited({ status: "done", error: null, result: { ok: false, error: "no push" } }))).rejects.toThrow("no push");
    await expect(pullWip("/repo", FROM, waited({ status: "done", error: null }))).rejects.toThrow("couldn't send its work");
  });

  it("says when the snapshot never reached the remote, and counts no threads when the worker names none", async () => {
    await expect(pullWip("/repo", FROM, deps({ fetch: () => Promise.resolve(null) }))).rejects.toThrow("didn't reach the project's remote");
    const quiet = deps({ wait: () => Promise.resolve({ status: "done", error: null, result: { ok: true } }) });
    expect((await pullWip("/repo", FROM, quiet)).running).toBe(0);
  });
});

describe("pullWip's own wiring", () => {
  it("sends tree.snapshot to the worker, waits on its row and applies under this Mac's id in the project's root", async () => {
    expect(await pullWip("/repo/sub", FROM)).toEqual({ mac: "m1mini", changed: 1, install: false, running: 0 });
    expect(real.send).toHaveBeenCalledWith({ workerId: W, verb: "tree.snapshot", args: { folder: "weft" } });
    expect(real.result).toHaveBeenCalledWith("cmd-9");
    expect(real.wait).toHaveBeenCalledWith(expect.any(Function), { every: 1000, unclaimed: 20_000, claimed: 120_000 });
    expect(real.apply).toHaveBeenCalledWith("/repo", W, "d".repeat(64));
  });
});

describe("pulledNote", () => {
  it("says what came, and what to do about it", () => {
    expect(pulledNote({ mac: "m1mini", changed: 1, install: false, running: 0 })).toBe("Pulled 1 file of uncommitted work from m1mini.");
    expect(pulledNote({ mac: "m1mini", changed: 7, install: true, running: 2 })).toBe(
      "Pulled 7 files of uncommitted work from m1mini. A lockfile changed: install dependencies. 2 threads still running there, so more may follow.",
    );
    expect(pulledNote({ mac: "m1mini", changed: 0, install: false, running: 1 })).toBe("Already level with m1mini. 1 thread still running there, so more may follow.");
  });
});
