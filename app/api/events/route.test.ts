import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publish, subscribe } from "@/lib/bus";
import type { BoardEvent } from "@/lib/types";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/limit-poll", () => ({ startLimitPoll: vi.fn() }));

const { GET } = await import("./route");

const bus = (globalThis as unknown as { __weftBus: EventEmitter }).__weftBus;
const listeners = () => bus.listenerCount("event");
const decoder = new TextDecoder();

async function open(signal = new AbortController().signal, token?: string) {
  const headers = new Headers({ host: "localhost:3000" });
  if (token) headers.set("x-weft-token", token);
  const res = await GET(new Request("http://localhost/api/events", { headers, signal }));
  return { res, reader: res.body!.getReader() };
}
const next = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const { value, done } = await reader.read();
  return done ? null : decoder.decode(value);
};
const event = { type: "card", card: { id: "c1" } } as unknown as BoardEvent;

afterEach(() => vi.useRealTimers());

describe("GET /api/events", () => {
  it("refuses a foreign host but needs no write header", async () => {
    const res = await GET(new Request("http://x/api/events", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    const ok = await open();
    expect(ok.res.status).toBe(200);
    await ok.reader.cancel();
  });

  it("streams as server-sent events: a connected comment, then each board event as data", async () => {
    const { res, reader } = await open();
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await next(reader)).toBe(": connected\n\n");
    publish(event);
    expect(await next(reader)).toBe(`data: ${JSON.stringify(event)}\n\n`);
    await reader.cancel();
  });

  it("pings every 15 seconds so proxies keep the connection open", async () => {
    vi.useFakeTimers();
    const { reader } = await open();
    await next(reader);
    vi.advanceTimersByTime(15_000);
    expect(await next(reader)).toBe(": ping\n\n");
    await reader.cancel();
  });

  it("sends the Copilot device code only to the desktop board", async () => {
    vi.stubEnv("WEFT_SHELL_TOKEN", "test-launch-token");
    const { reader: board } = await open(undefined, "test-launch-token");
    const { reader: ordinary } = await open(undefined, "1");
    try {
      await Promise.all([next(board), next(ordinary)]);
      const login: BoardEvent = { type: "login", login: {
        backend: "github-copilot", state: "running", output: "", userCode: "TEST-CODE", startedAt: 0,
      } };
      publish(login);
      publish(event);
      expect(await next(board)).toContain("TEST-CODE");
      expect(await next(ordinary)).toBe(`data: ${JSON.stringify(event)}\n\n`);
    } finally {
      await Promise.all([board.cancel(), ordinary.cancel()]);
      vi.unstubAllEnvs();
    }
  });

  it("unsubscribes and closes the stream when the client aborts", async () => {
    const before = listeners();
    const ac = new AbortController();
    const { reader } = await open(ac.signal);
    await next(reader);
    expect(listeners()).toBe(before + 1);
    ac.abort();
    expect(listeners()).toBe(before);
    expect(await next(reader)).toBeNull();
  });

  it("unsubscribes when the reader cancels, and a later abort doesn't throw closing it again", async () => {
    const before = listeners();
    const ac = new AbortController();
    const { reader } = await open(ac.signal);
    await reader.cancel();
    expect(listeners()).toBe(before);
    expect(() => ac.abort()).not.toThrow();
  });

  it("unsubscribes instead of throwing when an event lands on a stream that just closed", async () => {
    const before = listeners();
    const stream: { reader?: ReadableStreamDefaultReader<Uint8Array> } = {};
    // Registered first, so it cancels the stream while this same event is still on its way to the route.
    const off = subscribe(() => void stream.reader?.cancel());
    const { reader } = await open();
    stream.reader = reader;
    await next(reader);
    expect(() => publish(event)).not.toThrow();
    off();
    expect(listeners()).toBe(before);
  });
});
