// @vitest-environment jsdom
// The workers' board over session lines (lib/worker-board-line.ts, lib/use-worker-board.ts): a snapshot over a line
// as it comes up, the read slowed while every worker shown has one, and read at once when one goes down.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineRoute } from "./session-line";
import type { Card } from "./types";
import type { WorkerBoard, WorkerProject } from "./worker-project";

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
vi.mock("./api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string) => fetchMock(url) }));
vi.mock("./worker-transport", () => ({ sendWorkerAction: vi.fn() }));
vi.mock("./project-host", () => ({ hostOf: () => ({ act: vi.fn() }) }));

const { BOARD_POLL_MS, IDLE_POLL_MS, useWorkerBoard } = await import("./use-worker-board");
const { allOnLines, readSnapshot, withSnapshot } = await import("./worker-board-line");
const { closeLines, retainLine } = await import("./session-lines");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const project = (over: Partial<WorkerProject> = {}): WorkerProject => ({ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online", ...over });
const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix it", cwd: "worker://w1/ling", column: "review", ...over }) as Card;
const board = (over: Partial<WorkerBoard> = {}): WorkerBoard => ({ signedIn: true, projects: [project()], cards: [card()], ...over });

// A line the test drives: whether it's up, its route, its events and its card.list answer.
function fakeLine(workerId = "w1") {
  let route: LineRoute = { kind: "connecting" };
  let up = false;
  const routes = new Set<() => void>();
  const events = new Set<(e: unknown) => void>();
  const call = vi.fn<(verb: string, args: unknown) => Promise<unknown>>(() => Promise.resolve({ ok: true, cardId: "", value: { cards: [] } }));
  retainLine(workerId, () => ({ up: () => up, route: () => route, call, onRoute: (fn: () => void) => (routes.add(fn), () => routes.delete(fn)), onEvent: (fn: (e: unknown) => void) => (events.add(fn), () => events.delete(fn)), close: vi.fn() }) as never);
  return {
    call,
    set(direct: boolean) {
      up = direct;
      route = direct ? { kind: "direct", ms: 3 } : { kind: "relay" };
      routes.forEach((fn) => fn());
    },
    emit: (e: unknown) => events.forEach((fn) => fn(e)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  closeLines();
  cleanup();
  vi.useRealTimers();
});

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const settle = () => wait(0);

describe("worker-board-line", () => {
  it("says every worker shown has a line only when each does, and never for none", () => {
    expect(allOnLines([], () => true)).toBe(false);
    expect(allOnLines([project(), project({ path: "worker://w1/b" })], (w) => w === "w1")).toBe(true);
    expect(allOnLines([project(), project({ workerId: "w2" })], (w) => w === "w1")).toBe(false);
  });

  it("lays a snapshot over the board: a card replaced or joining, with its project's path, only in a known project", () => {
    const snap = { cards: [{ card: card({ title: "New title", cwd: "/srv/ling" }), folder: "ling" }, { card: card({ id: "c2", cwd: "/srv/ling" }), folder: "ling" }, { card: card({ id: "c3" }), folder: "elsewhere" }] };
    const other = card({ id: "o1", cwd: "worker://w2/x" });
    const next = withSnapshot(board({ cards: [card(), other] }), "w1", snap);
    expect(next.cards.map((c) => [c.id, c.title, c.cwd])).toEqual([["o1", "Fix it", "worker://w2/x"], ["c1", "New title", "worker://w1/ling"], ["c2", "Fix it", "worker://w1/ling"]]);
  });

  it("reads card.list over a live line, its value or a blob, and nothing over a down or failing one", async () => {
    expect(await readSnapshot("w1")).toBeNull();
    const line = fakeLine();
    expect(await readSnapshot("w1")).toBeNull();
    line.set(true);
    line.call.mockResolvedValueOnce({ ok: true, cardId: "", value: { cards: [] } });
    expect(await readSnapshot("w1")).toEqual({ cards: [] });
    expect(line.call).toHaveBeenCalledWith("card.list", { id: "" });
    fetchMock.mockResolvedValueOnce(json({ value: { cards: [{ card: card(), folder: "ling" }] } }));
    line.call.mockResolvedValueOnce({ ok: true, cardId: "", blob: "ab".repeat(32) });
    expect((await readSnapshot("w1"))?.cards).toHaveLength(1);
    line.call.mockResolvedValueOnce({ ok: true, cardId: "" });
    expect(await readSnapshot("w1")).toBeNull();
    line.call.mockRejectedValueOnce(new Error("lost"));
    expect(await readSnapshot("w1")).toBeNull();
  });
});

describe("useWorkerBoard over lines", () => {
  it("takes a snapshot as a line comes up, slows the read while every worker has one, and reads at once when it drops", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(board())));
    const line = fakeLine();
    const { result } = renderHook(() => useWorkerBoard());
    await settle();
    line.call.mockResolvedValue({ ok: true, cardId: "", value: { cards: [{ card: card({ title: "From the line" }), folder: "ling" }] } });
    act(() => line.set(true));
    await settle();
    expect(result.current.cards[0]?.title).toBe("From the line");
    // The read that was already due runs, then the next waits the idle interval.
    await wait(BOARD_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await wait(BOARD_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => line.set(false));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await wait(BOARD_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(IDLE_POLL_MS).toBeGreaterThan(BOARD_POLL_MS * 3);
  });

  it("asks for a snapshot when a line brings a card the board hasn't read, and keeps a line's change under the next read", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(board({ delta: true, cards: [] }))));
    fetchMock.mockResolvedValueOnce(json(board()));
    const line = fakeLine();
    const { result } = renderHook(() => useWorkerBoard());
    await settle();
    line.set(true);
    await settle();
    line.call.mockClear();
    line.call.mockResolvedValue({ ok: true, cardId: "", value: { cards: [{ card: card({ id: "n1", title: "Brand new" }), folder: "ling" }] } });
    act(() => line.emit({ t: "card", card: card({ id: "n1", cwd: "/srv/ling" }) }));
    act(() => line.emit({ t: "card", card: card({ id: "n1", cwd: "/srv/ling" }) }));
    await settle();
    expect(line.call).toHaveBeenCalledOnce();
    expect(result.current.cards.map((c) => c.id).sort()).toEqual(["c1", "n1"]);
    act(() => line.emit({ t: "card", card: card({ title: "Renamed", cwd: "/srv/ling" }) }));
    act(() => line.emit({ t: "thread_cleared", cardId: "c1" }));
    await wait(IDLE_POLL_MS);
    expect(result.current.cards.find((c) => c.id === "c1")?.title).toBe("Renamed");
  });

  it("leaves a line's events and snapshot alone until the first read has come", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const line = fakeLine();
    const { result } = renderHook(() => useWorkerBoard());
    act(() => line.set(true));
    act(() => line.emit({ t: "card", card: card() }));
    await settle();
    expect(line.call).toHaveBeenCalledOnce();
    expect(result.current.cards).toEqual([]);
  });
});
