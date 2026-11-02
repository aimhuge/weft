import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => ({}) }));

const { forgetWorkerLists, forgetWorkerListsSoon, isWorkerItem, placeLists, readWorkerLists, workerLists } = await import("./worker-lists-read");

type Answer = { data: unknown; error: unknown };
function client({ session = true, lists = { data: [], error: null }, workers = { data: [], error: null }, throws = false }: { session?: boolean; lists?: Answer; workers?: Answer; throws?: boolean } = {}) {
  return {
    auth: { getSession: () => (throws ? Promise.reject(new Error("offline")) : Promise.resolve({ data: { session: session ? { user: { id: "u" } } : null } })) },
    from: (table: string) => ({ select: () => Promise.resolve(table === "cloud_worker_lists" ? lists : workers) }),
  } as never;
}

afterEach(() => forgetWorkerLists());

describe("placeLists", () => {
  it("puts each on its worker project's path with an id of its own and the worker's name", () => {
    const out = placeLists(
      [
        { worker_id: "w1", crons: [{ id: "c1", cwd: "weft" }] as never, webhooks: [{ id: "h1", folder: "app" }] as never },
        { worker_id: "w2", crons: null, webhooks: null },
      ],
      new Map([["w1", "mini"]]),
    );
    expect(out.crons).toEqual([{ id: "worker:w1:c1", cwd: "worker://w1/weft", worker: "mini" }]);
    expect(out.webhooks).toEqual([{ id: "worker:w1:h1", folder: "worker://w1/app", worker: "mini" }]);
    expect(placeLists([{ worker_id: "w9", crons: [{ id: "c", cwd: "x" }] as never, webhooks: [] }], new Map()).crons[0]?.worker).toBe("worker");
  });
});

describe("readWorkerLists", () => {
  it("reads the account's lists with the workers' names", async () => {
    const lists = { data: [{ worker_id: "w1", crons: [{ id: "c1", cwd: "weft" }], webhooks: [] }], error: null };
    const out = await readWorkerLists(client({ lists, workers: { data: [{ id: "w1", name: "mini" }], error: null } }));
    expect(out.crons[0]).toMatchObject({ id: "worker:w1:c1", worker: "mini" });
    expect((await readWorkerLists(client({ lists, workers: { data: null, error: { message: "x" } } }))).crons[0]?.worker).toBe("worker");
  });

  it("is empty signed out, offline or without the table", async () => {
    const empty = { crons: [], webhooks: [] };
    expect(await readWorkerLists(client({ session: false }))).toEqual(empty);
    expect(await readWorkerLists(client({ throws: true }))).toEqual(empty);
    expect(await readWorkerLists(client({ lists: { data: null, error: { message: "no table" } } }))).toEqual(empty);
    expect(await readWorkerLists(client({ lists: { data: null, error: null } }))).toEqual(empty);
  });

  it("uses the account client by default", async () => {
    expect(await readWorkerLists()).toEqual({ crons: [], webhooks: [] });
  });
});

describe("workerLists", () => {
  it("reads the cloud at most every 15 seconds", async () => {
    const read = vi.fn(() => Promise.resolve({ crons: [], webhooks: [] }));
    await workerLists(1_000, read);
    await workerLists(10_000, read);
    expect(read).toHaveBeenCalledTimes(1);
    await workerLists(20_000, read);
    expect(read).toHaveBeenCalledTimes(2);
    forgetWorkerLists();
    await workerLists(20_001);
  });

  it("forgets now and again once the worker has republished", async () => {
    vi.useFakeTimers();
    const read = vi.fn(() => Promise.resolve({ crons: [], webhooks: [] }));
    await workerLists(1_000, read);
    forgetWorkerListsSoon(3_000);
    await workerLists(1_001, read);
    expect(read).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3_000);
    await workerLists(1_002, read);
    expect(read).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe("worker items", () => {
  it("are told apart by id", () => {
    expect([isWorkerItem("worker:w1:c1"), isWorkerItem("c1")]).toEqual([true, false]);
  });
});
