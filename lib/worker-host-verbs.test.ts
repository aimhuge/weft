// A verb on one of your workers itself (settings.get / settings.put): a host row for that worker, with no folder and
// no card, only to a worker you enrolled, and only a host-level verb.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, workerRow } from "./worker-board.harness";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: vi.fn(() => Promise.resolve("org-1")) }));

const { sendWorkerHostVerb } = await import("./worker-host-verbs");

beforeEach(() => vi.clearAllMocks());

describe("sendWorkerHostVerb", () => {
  it("queues the verb for the worker, addressed to no card", async () => {
    const { client, inserted } = fakeClient({ workers: [workerRow()], insertId: "cmd-4" });
    expect(await sendWorkerHostVerb({ workerId: "w1", verb: "settings.put", args: { patch: { maxThreads: 2 }, id: "c9" } }, client)).toEqual({ commandId: "cmd-4" });
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "host",
      target_device: "worker:w1",
      folder: "",
      payload: { verb: "settings.put", args: { patch: { maxThreads: 2 }, id: "" } },
    });
    const get = fakeClient({ workers: [workerRow()] });
    await sendWorkerHostVerb({ workerId: "w1", verb: "settings.get" }, get.client);
    expect(get.inserted()).toMatchObject({ payload: { verb: "settings.get", args: { id: "" } } });
  });

  it("refuses a card verb, a verb no host runs, someone else's worker, and a failed insert", async () => {
    const { client } = fakeClient({ workers: [workerRow()] });
    await expect(sendWorkerHostVerb({ workerId: "w1", verb: "card.stop" }, client)).rejects.toThrow("A worker doesn't take card.stop for itself.");
    await expect(sendWorkerHostVerb({ workerId: "w1", verb: "rm" }, client)).rejects.toThrow("A worker doesn't take rm for itself.");
    await expect(sendWorkerHostVerb({ workerId: "w2", verb: "settings.get" }, client)).rejects.toThrow("That worker isn't one of yours.");
    const broken = fakeClient({ workers: [workerRow()], insertError: { message: "denied" } });
    await expect(sendWorkerHostVerb({ workerId: "w1", verb: "settings.get" }, broken.client)).rejects.toThrow("Couldn't reach your worker: denied");
  });

  it("asks you to sign in first", async () => {
    const { client } = fakeClient({ user: null });
    await expect(sendWorkerHostVerb({ workerId: "w1", verb: "settings.get" }, client)).rejects.toThrow(/Sign in/);
  });
});
