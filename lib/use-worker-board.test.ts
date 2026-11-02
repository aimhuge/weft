// @vitest-environment jsdom
// Your workers' projects on the desktop board (lib/use-worker-board.ts): the poll that keeps them fresh, and
// the thread actions a worker card's panel gets.
import type { Card } from "./types";
import type { WorkerProject } from "./worker-project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock("./api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const sendWorkerAction = vi.fn<(body: unknown) => Promise<{ commandId: string }>>();
vi.mock("./worker-transport", () => ({ sendWorkerAction: (body: unknown) => sendWorkerAction(body) }));
// A worker card's host (lib/project-host.ts): its verbs, as the handlers send them.
const hostAct = vi.fn<(verb: string, args: unknown) => Promise<void>>(() => Promise.resolve());
vi.mock("./project-host", () => ({ hostOf: () => ({ act: (verb: string, args: unknown) => hostAct(verb, args) }) }));

const { BOARD_POLL_MS, IDLE_POLL_MS, openWorkerThread, useBoardWorkers, useWorkerBoard, withLineEvent, workerThreadHandlers } = await import("./use-worker-board");
const { closeLines, retainLine } = await import("./session-lines");
const { forget, patchNow } = await import("./optimistic-cards");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const board = (over: Record<string, unknown> = {}) => ({ signedIn: true, projects: [], cards: [], ...over });

const project = (over: Record<string, unknown> = {}) => ({ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online", ...over }) as WorkerProject;

const card = (over: Record<string, unknown> = {}) => ({ id: "c1", title: "Fix it", prompt: "fix it", cwd: "worker://w1/ling", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over }) as unknown as Card;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
});

afterEach(() => {
  forget("c1");
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

describe("card changes off a session line", () => {
  it("lays a pushed card over the one read, keeping its worker path, drops a deleted one, and waits on unknown ones", () => {
    const cards = [card(), card({ id: "c2" })];
    expect(withLineEvent(cards, { t: "card", card: card({ title: "Pushed", cwd: "/w/ling" }) })[0]).toMatchObject({ title: "Pushed", cwd: "worker://w1/ling" });
    expect(withLineEvent(cards, { t: "card", card: card({ id: "c9" }) })).toEqual(cards);
    expect(withLineEvent(cards, { t: "card_deleted", id: "c2" }).map((c) => c.id)).toEqual(["c1"]);
    expect(withLineEvent(cards, { t: "thread_cleared", cardId: "c1" })).toBe(cards);
  });

  it("draws them on the board as they arrive", async () => {
    fetchMock.mockResolvedValue(json(board({ projects: [project()], cards: [card()] })));
    let emit: (e: unknown) => void = () => {};
    retainLine("w1", () => ({ onRoute: () => () => {}, onEvent: (fn: (e: unknown) => void) => ((emit = fn), () => {}), close: vi.fn() }) as never);
    const { result } = renderHook(() => useWorkerBoard());
    await vi.waitFor(() => expect(result.current.cards).toHaveLength(1));
    act(() => emit({ t: "card", card: card({ title: "Live", cwd: "/w/ling" }) }));
    expect(result.current.cards[0]).toMatchObject({ title: "Live", cwd: "worker://w1/ling" });
    act(() => emit({ t: "thread_cleared", cardId: "c1" }));
    act(() => emit({ t: "card_deleted", id: "c1" }));
    expect(result.current.cards).toEqual([]);
    closeLines();
  });
});

describe("a worker card's change, drawn at once", () => {
  it("shows the change before the worker has it, and takes it back with a fresh read when the worker refuses", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(json(board({ projects: [project()], cards: [card()] }))));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let refuse: ((err: Error) => void) | undefined;
    let sent: Promise<void> | undefined;
    act(() => {
      sent = patchNow("c1", { starred: true }, () => new Promise((_resolve, reject) => (refuse = reject)));
    });
    expect(result.current.cards[0]!.starred).toBe(true);
    await act(async () => {
      refuse?.(new Error("no"));
      await sent?.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.cards[0]!.starred).toBeUndefined();
  });

  it("keeps drawing it over a read that doesn't show it yet, and lets go once one does", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(json(board({ projects: [project()], cards: [card()] }))));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => void patchNow("c1", { title: "Renamed" }, () => Promise.resolve()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(result.current.cards[0]!.title).toBe("Renamed");
    fetchMock.mockImplementation(() => Promise.resolve(json(board({ projects: [project()], cards: [card({ title: "Renamed" })] }))));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    fetchMock.mockImplementation(() => Promise.resolve(json(board({ projects: [project()], cards: [card({ title: "Changed on the worker" })] }))));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(result.current.cards[0]!.title).toBe("Changed on the worker");
  });
});

describe("a reload while a read is out", () => {
  it("draws the newer read, never the older one landing after it, and keeps one polling loop", async () => {
    vi.useFakeTimers();
    const pending: ((title: string) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push((title) => resolve(json(board({ projects: [project()], cards: [card({ title })] }))))));
    const { result } = renderHook(() => useWorkerBoard());
    // The first read is out; a refused change asks for a reload, which starts a second one.
    await act(async () => {
      await patchNow("c1", { starred: true }, () => Promise.reject(new Error("no"))).catch(() => {});
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(() => Promise.resolve(json(board({ projects: [project()], cards: [card({ title: "New" })] }))));
    await act(async () => {
      pending[1]!("New");
      await vi.advanceTimersByTimeAsync(0);
      pending[0]!("Old");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.cards[0]!.title).toBe("New");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS * 3);
    });
    // One read per poll after the two: three, not six.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("useBoardWorkers", () => {
  it("draws this Mac's cards with the workers' after them", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(board({ projects: [project()], cards: [card()] })));
    const mine = [card({ id: "m1", cwd: "/r" })];
    const { result } = renderHook(() => useBoardWorkers(mine));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.boardCards.map((c) => c.id)).toEqual(["m1", "c1"]);
    expect(result.current.workers.projects).toHaveLength(1);
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
    ctx.select.mockClear();
    handlers.onDeleted();
    expect(ctx.select).toHaveBeenCalledWith(null);
  });

  it("deletes the card on its worker with card.delete, closing the thread at once", async () => {
    workerThreadHandlers(card(), ctx).onDelete();
    expect(ctx.select).toHaveBeenCalledWith(null);
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.delete", { id: "c1" });
  });

  it("says so when the worker refuses a delete", async () => {
    const boom = new Error("That thread isn't on this worker.");
    hostAct.mockRejectedValueOnce(boom);
    workerThreadHandlers(card(), ctx).onDelete();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.notify).toHaveBeenCalledWith(boom);
  });

  it("changes the mode on its worker with the menu's own verb, drawn at once", async () => {
    workerThreadHandlers(card(), ctx).onMode("acceptEdits");
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "c1", body: { permissionMode: "acceptEdits" } });
    expect(sendWorkerAction).not.toHaveBeenCalled();
  });

  it("renames the card on its worker", async () => {
    workerThreadHandlers(card(), ctx).onRename("A better name");
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "c1", body: { title: "A better name" } });
  });

  it("says so when the worker refuses a rename", async () => {
    const boom = new Error("no");
    hostAct.mockRejectedValueOnce(boom);
    workerThreadHandlers(card(), ctx).onRename("A better name");
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.notify).toHaveBeenCalledWith(boom);
  });
});
