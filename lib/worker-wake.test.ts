import { describe, expect, it, vi } from "vitest";
import { listenForPushes, listenForWakes, PUSH_EVENT, PUSH_TOPIC, wakeTopic, WAKE_EVENT, type WakeChannel, type WakeClient } from "./worker-wake";

const KEY = "wwk_test";

function fakeClient() {
  const held: { status?: (status: string, err?: Error) => void; ping?: () => void; event?: string } = {};
  const channelObj: WakeChannel = {
    on(_type, filter, callback) {
      held.event = filter.event;
      held.ping = callback;
      return channelObj;
    },
    subscribe(callback) {
      held.status = callback;
      return channelObj;
    },
  };
  const channel = vi.fn(() => channelObj);
  const removeChannel = vi.fn(() => Promise.resolve());
  const client: WakeClient = { channel, removeChannel };
  return { client, held, channel, channelObj, removeChannel };
}

const hooks = () => ({ ping: vi.fn(), up: vi.fn(), down: vi.fn() });

describe("wakeTopic", () => {
  it("matches private.worker_wake_topic in the database", () => {
    // From: select private.worker_wake_topic(private.sha256_hex('wwk_test'));
    expect(wakeTopic(KEY)).toBe("worker-wake:eeecab0ab2a394659d0ae537ad47b3157ad5f1d13bc761fff7d98ab67a5e70d6");
  });

  it("is different for each key and doesn't contain it", () => {
    expect(wakeTopic("wwk_a")).not.toBe(wakeTopic("wwk_b"));
    expect(wakeTopic(KEY)).not.toContain(KEY);
  });
});

describe("listenForWakes", () => {
  it("joins the worker's own topic and listens for the wake event", () => {
    const f = fakeClient();
    listenForWakes(f.client, KEY, hooks(), vi.fn());
    expect(f.channel).toHaveBeenCalledWith(wakeTopic(KEY));
    expect(f.held.event).toBe(WAKE_EVENT);
  });

  it("passes a ping on", () => {
    const f = fakeClient();
    const h = hooks();
    listenForWakes(f.client, KEY, h, vi.fn());
    f.held.ping?.();
    expect(h.ping).toHaveBeenCalledOnce();
  });

  it("says up when joined and again on a rejoin", () => {
    const f = fakeClient();
    const h = hooks();
    listenForWakes(f.client, KEY, h, vi.fn());
    f.held.status?.("SUBSCRIBED");
    f.held.status?.("SUBSCRIBED");
    expect(h.up).toHaveBeenCalledTimes(2);
  });

  it("logs the join, so a box's log shows push is on", () => {
    const f = fakeClient();
    const log = vi.fn();
    listenForWakes(f.client, KEY, hooks(), log);
    f.held.status?.("SUBSCRIBED");
    expect(log).toHaveBeenCalledWith("Weft Worker: wake socket joined");
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])("says down and logs on %s", (status) => {
    const f = fakeClient();
    const h = hooks();
    const log = vi.fn();
    listenForWakes(f.client, KEY, h, log);
    f.held.status?.(status);
    expect(h.down).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(`Weft Worker: wake socket: ${status}`);
  });

  it("logs why the channel failed", () => {
    const f = fakeClient();
    const log = vi.fn();
    listenForWakes(f.client, KEY, hooks(), log);
    f.held.status?.("CHANNEL_ERROR", new Error("socket closed: 4000"));
    expect(log).toHaveBeenCalledWith("Weft Worker: wake socket: CHANNEL_ERROR (socket closed: 4000)");
  });

  it("leaves the channel and goes quiet, so its own close doesn't read as a drop", () => {
    const f = fakeClient();
    const h = hooks();
    const leave = listenForWakes(f.client, KEY, h, vi.fn());
    leave();
    f.held.status?.("CLOSED");
    expect(f.removeChannel).toHaveBeenCalledWith(f.channelObj);
    expect(h.down).not.toHaveBeenCalled();
  });

  it("doesn't throw when a leave fails", () => {
    const f = fakeClient();
    f.removeChannel.mockRejectedValue(new Error("gone"));
    expect(listenForWakes(f.client, KEY, hooks(), vi.fn())).not.toThrow();
  });

  it("carries on without a socket when the join throws, as on Node before 22", () => {
    const f = fakeClient();
    f.channel.mockImplementation(() => {
      throw new Error("Node.js detected but native WebSocket not found.");
    });
    const h = hooks();
    const log = vi.fn();
    const leave = listenForWakes(f.client, KEY, h, log);
    expect(log).toHaveBeenCalledWith("Weft Worker: no wake socket, polling instead: Node.js detected but native WebSocket not found.");
    expect(h.up).not.toHaveBeenCalled();
    expect(leave).not.toThrow();
  });
});

describe("listenForPushes", () => {
  it("joins the shared topic and passes a ping on", () => {
    const f = fakeClient();
    const h = hooks();
    listenForPushes(f.client, h, vi.fn());
    expect(f.channel).toHaveBeenCalledWith(PUSH_TOPIC);
    expect(f.held.event).toBe(PUSH_EVENT);
    f.held.ping?.();
    expect(h.ping).toHaveBeenCalledOnce();
  });
});
