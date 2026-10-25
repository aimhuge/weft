import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlackSocket } from "./slack-socket.cjs";
import { FakeSocket, last, resetSockets } from "./slack-socket.harness";

beforeEach(() => {
  resetSockets();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSlackSocket", () => {
  it("opens the socket and says connected when Slack says hello", async () => {
    const states: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state) => states.push(state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().url).toBe("wss://example/socket");
    last().say({ type: "hello" });
    expect(states).toEqual(["connected"]);
  });

  it("acks an envelope before handing it on", async () => {
    const order: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onEnvelope: () => order.push("envelope"),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().send = (data: string) => order.push(`ack:${data}`);
    last().say({ envelope_id: "e1", type: "events_api" });
    expect(order).toEqual(['ack:{"envelope_id":"e1"}', "envelope"]);
  });

  it("ignores a message that isn't JSON, and one with no envelope id", async () => {
    const envelopes: unknown[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onEnvelope: (m) => envelopes.push(m),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().say("not json");
    last().say({ type: "hello" });
    expect(envelopes).toEqual([]);
  });

  it("reconnects when Slack says disconnect, and backs off", async () => {
    const states: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state, error) => states.push(error ? `${state}:${error}` : state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().say({ type: "disconnect", reason: "link_disabled" });
    expect(states.at(-1)).toBe("connecting:Slack asked us to reconnect: link_disabled");
    // The first wait is a second, so nothing has opened yet.
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.made).toHaveLength(2);
  });

  it("backs off further each time, up to a minute", async () => {
    const waits: number[] = [];
    const setTimer = (fn: () => void, ms: number) => {
      waits.push(ms);
      return setTimeout(fn, ms);
    };
    const timed = createSlackSocket({ open: () => Promise.resolve("wss://example/socket"), WebSocketImpl: FakeSocket as unknown as typeof WebSocket, setTimer });
    timed.start();
    await vi.advanceTimersByTimeAsync(0);
    // Each disconnect retires the socket, so the next one is said to the socket that replaced it.
    for (let i = 0; i < 8; i++) {
      last().say({ type: "disconnect" });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(waits.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000]);
    timed.stop();
  });

  it("resets the backoff after a hello", async () => {
    const waits: number[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      setTimer: (fn: () => void, ms: number) => {
        waits.push(ms);
        return setTimeout(fn, ms);
      },
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().say({ type: "disconnect" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    // The new socket says hello, which puts the backoff back to the first wait.
    last().say({ type: "hello" });
    last().say({ type: "disconnect" });
    await vi.advanceTimersByTimeAsync(0);
    expect(waits).toEqual([1000, 1000]);
    socket.stop();
  });

  it("reconnects when the socket closes, and when it errors", async () => {
    const states: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state) => states.push(state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().onerror?.();
    expect(states).toContain("connecting");
    last().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.made).toHaveLength(2);
    socket.stop();
  });

  it("backs off and says why when opening fails", async () => {
    const states: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.reject(new Error("no address")),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state, error) => states.push(error ?? state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain("Slack wouldn't open a connection: no address");
    socket.stop();
  });

  it("says why when opening fails without a message", async () => {
    const states: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.reject(new Error("")),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state, error) => states.push(error ?? state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain("Slack wouldn't open a connection.");
    socket.stop();
  });

  it("backs off when the websocket itself won't open", async () => {
    const states: string[] = [];
    // A websocket class whose constructor throws, the way a bad URL would.
    const Broken = function Broken(this: unknown) {
      throw new Error("bad url");
    };
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: Broken as unknown as typeof WebSocket,
      onState: (state, error) => states.push(error ?? state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain("Slack's socket wouldn't open: bad url");
    socket.stop();
  });

  it("stops for good: no reconnect, and the state is off", async () => {
    const states: string[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state) => states.push(state),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    socket.stop();
    expect(states.at(-1)).toBe("off");
    expect(last().closed).toBe(true);
    // A close after stopping doesn't bring it back.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.made).toHaveLength(1);
  });

  it("doesn't reconnect after a stop, even with a timer waiting", async () => {
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().say({ type: "disconnect" });
    socket.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.made).toHaveLength(1);
  });

  it("keeps going when the ack can't be written", async () => {
    const envelopes: unknown[] = [];
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onEnvelope: (m) => envelopes.push(m),
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    last().send = () => {
      throw new Error("closed");
    };
    last().say({ envelope_id: "e1" });
    expect(envelopes).toHaveLength(1);
    socket.stop();
  });

  it("doesn't reconnect when a retired socket closes after a stop", async () => {
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = last();
    socket.stop();
    expect(first.closed).toBe(true);
    first.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.made).toHaveLength(1);
  });
});
