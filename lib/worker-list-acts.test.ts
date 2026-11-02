import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => ({ from: () => ({}) }) }));
const board = vi.hoisted(() => ({
  requireSession: vi.fn(() => Promise.resolve({ uid: "u1", org: "org-1" })),
  myWorkers: vi.fn(() => Promise.resolve([{ id: "w1" }])),
  insert: vi.fn<(...args: unknown[]) => Promise<{ commandId: string }>>(() => Promise.resolve({ commandId: "cmd-1" })),
}));
vi.mock("./worker-board", () => board);
const commandResult = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ status: string; error: string | null; result?: unknown }>>(() => Promise.resolve({ status: "done", error: null, result: { ok: true, cardId: "" } })));
vi.mock("./workers-account", () => ({ commandResult }));
const lists = vi.hoisted(() => ({
  forgetWorkerListsSoon: vi.fn(),
  workerLists: vi.fn(() => Promise.resolve({ crons: [], webhooks: [{ id: "worker:w1:h1", relayId: "r1" }] as { id: string; relayId?: string }[] })),
}));
vi.mock("./worker-lists-read", () => lists);

const { actOnWorkerItem, deleteWorkerWebhook, NOT_WORKER_ITEM } = await import("./worker-list-acts");

const NOW = { every: 1, unclaimed: -1, claimed: -1, sleep: () => Promise.resolve() };
const deleted: string[] = [];
const relays = (error: { message: string } | null = null) =>
  ({ from: (table: string) => ({ delete: () => ({ eq: (_c: string, id: string) => (deleted.push(`${table}:${id}`), Promise.resolve({ error })) }) }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  deleted.length = 0;
});

describe("actOnWorkerItem", () => {
  it("sends the verb to the item's own worker as a host row naming the item, and waits for it", async () => {
    expect(await actOnWorkerItem("worker:w1:k1", "cron.update", { patch: { enabled: false } }, relays(), NOW)).toEqual({});
    expect(board.insert).toHaveBeenCalledWith(expect.anything(), {
      org_id: "org-1",
      kind: "host",
      target_device: "worker:w1",
      folder: "-",
      payload: { verb: "cron.update", args: { patch: { enabled: false }, id: "k1" } },
    });
    expect(commandResult).toHaveBeenCalledWith("cmd-1", expect.anything());
    expect(lists.forgetWorkerListsSoon).toHaveBeenCalled();
  });

  it("answers a run's card, and queued when the worker hasn't taken it", async () => {
    commandResult.mockResolvedValueOnce({ status: "done", error: null, result: { ok: true, cardId: "run-1" } });
    expect(await actOnWorkerItem("worker:w1:k1", "cron.run", {}, relays(), NOW)).toEqual({ cardId: "run-1" });
    commandResult.mockResolvedValueOnce({ status: "pending", error: null });
    expect(await actOnWorkerItem("worker:w1:k1", "cron.run", undefined, relays(), NOW)).toEqual({ queued: true });
  });

  it("rejects with the worker's refusal, or a plain one when it gave none", async () => {
    commandResult.mockResolvedValueOnce({ status: "failed", error: "No such cron." });
    await expect(actOnWorkerItem("worker:w1:k1", "cron.delete", {}, relays(), NOW)).rejects.toThrow("No such cron.");
    commandResult.mockResolvedValueOnce({ status: "failed", error: null });
    await expect(actOnWorkerItem("worker:w1:k1", "cron.delete", {}, relays(), NOW)).rejects.toThrow("Your worker couldn't do that.");
  });

  it("reaches only the owner's own workers, and only a worker's item", async () => {
    await expect(actOnWorkerItem("k1", "cron.delete", {}, relays(), NOW)).rejects.toThrow(NOT_WORKER_ITEM);
    await expect(actOnWorkerItem("worker:w9:k1", "cron.delete", {}, relays(), NOW)).rejects.toThrow("That worker isn't one of yours.");
    expect(board.insert).not.toHaveBeenCalled();
  });

  it("uses the account client and the drawer's wait by default, asking again until it's done", async () => {
    commandResult.mockResolvedValueOnce({ status: "claimed", error: null });
    commandResult.mockResolvedValueOnce({ status: "done", error: null, result: null });
    expect(await actOnWorkerItem("worker:w1:k1", "cron.delete")).toEqual({});
    expect(commandResult).toHaveBeenCalledTimes(2);
  });
});

describe("deleteWorkerWebhook", () => {
  it("drops the webhook on the worker, then its relay row", async () => {
    expect(await deleteWorkerWebhook("worker:w1:h1", relays(), NOW)).toEqual({});
    expect(board.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payload: { verb: "webhook.delete", args: { id: "h1" } } }));
    expect(deleted).toEqual(["webhook_relays:r1"]);
  });

  it("leaves the relay while the delete is queued, and when there's none", async () => {
    commandResult.mockResolvedValueOnce({ status: "pending", error: null });
    expect(await deleteWorkerWebhook("worker:w1:h1", relays(), NOW)).toEqual({ queued: true });
    expect(await deleteWorkerWebhook("worker:w1:h2", relays(), NOW)).toEqual({});
    expect(deleted).toEqual([]);
  });

  it("says when the relay couldn't be taken down", async () => {
    await expect(deleteWorkerWebhook("worker:w1:h1", relays({ message: "denied" }), NOW)).rejects.toThrow(/couldn't be taken down: denied/);
  });

  it("uses the account client by default", async () => {
    expect(await deleteWorkerWebhook("worker:w1:h2")).toEqual({});
  });
});
