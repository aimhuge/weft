import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlackSocket } from "./slack-socket.cjs";
import { FakeSocket, last, resetSockets } from "./slack-socket.harness";

// What happens when Slack replaces a socket while the old one is still around: the old one's close and
// its envelopes must not reach the live one, or Slack redelivers a `/weft` and Weft makes a second card.
describe("a socket Weft has replaced", () => {
  beforeEach(() => {
    resetSockets();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("acks on the socket the envelope arrived on", async () => {
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = last();
    first.say({ type: "disconnect" });
    await vi.advanceTimersByTimeAsync(1000);
    const second = last();
    expect(second).not.toBe(first);
    // An envelope that arrives on the new socket is acked there, not on the retired one.
    second.say({ envelope_id: "e2" });
    expect(second.sent).toEqual(['{"envelope_id":"e2"}']);
    expect(first.sent).toEqual([]);
    socket.stop();
  });

  it("acks an envelope that arrives on a stale socket on that socket", async () => {
    // Slack can send an envelope on a socket Weft has already replaced. The ack belongs there: on the
    // live socket it is an envelope Slack never hears back from, and Slack sends the `/weft` again.
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = last();
    // The handler Weft gave the first socket, kept so a late delivery can be replayed through it.
    const staleHandler = first.onmessage;
    first.say({ type: "disconnect" });
    await vi.advanceTimersByTimeAsync(1000);
    const second = last();
    expect(second).not.toBe(first);
    staleHandler?.({ data: JSON.stringify({ envelope_id: "e1" }) });
    expect(first.sent).toEqual(['{"envelope_id":"e1"}']);
    expect(second.sent).toEqual([]);
    socket.stop();
  });

  it("doesn't let a retired socket's close disturb the live one", async () => {
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = last();
    first.say({ type: "disconnect" });
    await vi.advanceTimersByTimeAsync(1000);
    const second = last();
    // The retired socket closes late, the way a real one does after Slack hangs up.
    first.close();
    expect(second.closed).toBe(false);
    // And the live socket still works: an ack on it reaches Slack.
    second.say({ envelope_id: "e2" });
    expect(second.sent).toEqual(['{"envelope_id":"e2"}']);
    socket.stop();
  });

  it("reconnects once, not twice, when a retired socket closes late", async () => {
    const socket = createSlackSocket({
      open: () => Promise.resolve("wss://example/socket"),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    socket.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = last();
    first.say({ type: "disconnect" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.made).toHaveLength(2);
    // The old socket's close arrives after the new one is up: no second reconnect is scheduled.
    first.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.made).toHaveLength(2);
    socket.stop();
  });
});
