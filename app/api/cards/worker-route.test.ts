// A new thread in a worker project (app/api/cards/route.ts): the card never lands on this Mac; the run goes
// to the worker instead, and a worker that's offline says so. The guard, the store and the engine are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  guard: () => null,
  elevated: () => null,
  fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }),
}));
const engine = vi.hoisted(() => ({
  createCardFromBody: vi.fn(() => ({ id: "c1", cwd: "/dev/app" })),
  startCard: vi.fn(() => ({ started: true })),
}));
vi.mock("@/lib/new-card", () => ({ createCardFromBody: engine.createCardFromBody, startCard: engine.startCard }));
vi.mock("@/lib/store", () => ({ getCard: (id: string) => ({ id }), listCards: () => [], deleteCard: vi.fn() }));
vi.mock("@/lib/copilot", () => ({ prewarm: vi.fn() }));
vi.mock("@/lib/repos", () => ({ projectRoot: (cwd: string) => cwd }));
vi.mock("@/lib/settings", () => ({ listProjects: () => [] }));
const handoff = vi.hoisted(() => ({
  runsOnWorker: vi.fn(() => false),
  handOffToWorker: vi.fn(() => Promise.resolve({ started: false, worker: "m1mini" })),
  requireWorker: vi.fn(() => Promise.resolve({ name: "m1mini" })),
}));
vi.mock("@/lib/worker-handoff", () => handoff);
const workerBoard = vi.hoisted(() => ({
  startWorkerThread: vi.fn(() => Promise.resolve({ commandId: "cmd-1", worker: "m1mini" })),
}));
vi.mock("@/lib/worker-board", () => workerBoard);

const cardsRoute = await import("./route");

const post = (body: unknown) => new Request("http://localhost/api/cards", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  workerBoard.startWorkerThread.mockResolvedValue({ commandId: "cmd-1", worker: "m1mini" });
});

describe("POST /cards in a worker project", () => {
  it("starts the thread on the worker and makes no card here", async () => {
    const res = await cardsRoute.POST(post({ cwd: "worker://w1/ling", prompt: "go", start: true }));
    expect(await res.json()).toEqual({ card: null, start: { started: false, worker: "m1mini" } });
    expect(workerBoard.startWorkerThread).toHaveBeenCalledWith({ cwd: "worker://w1/ling", prompt: "go", start: true });
    expect(engine.createCardFromBody).not.toHaveBeenCalled();
    expect(engine.startCard).not.toHaveBeenCalled();
  });

  it("says a worker project has no backlog when there's no start", async () => {
    const res = await cardsRoute.POST(post({ cwd: "worker://w1/ling", prompt: "go" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A worker project has no Backlog. Start the thread instead." });
    expect(workerBoard.startWorkerThread).not.toHaveBeenCalled();
    expect(engine.createCardFromBody).not.toHaveBeenCalled();
  });

  it("says what went wrong when the worker can't take the thread", async () => {
    workerBoard.startWorkerThread.mockRejectedValueOnce(new Error("m1mini is offline, so this didn't start. Nothing ran on this Mac; try again once it's back."));
    const res = await cardsRoute.POST(post({ cwd: "worker://w1/ling", prompt: "go", start: true }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "m1mini is offline, so this didn't start. Nothing ran on this Mac; try again once it's back." });
    expect(engine.createCardFromBody).not.toHaveBeenCalled();
  });
});
