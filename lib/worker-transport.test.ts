// @vitest-environment jsdom
// The thread transport for a worker card on the desktop board (lib/worker-transport.ts): the same pages the
// web board reads, over this Mac's own server, and the commands its actions send.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ThreadPage } from "./thread-page";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock("./api-client", () => ({ apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const { mergePage, sendWorkerAction, THREAD_POLL_MS, workerToolSource, workerTransport } = await import("./worker-transport");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The body a call went out with, as the JSON it holds.
const sentBody = (init: RequestInit | undefined): unknown => JSON.parse(typeof init?.body === "string" ? init.body : "{}");

const page = (over: Partial<ThreadPage> = {}): ThreadPage => ({ items: [], start: 0, total: 0, ...over });

const item = (text: string) => ({ kind: "user" as const, text, at: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mergePage", () => {
  it("lays a newer page over what's loaded", () => {
    const prev = page({ items: [item("one")], start: 0, total: 1 });
    const next = mergePage(prev, page({ items: [item("two")], start: 1, total: 2 }));
    expect(next.items.map((i) => (i as { text: string }).text)).toEqual(["one", "two"]);
    expect(next.total).toBe(2);
  });

  it("takes the page when the thread was rewound on the worker", () => {
    const prev = page({ items: [item("one"), item("two")], start: 0, total: 2 });
    const next = mergePage(prev, page({ items: [item("new")], start: 0, total: 1 }));
    expect(next).toEqual(page({ items: [item("new")], start: 0, total: 1 }));
  });

  it("takes the empty page when the thread was cleared on the worker", () => {
    const prev = page({ items: [item("one")], start: 0, total: 1 });
    expect(mergePage(prev, page())).toEqual(page());
  });
});

describe("loadPage", () => {
  it("reads the newest page of a card's thread", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [item("hi")], start: 0, total: 1 }));
    expect(await workerTransport.loadPage("c1")).toEqual({ items: [item("hi")], start: 0, total: 1 });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/worker-board?card=c1");
  });

  it("walks back with before", async () => {
    fetchMock.mockResolvedValueOnce(json(page()));
    await workerTransport.loadPage("c1", 5);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/worker-board?card=c1&before=5");
  });

  it("has no page when the server says no", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 502));
    expect(await workerTransport.loadPage("c1")).toBeNull();
  });

  it("has no page when the read throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await workerTransport.loadPage("c1")).toBeNull();
  });
});

describe("sendWorkerAction", () => {
  it("posts the action", async () => {
    fetchMock.mockResolvedValueOnce(json({ commandId: "cmd-1" }));
    await sendWorkerAction({ action: "stop", cardId: "c1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/worker-board");
    expect(init?.method).toBe("POST");
    expect(sentBody(init)).toEqual({ action: "stop", cardId: "c1" });
  });

  it("throws the server's error when the action fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "That thread isn't on one of your workers." }, 400));
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" })).rejects.toThrow("That thread isn't on one of your workers.");
  });

  it("throws the status when the server says nothing else", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" })).rejects.toThrow("HTTP 500");
  });
});

describe("stop", () => {
  it("posts a stop for the card", async () => {
    fetchMock.mockResolvedValueOnce(json({ commandId: "cmd-2" }));
    await workerTransport.stop("c1");
    expect(sentBody(fetchMock.mock.calls[0]![1])).toEqual({ action: "stop", cardId: "c1" });
  });
});

describe("useLive", () => {
  it("re-reads the thread every couple of seconds and lays the page over", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ items: [item("hi")], start: 0, total: 1 }));
    const updates: ((prev: ThreadPage) => ThreadPage)[] = [];
    const onUpdate = vi.fn((update: (prev: ThreadPage) => ThreadPage) => updates.push(update));
    const { unmount } = renderHook(() => workerTransport.useLive("c1", onUpdate, vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/worker-board?card=c1", undefined);
    expect(onUpdate).toHaveBeenCalled();
    unmount();
  });

  it("lays the page it reads over what's loaded", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ items: [{ kind: "user", text: "hi" }], start: 0, total: 1 }));
    const updates: ((prev: ThreadPage) => ThreadPage)[] = [];
    renderHook(() => workerTransport.useLive("c1", (update) => updates.push(update), vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS);
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!(page())).toEqual({ items: [{ kind: "user", text: "hi" }], start: 0, total: 1 });
  });

  it("doesn't start a second read while one is in flight", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = () => resolve(json(page())))));
    renderHook(() => workerTransport.useLive("c1", vi.fn(), vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops reading when the thread is closed", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(page()));
    const { unmount } = renderHook(() => workerTransport.useLive("c1", vi.fn(), vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS);
    });
    const calls = fetchMock.mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("keeps what it has when a read fails", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ error: "nope" }, 502));
    const onUpdate = vi.fn();
    renderHook(() => workerTransport.useLive("c1", onUpdate, vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS);
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("workerToolSource", () => {
  it("reads a tool's full result", async () => {
    fetchMock.mockResolvedValueOnce(json({ result: "the whole thing" }));
    expect(await workerToolSource("c1", "t1")).toBe("the whole thing");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/worker-board?card=c1&tool=t1");
  });

  it("throws when the result can't be read", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 502));
    await expect(workerToolSource("c1", "t1")).rejects.toThrow("502");
  });
});

describe("useView", () => {
  it("shows the items as they are", () => {
    const items = [item("one")];
    expect(workerTransport.useView(items)).toBe(items);
  });
});

describe("workerTransport", () => {
  it("is not the desktop's own transport", () => {
    expect(workerTransport.desktop).toBe(false);
  });
});
