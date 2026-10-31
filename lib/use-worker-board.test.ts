// @vitest-environment jsdom
// Your workers' projects on the desktop board (lib/use-worker-board.ts): the poll that keeps them fresh, and
// the thread actions a worker card's panel gets.
import type { Card } from "./types";
import type { WorkerProject } from "./worker-project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock("./api-client", () => ({ apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const sendWorkerAction = vi.fn<(body: unknown) => Promise<{ commandId: string }>>();
vi.mock("./worker-transport", () => ({ sendWorkerAction: (body: unknown) => sendWorkerAction(body) }));

const { BOARD_POLL_MS, IDLE_POLL_MS, openWorkerThread, useWorkerBoard, workerThreadHandlers } = await import("./use-worker-board");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const board = (over: Record<string, unknown> = {}) => ({ signedIn: true, projects: [], cards: [], ...over });

const project = (over: Record<string, unknown> = {}) => ({ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online", ...over }) as WorkerProject;

const card = (over: Record<string, unknown> = {}) => ({ id: "c1", title: "Fix it", prompt: "fix it", cwd: "worker://w1/ling", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over }) as unknown as Card;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useWorkerBoard", () => {
  it("reads the board and polls it every few seconds while there are projects", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(board({ projects: [project()] })));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.signedIn).toBe(true);
    expect(result.current.projects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/worker-board", undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("looks once a minute when there's no worker of yours", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(board()));
    renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps what's drawn when a read fails", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(board({ projects: [project()] })));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.projects).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 502));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(result.current.projects).toHaveLength(1);
  });

  it("keeps what's drawn when the read throws", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(board({ projects: [project()] })));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(result.current.projects).toHaveLength(1);
  });

  it("doesn't draw a read that lands after the board went away", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { release = () => resolve(json(board({ projects: [project()] }))); }));
    const { result, unmount } = renderHook(() => useWorkerBoard());
    unmount();
    await act(async () => {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.projects).toEqual([]);
  });

  it("stops reading when the board goes away", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(board({ projects: [project()] })));
    const { unmount } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("openWorkerThread", () => {
  const ctx = { select: vi.fn(), notify: vi.fn() };

  it("has nothing for a card that isn't a worker's", () => {
    expect(openWorkerThread({ projects: [project()], cards: [] }, "c1", ctx)).toBeNull();
    expect(openWorkerThread({ projects: [], cards: [] }, null, ctx)).toBeNull();
  });

  it("names the worker the card runs on", () => {
    const open = openWorkerThread({ projects: [project()], cards: [card()] }, "c1", ctx);
    expect(open?.worker).toEqual({ name: "m1mini", status: "online" });
    expect(open?.card.id).toBe("c1");
  });

  it("says the worker is offline when its project isn't known", () => {
    const open = openWorkerThread({ projects: [], cards: [card()] }, "c1", ctx);
    expect(open?.worker).toEqual({ name: "Your worker", status: "offline" });
  });

  it("says the worker is offline when its project says so", () => {
    const open = openWorkerThread({ projects: [project({ status: "offline" })], cards: [card()] }, "c1", ctx);
    expect(open?.worker.status).toBe("offline");
  });
});

describe("workerThreadHandlers", () => {
  const ctx = { select: vi.fn(), notify: vi.fn() };

  beforeEach(() => {
    sendWorkerAction.mockResolvedValue({ commandId: "cmd-1" });
  });

  it("sends a reply as a command", async () => {
    const handlers = workerThreadHandlers(card(), ctx);
    await handlers.onSend("hello");
    expect(sendWorkerAction).toHaveBeenCalledWith({ action: "reply", cardId: "c1", text: "hello" });
  });

  it("sends an answer as a command, with the pending id", async () => {
    const handlers = workerThreadHandlers(card({ pending: { id: "p1" } }), ctx);
    await handlers.onAnswer(true, { q: "a" });
    expect(sendWorkerAction).toHaveBeenCalledWith({ action: "answer", cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" }, reply: undefined });
  });

  it("sends nothing when nothing is waiting for an answer", async () => {
    const handlers = workerThreadHandlers(card(), ctx);
    await expect(handlers.onAnswer(true)).resolves.toBeUndefined();
    expect(sendWorkerAction).not.toHaveBeenCalled();
  });

  it("says so when an answer fails, and throws it on", async () => {
    const boom = new Error("That thread isn't on one of your workers.");
    sendWorkerAction.mockRejectedValueOnce(boom);
    const handlers = workerThreadHandlers(card({ pending: { id: "p1" } }), ctx);
    await expect(handlers.onAnswer(false)).rejects.toThrow("That thread isn't on one of your workers.");
    expect(ctx.notify).toHaveBeenCalledWith(boom);
  });

  it("closes the thread", () => {
    const handlers = workerThreadHandlers(card(), ctx);
    handlers.onClose();
    expect(ctx.select).toHaveBeenCalledWith(null);
  });
});
