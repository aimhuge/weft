// @vitest-environment jsdom
// The thread transport for a worker card on the desktop board (lib/worker-transport.ts): the same pages the
// web board reads, over this Mac's own server, and the commands its actions send.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ThreadPage } from "./thread-page";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock("./api-client", () => ({ apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init), API_HEADERS: {} }));

const { mergePage, sendWorkerAction, THREAD_POLL_MS, useWorkerLive, workerToolSource, workerTransport, workerTransportVia } = await import("./worker-transport");
const { workerFiles } = await import("./worker-files");

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

describe("mergePage gaps", () => {
  it("takes the page when it starts past the end of the window", () => {
    const prev = page({ items: [item("one")], start: 0, total: 1 });
    const next = page({ items: [item("x"), item("y")], start: 60, total: 62 });
    expect(mergePage(prev, next)).toBe(next);
  });

  it("lays on a page that starts right at the end of the window", () => {
    const prev = page({ items: [item("one")], start: 0, total: 1 });
    expect(mergePage(prev, page({ items: [item("two")], start: 1, total: 2 })).total).toBe(2);
  });

  it("keeps the window when the answer has nothing new", () => {
    const prev = page({ items: [item("one")], start: 0, total: 1 });
    expect(mergePage(prev, page({ start: 1, total: 1 }))).toEqual(prev);
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
  it("stops the card with the same host verb as its tile and menu", async () => {
    fetchMock.mockResolvedValueOnce(json({ commandId: "cmd-2" })).mockResolvedValueOnce(json({ status: "done", error: null }));
    await workerTransport.stop("c1");
    expect(sentBody(fetchMock.mock.calls[0]![1])).toEqual({ action: "host", cardId: "c1", verb: "card.stop", args: { id: "c1" } });
  });
});

describe("useLive", () => {
  it("doesn't poll while a session line pushes the items", async () => {
    vi.useFakeTimers();
    renderHook(() => useWorkerLive("c1", vi.fn(), false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS * 2);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it("asks only for the items past the last one it has from the second read on", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ items: [item("a"), item("b"), item("c")], start: 0, total: 3 }));
    renderHook(() => workerTransport.useLive("c9", vi.fn(), vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS * 2);
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/worker-board?card=c9", "/api/worker-board?card=c9&after=1"]);
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

describe("searchThread", () => {
  it("finds over the card's whole thread on this Mac's server", async () => {
    fetchMock.mockResolvedValueOnce(json({ matches: [{ index: 4, hits: 1 }] }));
    expect(await workerTransport.searchThread!("c1", "deploy it")).toEqual([{ index: 4, hits: 1 }]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/worker-board?card=c1&q=deploy+it");
  });

  it("is null when the search can't be read, so find covers the loaded window", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 502));
    expect(await workerTransport.searchThread!("c1", "x")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await workerTransport.searchThread!("c1", "x")).toBeNull();
  });
});

describe("useView", () => {
  it("shows the items as they are", () => {
    const items = [item("one")];
    expect(renderHook(() => workerTransport.useView(items)).result.current).toBe(items);
  });
});

describe("workerTransport", () => {
  it("is not the desktop's own transport", () => {
    expect(workerTransport.desktop).toBe(false);
  });
});

describe("the worker card's verbs", () => {
  const done = () => fetchMock.mockResolvedValueOnce(json({ commandId: "cmd-1" })).mockResolvedValueOnce(json({ status: "done", error: null }));
  const hostBody = () => sentBody(fetchMock.mock.calls[0]![1]);

  it.each([
    ["editLast", () => workerTransport.editLast!("c1", "again"), "card.message.edit", { id: "c1", text: "again" }],
    ["fresh", () => workerTransport.fresh!("c1", "start over"), "card.fresh", { id: "c1", message: "start over" }],
    ["waitPermission", () => workerTransport.waitPermission!("c1", "p1"), "card.permission.wait", { id: "c1", pendingId: "p1" }],
    ["putFirst", () => workerTransport.putFirst!("c1", "p1"), "card.permission.first", { id: "c1", pendingId: "p1" }],
    ["putHolderFirst", () => workerTransport.putHolderFirst!("c1", "p1"), "card.permission.otherFirst", { id: "c1", pendingId: "p1" }],
    ["stopTask", () => workerTransport.stopTask!("c1", "t1"), "card.stopTask", { id: "c1", taskId: "t1" }],
  ] as const)("%s goes out as %s", async (_name, run, verb, args) => {
    done();
    await run();
    expect(hostBody()).toEqual({ action: "host", cardId: "c1", verb, args });
  });

  it("leaves out what a worker refuses from the network", () => {
    expect(workerTransport.shell).toBeUndefined();
    // A "!" says so in the box instead of reaching the agent.
    expect(workerTransport.shellRefusal).toBe("A shell runs only on this Mac's cards.");
    expect(workerTransport.grantFolder).toBeUndefined();
    expect(workerTransport.cardEdits).toBe(true);
    expect(workerTransport.signsSkip).toBe(false);
  });

  it("offers a shell line and Read from where this Mac can sign them, as the verbs a worker takes signed", async () => {
    (window as unknown as { weft?: unknown }).weft = { approval: { widen: vi.fn() } };
    try {
      const act = vi.fn(() => Promise.resolve(undefined));
      const t = workerTransportVia(act, () => {});
      await t.shell!("c1", "ls");
      await t.grantFolder!("c1", "/w/app/docs", "card");
      expect(act).toHaveBeenNthCalledWith(1, "card.shell", { id: "c1", command: "ls" });
      expect(act).toHaveBeenNthCalledWith(2, "card.update", { id: "c1", body: { readScope: "/w/app/docs" } });
      // The mode picker offers YOLO too: the act signs that change as well (lib/widen-signer.ts).
      expect(t.signsSkip).toBe(true);
    } finally {
      delete (window as unknown as { weft?: unknown }).weft;
    }
  });

  it("lists the card's files through the worker's files.list, so the thread's file names link (H4)", async () => {
    const list = vi.spyOn(workerFiles, "list").mockResolvedValue(["a.ts"]);
    await expect(workerTransport.listFiles!("w1")).resolves.toEqual(["a.ts"]);
    expect(list).toHaveBeenCalledWith("w1");
  });
});

