// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadPage } from "./thread-page";
import type { BoardEvent, ThreadItem } from "./types";

const ok = () => Promise.resolve({});
const api = vi.hoisted(() => ({
  stop: vi.fn(),
  shell: vi.fn(),
  editLast: vi.fn(),
  allowFolder: vi.fn(),
  setReadScope: vi.fn(),
  waitPermission: vi.fn(),
  stopTask: vi.fn(),
  fresh: vi.fn(),
}));
vi.mock("./client", () => ({ api }));
// The live hook's stream: the test fires its events by hand.
const stream = vi.hoisted((): { onEvent: (e: unknown) => void; onOpen: () => void } => ({ onEvent: () => {}, onOpen: () => {} }));
vi.mock("./use-events", () => ({
  useBoardEvents: (onEvent: (e: unknown) => void, onOpen: () => void) => Object.assign(stream, { onEvent, onOpen }),
}));

const { localTransport } = await import("./thread-transport");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const item = (text: string): ThreadItem => ({ kind: "assistant", text, at: 1 });

describe("localTransport.loadPage", () => {
  it("reads a page from the card's thread route, newest or before an index", async () => {
    const page: ThreadPage = { items: [item("a")], start: 4, total: 5 };
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve({ ok: true, json: () => Promise.resolve(page) } as Response));
    vi.stubGlobal("fetch", fetch);
    expect(await localTransport.loadPage("c1")).toEqual(page);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("/api/cards/c1/thread?limit=50");
    await localTransport.loadPage("c1", 4);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("/api/cards/c1/thread?before=4&limit=50");
  });

  it("is null for a refused or unreadable page", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false }));
    expect(await localTransport.loadPage("c1")).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("html")) }));
    expect(await localTransport.loadPage("c1")).toBeNull();
  });
});

describe("localTransport.useLive", () => {
  it("applies this card's thread events, clears on thread_cleared, and passes reconnects on", () => {
    const onUpdate = vi.fn();
    const onReconnect = vi.fn();
    renderHook(() => localTransport.useLive("c1", onUpdate, onReconnect));
    const prev: ThreadPage = { items: [item("a")], start: 0, total: 1 };
    stream.onEvent({ type: "thread", cardId: "c1", index: 1, item: item("b") } satisfies BoardEvent);
    expect((onUpdate.mock.calls[0]![0] as (p: ThreadPage) => ThreadPage)(prev).items).toHaveLength(2);
    stream.onEvent({ type: "thread_cleared", cardId: "c1" });
    expect((onUpdate.mock.calls[1]![0] as (p: ThreadPage) => ThreadPage)(prev)).toEqual({ items: [], start: 0, total: 0 });
    stream.onEvent({ type: "thread", cardId: "c2", index: 0, item: item("x") });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    stream.onOpen();
    expect(onReconnect).toHaveBeenCalled();
  });
});

describe("localTransport's actions", () => {
  it("go to the card routes", async () => {
    for (const fn of Object.values(api)) fn.mockImplementation(ok);
    const items = [item("a")];
    expect(localTransport.useView(items)).toBe(items);
    await localTransport.stop("c1");
    await localTransport.shell?.("c1", "ls");
    await localTransport.editLast?.("c1", "again");
    await localTransport.grantFolder?.("c1", "/tmp", "card");
    await localTransport.grantFolder?.("c1", "/tmp", "always");
    await localTransport.waitPermission?.("c1", "p1");
    await localTransport.stopTask?.("c1", "t1");
    expect(api.stop).toHaveBeenCalledWith("c1");
    expect(api.shell).toHaveBeenCalledWith("c1", "ls");
    expect(api.editLast).toHaveBeenCalledWith("c1", "again");
    expect(api.setReadScope).toHaveBeenCalledWith("c1", "/tmp");
    expect(api.allowFolder).toHaveBeenCalledWith("/tmp");
    expect(api.waitPermission).toHaveBeenCalledWith("c1", "p1");
    expect(api.stopTask).toHaveBeenCalledWith("c1", "t1");
    expect(localTransport.desktop).toBe(true);
  });

  it("fresh sends the message to a new session of the card", async () => {
    api.fresh.mockResolvedValue({ ok: true });
    await localTransport.fresh?.("c1", "go on");
    expect(api.fresh).toHaveBeenCalledWith("c1", "go on");
  });
});
