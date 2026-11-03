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
  openWorkerLine: vi.fn(() => Promise.resolve({ commandId: "cmd-line" })),
}));
vi.mock("@/lib/worker-board", () => board);
const reads = vi.hoisted(() => ({
  workerProjectSnapshot: vi.fn(() => Promise.resolve({ snapshot: null, updatedAt: null, worker: "m1mini", status: "online" })),
  workerResultBlob: vi.fn(() => Promise.resolve({ value: { files: ["a.ts"] } })),
  workerThreadSearch: vi.fn((): Promise<{ index: number; hits: number }[] | null> => Promise.resolve([])),
  workerBlobUrls: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/lib/worker-board-reads", () => reads);
const pin = vi.hoisted(() => ({ pinWorkerPasskeys: vi.fn(() => Promise.resolve({ commandId: "cmd-pin" })) }));
vi.mock("@/lib/worker-pin", () => pin);
vi.mock("@/lib/worker-thread-reads", () => reads);
const twin = vi.hoisted(() => ({ macTwin: vi.fn((): string | null => "/Users/me/dev/ling") }));
vi.mock("@/lib/worker-twin-mac", () => twin);

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

describe("GET /worker-board thread reads", () => {
  it("finds a query over a card's whole thread", async () => {
    reads.workerThreadSearch.mockResolvedValueOnce([{ index: 3, hits: 2 }]);
    const res = await route.GET(get("/worker-board?card=c1&q=deploy"));
    expect(await res.json()).toEqual({ matches: [{ index: 3, hits: 2 }] });
    expect(reads.workerThreadSearch).toHaveBeenCalledWith("c1", "deploy");
    expect(board.workerThreadPage).not.toHaveBeenCalled();
  });

  it("says when a thread can't be searched", async () => {
    reads.workerThreadSearch.mockResolvedValueOnce(null);
    const res = await route.GET(get("/worker-board?card=c1&q=deploy"));
    expect(res.status).toBe(502);
  });

  it("signs the blob refs a thread's pictures name", async () => {
    const a = `blob:sha256:${"a".repeat(64)}`;
    reads.workerBlobUrls.mockResolvedValueOnce({ [a]: "https://sb.test/sign/a" });
    const res = await route.GET(get(`/worker-board?blobs=${a},nope`));
    expect(await res.json()).toEqual({ urls: { [a]: "https://sb.test/sign/a" } });
    expect(reads.workerBlobUrls).toHaveBeenCalledWith([a, "nope"]);
    expect(board.readWorkerBoard).not.toHaveBeenCalled();
  });

  it("names a worker project's checkout on this Mac, for an in-thread ask_add", async () => {
    const res = await route.GET(get(`/worker-board?twin=${encodeURIComponent("worker://w1/ling")}`));
    expect(await res.json()).toEqual({ folder: "/Users/me/dev/ling" });
    expect(twin.macTwin).toHaveBeenCalledWith("worker://w1/ling");
    expect(board.readWorkerBoard).not.toHaveBeenCalled();
  });
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

  it("reads a worker project's snapshot for the header badges", async () => {
    const res = await route.GET(get("/worker-board?project=worker%3A%2F%2Fw1%2Fling"));
    expect(await res.json()).toEqual({ snapshot: null, updatedAt: null, worker: "m1mini", status: "online" });
    expect(reads.workerProjectSnapshot).toHaveBeenCalledWith("worker://w1/ling");
  });

  it("reads a host verb's answer that went to the blob store, and says why it can't", async () => {
    const res = await route.GET(get("/worker-board?blob=abc"));
    expect(await res.json()).toEqual({ value: { files: ["a.ts"] } });
    expect(reads.workerResultBlob).toHaveBeenCalledWith("abc");
    reads.workerResultBlob.mockRejectedValueOnce(new Error("That result isn't in the blob store."));
    const gone = await route.GET(get("/worker-board?blob=def"));
    expect(gone.status).toBe(502);
    expect(await gone.json()).toEqual({ error: "That result isn't in the blob store." });
  });

  it("reads a page of a thread", async () => {
    board.workerThreadPage.mockResolvedValueOnce({ items: [], start: 0, total: 0 });
    const res = await route.GET(get("/worker-board?card=c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], start: 0, total: 0 });
    expect(board.workerThreadPage).toHaveBeenCalledWith("c1", undefined, undefined, undefined);
  });

  it("walks back through a thread with before", async () => {
    board.workerThreadPage.mockResolvedValueOnce({ items: [], start: 0, total: 0 });
    await route.GET(get("/worker-board?card=c1&before=5"));
    expect(board.workerThreadPage).toHaveBeenCalledWith("c1", 5, undefined, undefined);
  });

  it("sends only the items past after", async () => {
    board.workerThreadPage.mockResolvedValueOnce({ items: [], start: 8, total: 8 });
    await route.GET(get("/worker-board?card=c1&after=7"));
    expect(board.workerThreadPage).toHaveBeenCalledWith("c1", undefined, undefined, 7);
  });

  it("ignores an after that isn't a whole number", async () => {
    board.workerThreadPage.mockResolvedValueOnce({ items: [], start: 0, total: 0 });
    await route.GET(get("/worker-board?card=c1&after=soon"));
    expect(board.workerThreadPage).toHaveBeenCalledWith("c1", undefined, undefined, undefined);
  });

  it("reads only the cards changed since a time", async () => {
    await route.GET(get("/worker-board?since=2026-11-02T10:00:00.000Z"));
    expect(board.readWorkerBoard).toHaveBeenCalledWith(undefined, undefined, undefined, "2026-11-02T10:00:00.000Z");
  });

  it("ignores a since that isn't a time", async () => {
    await route.GET(get("/worker-board?since=yesterday"));
    expect(board.readWorkerBoard).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
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

  it.each([
    { action: "mode", cardId: "c1", mode: "auto" },
    { action: "input", cardId: "c1", input: { kind: "tap", device: "d", x: 0, y: 0 } },
    { action: "host", cardId: "c1", verb: "card.message", args: { text: "hi" } },
  ])("takes $action only from Weft's own window", async (body) => {
    guard.elevated = Response.json({ error: "Needs the launch token" }, { status: 403 });
    const res = await route.POST(post(body));
    expect(res.status).toBe(403);
    expect(board.sendWorkerAction).not.toHaveBeenCalled();
  });

  it("opens a session line only from Weft's own window, for a worker rather than a card", async () => {
    const body = { action: "line", workerId: "w1", offer: { sdp: "v=0", key: "k", topic: "t", ice: [] } };
    expect(await (await route.POST(post(body))).json()).toEqual({ commandId: "cmd-line" });
    expect(board.openWorkerLine).toHaveBeenCalledWith(body);
    expect(board.sendWorkerAction).not.toHaveBeenCalled();
    guard.elevated = Response.json({ error: "Needs the launch token" }, { status: 403 });
    expect((await route.POST(post(body))).status).toBe(403);
  });

  it("sends a Mac's passkey endorsements to a worker, only from Weft's own window", async () => {
    const body = { action: "pin", workerId: "w1", endorsements: [{ e: 1 }] };
    expect(await (await route.POST(post(body))).json()).toEqual({ commandId: "cmd-pin" });
    expect(pin.pinWorkerPasskeys).toHaveBeenCalledWith(body);
    guard.elevated = Response.json({ error: "Needs the launch token" }, { status: 403 });
    expect((await route.POST(post(body))).status).toBe(403);
  });

  it("says what went wrong when the action fails", async () => {
    board.sendWorkerAction.mockRejectedValueOnce(new Error("That thread isn't on one of your workers."));
    const res = await route.POST(post({ action: "stop", cardId: "c1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That thread isn't on one of your workers." });
  });
});
