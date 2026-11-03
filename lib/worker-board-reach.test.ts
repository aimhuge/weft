import { beforeEach, describe, expect, it, vi } from "vitest";

// How this Mac's board tools reach the user's Weft Workers (lib/worker-board-reach.ts): the account's reads and
// commands are mocked, so these check what each call sends and how a worker's answer comes back.
const m = vi.hoisted(() => ({
  readWorkerBoard: vi.fn(),
  workerThreadPage: vi.fn(),
  sendWorkerAction: vi.fn(),
  commandResult: vi.fn(),
  startWorkerThread: vi.fn(),
  waitForCommand: vi.fn(),
}));
vi.mock("./worker-board", () => ({ readWorkerBoard: m.readWorkerBoard, workerThreadPage: m.workerThreadPage, sendWorkerAction: m.sendWorkerAction }));
vi.mock("./workers-account", () => ({ commandResult: m.commandResult }));
vi.mock("./worker-new-thread", () => ({ startWorkerThread: m.startWorkerThread }));
vi.mock("./worker-command-wait", () => ({ waitForCommand: m.waitForCommand }));

const { TOOL_ACT_WAIT, accountReach, noWorkers, workerReach } = await import("./worker-board-reach");

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.sendWorkerAction.mockResolvedValue({ commandId: "cmd1" });
  m.waitForCommand.mockImplementation(async (read: () => Promise<unknown>) => read());
});

describe("workerReach", () => {
  it("is the account's on a Mac and none on a worker", () => {
    expect(workerReach({ ...process.env, WEFT_WORKER: "" })).toBe(accountReach);
    expect(workerReach({ ...process.env, WEFT_WORKER: "1" })).toBe(noWorkers);
  });

  it("none reads as no workers and refuses to act", async () => {
    expect(await noWorkers.board()).toEqual({ cards: [], projects: [] });
    expect(await noWorkers.page("c")).toBeNull();
    await expect(noWorkers.act("c", "card.stop", {})).rejects.toThrow("can't reach your Weft Workers");
    await expect(noWorkers.start({ cwd: "worker://w/a", prompt: "p" })).rejects.toThrow("can't reach your Weft Workers");
  });
});

describe("accountReach", () => {
  it("reads the workers' cards and projects, and a page of a card's thread", async () => {
    m.readWorkerBoard.mockResolvedValue({ signedIn: true, cards: [{ id: "c" }], projects: [{ path: "p" }], asOf: "x" });
    expect(await accountReach.board()).toEqual({ cards: [{ id: "c" }], projects: [{ path: "p" }] });
    m.workerThreadPage.mockResolvedValue({ items: [], start: 0, total: 0 });
    expect(await accountReach.page("c", 40)).toEqual({ items: [], start: 0, total: 0 });
    expect(m.workerThreadPage).toHaveBeenCalledWith("c", 40);
  });

  it("sends a verb as a host command on that card and waits for the worker", async () => {
    m.commandResult.mockResolvedValue({ status: "done", error: null });
    expect(await accountReach.act("c", "card.message", { text: "hi" })).toEqual({});
    expect(m.sendWorkerAction).toHaveBeenCalledWith({ action: "host", cardId: "c", verb: "card.message", args: { text: "hi", id: "c" } });
    expect(m.commandResult).toHaveBeenCalledWith("cmd1");
    expect(m.waitForCommand.mock.calls[0]?.[1]).toBe(TOOL_ACT_WAIT);
  });

  it("says queued when the worker hasn't taken it, and throws its refusal", async () => {
    m.commandResult.mockResolvedValue({ status: "pending", error: null });
    expect(await accountReach.act("c", "card.stop", { id: "other" })).toEqual({ queued: true });
    // args.id is always the card the command names.
    expect(m.sendWorkerAction).toHaveBeenCalledWith(expect.objectContaining({ args: { id: "c" } }));
    m.commandResult.mockResolvedValue({ status: "failed", error: "No." });
    await expect(accountReach.act("c", "card.stop", {})).rejects.toThrow("No.");
    m.commandResult.mockResolvedValue({ status: "failed", error: null });
    await expect(accountReach.act("c", "card.stop", {})).rejects.toThrow("Your worker couldn't do that.");
  });

  it("starts a thread through startWorkerThread", async () => {
    m.startWorkerThread.mockResolvedValue({ commandId: "x", worker: "m1mini", cardId: "n" });
    expect(await accountReach.start({ cwd: "worker://w/a", prompt: "p" })).toEqual({ commandId: "x", worker: "m1mini", cardId: "n" });
  });

  it("backs off between asks, up to every 2 s", () => {
    const every = TOOL_ACT_WAIT.every as (ask: number) => number;
    expect([0, 1, 2, 5].map(every)).toEqual([500, 1000, 2000, 2000]);
  });
});
