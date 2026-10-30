// Your Weft Workers on the desktop board (app/api/worker-board/route.ts): GET lists their projects and
// reads a thread's page or a tool's output, POST sends a reply, an answer or a stop. The guard and the
// cloud rows are mocked; lib/worker-board.test.ts covers the rows themselves.
import type { ThreadPage } from "@/lib/thread-page";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const guard = vi.hoisted(() => ({ denied: null as Response | null, elevated: null as Response | null }));
vi.mock("@/lib/guard", () => ({
  guard: () => guard.denied,
  elevated: () => guard.elevated,
  fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }),
}));
const board = vi.hoisted(() => ({
  readWorkerBoard: vi.fn(() => Promise.resolve({ signedIn: true, projects: [], cards: [] })),
  sendWorkerAction: vi.fn(() => Promise.resolve({ commandId: "cmd-1" })),
  workerThreadPage: vi.fn((): Promise<ThreadPage | null> => Promise.resolve(null)),
  workerToolOutput: vi.fn(() => Promise.resolve("the whole thing")),
}));
vi.mock("@/lib/worker-board", () => board);

const route = await import("./route");

const get = (url: string) => new Request(`http://localhost/api${url}`);
const post = (body: unknown) => new Request("http://localhost/api/worker-board", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  guard.denied = null;
  guard.elevated = null;
  board.readWorkerBoard.mockResolvedValue({ signedIn: true, projects: [], cards: [] });
  board.sendWorkerAction.mockResolvedValue({ commandId: "cmd-1" });
  board.workerThreadPage.mockResolvedValue(null);
  board.workerToolOutput.mockResolvedValue("the whole thing");
});

describe("GET /worker-board", () => {
  it("refuses a call the guard turns down", async () => {
    guard.denied = Response.json({ error: "Forbidden host" }, { status: 403 });
    const res = await route.GET(get("/worker-board"));
    expect(res.status).toBe(403);
    expect(board.readWorkerBoard).not.toHaveBeenCalled();
  });

  it("lists the workers' projects and cards", async () => {
    const res = await route.GET(get("/worker-board"));
    expect(await res.json()).toEqual({ signedIn: true, projects: [], cards: [] });
    expect(board.readWorkerBoard).toHaveBeenCalled();
  });

  it("reads a page of a thread", async () => {
    board.workerThreadPage.mockResolvedValueOnce({ items: [], start: 0, total: 0 });
    const res = await route.GET(get("/worker-board?card=c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], start: 0, total: 0 });
    expect(board.workerThreadPage).toHaveBeenCalledWith("c1", undefined);
  });

  it("walks back through a thread with before", async () => {
    board.workerThreadPage.mockResolvedValueOnce({ items: [], start: 0, total: 0 });
    await route.GET(get("/worker-board?card=c1&before=5"));
    expect(board.workerThreadPage).toHaveBeenCalledWith("c1", 5);
  });

  it("says the thread can't be read when there's no page", async () => {
    const res = await route.GET(get("/worker-board?card=c1"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "That thread can't be read." });
  });

  it("reads a tool's full result", async () => {
    const res = await route.GET(get("/worker-board?card=c1&tool=t1"));
    expect(await res.json()).toEqual({ result: "the whole thing" });
    expect(board.workerToolOutput).toHaveBeenCalledWith("c1", "t1");
  });

  it("says the output can't be read when the read fails", async () => {
    board.workerToolOutput.mockRejectedValueOnce(new Error("That output isn't there."));
    const res = await route.GET(get("/worker-board?card=c1&tool=t1"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "That output isn't there." });
  });

  it("says the board can't be read when the read fails", async () => {
    board.readWorkerBoard.mockRejectedValueOnce(new Error("Sign in to Weft to reach your worker."));
    const res = await route.GET(get("/worker-board"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Sign in to Weft to reach your worker." });
  });
});

describe("POST /worker-board", () => {
  it("refuses a call the guard turns down", async () => {
    guard.denied = Response.json({ error: "Missing x-weft-token header" }, { status: 403 });
    const res = await route.POST(post({ action: "stop", cardId: "c1" }));
    expect(res.status).toBe(403);
    expect(board.sendWorkerAction).not.toHaveBeenCalled();
  });

  it("takes an answer only from Weft's own window, where a reply needs no more than the guard", async () => {
    guard.elevated = Response.json({ error: "This change needs Weft's own window" }, { status: 403 });
    const answer = await route.POST(post({ action: "answer", cardId: "c1", pendingId: "p1", allow: true, grant: "always" }));
    expect(answer.status).toBe(403);
    expect(board.sendWorkerAction).not.toHaveBeenCalled();
    expect((await route.POST(post({ action: "reply", cardId: "c1", text: "hi" }))).status).toBe(200);
  });

  it("sends the action and says the command's id", async () => {
    const res = await route.POST(post({ action: "reply", cardId: "c1", text: "hello" }));
    expect(await res.json()).toEqual({ commandId: "cmd-1" });
    expect(board.sendWorkerAction).toHaveBeenCalledWith({ action: "reply", cardId: "c1", text: "hello" });
  });

  it("says what went wrong when the action fails", async () => {
    board.sendWorkerAction.mockRejectedValueOnce(new Error("That thread isn't on one of your workers."));
    const res = await route.POST(post({ action: "stop", cardId: "c1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That thread isn't on one of your workers." });
  });
});
