// @vitest-environment jsdom
// The workers' board read as changed cards only (lib/use-worker-board.ts, lib/worker-board-merge.ts).
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

const { BOARD_POLL_MS, useWorkerBoard } = await import("./use-worker-board");
const { forget, patchNow } = await import("./optimistic-cards");
const { FULL_READ_EVERY_MS } = await import("./worker-board-merge");
const { isActiveCard } = await import("./worker-poll");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const board = (over: Record<string, unknown> = {}) => ({ signedIn: true, projects: [], cards: [], ...over });

const project = (over: Record<string, unknown> = {}) => ({ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online", ...over }) as WorkerProject;

const card = (over: Record<string, unknown> = {}) => ({ id: "c1", title: "Fix it", prompt: "fix it", cwd: "worker://w1/ling", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over }) as unknown as Card;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
});

afterEach(() => {
  forget("a");
  cleanup();
  vi.useRealTimers();
});

describe("useWorkerBoard changed-cards reads", () => {
  const dated = (over: Record<string, unknown> = {}) => board({ projects: [project()], asOf: "2026-11-02T10:00:00.000Z", ...over });

  it("asks for only the cards changed since the last read, and merges them", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(dated({ cards: [card({ id: "a", title: "A" }), card({ id: "b", title: "B" })] })));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fetchMock.mockResolvedValueOnce(json(dated({ delta: true, asOf: "2026-11-02T10:00:09.000Z", cards: [card({ id: "b", title: "B2" })] })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/worker-board?since=2026-11-02T10%3A00%3A00.000Z");
    expect(result.current.cards.map((c) => c.title)).toEqual(["B2", "A"]);
    fetchMock.mockResolvedValueOnce(json(dated({ delta: true, asOf: "2026-11-02T10:00:09.000Z", cards: [] })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/worker-board?since=2026-11-02T10%3A00%3A09.000Z");
    expect(result.current.cards).toHaveLength(2);
  });

  it("reads the whole board again every few minutes, so a deleted card goes", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(dated({ cards: [card({ id: "a" })] })));
    const { result } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fetchMock.mockResolvedValue(json(dated({ delta: true, cards: [] })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FULL_READ_EVERY_MS - BOARD_POLL_MS);
    });
    expect(fetchMock.mock.calls.every((c, i) => i === 0 || c[0].includes("since="))).toBe(true);
    expect(result.current.cards).toHaveLength(1);
    fetchMock.mockResolvedValue(json(dated({ cards: [] })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS * 2);
    });
    expect(fetchMock.mock.calls.some((c, i) => i > 0 && c[0] === "/api/worker-board")).toBe(true);
    expect(result.current.cards).toHaveLength(0);
  });

  it("reads the whole board after a refused change", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(dated({ cards: [card({ id: "a" })] })));
    renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await patchNow("a", { title: "x" }, () => Promise.reject(new Error("refused"))).catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/worker-board");
  });

  it("tells the thread poll which cards run", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(dated({ cards: [card({ id: "a", column: "review" })] })));
    const { unmount } = renderHook(() => useWorkerBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isActiveCard("a")).toBe(false);
    unmount();
    expect(isActiveCard("a")).toBe(true);
  });
});
