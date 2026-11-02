import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FRESH_AFTER_MS, ABSENT_OFFLINE_AFTER_MS, joinPresence, liveStatus, PRESENCE_KEY, presenceTopic, SLOW_OFFLINE_AFTER_MS, type PresenceChannel, type PresenceRead } from "./worker-presence";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

describe("presenceTopic", () => {
  it("is private.worker_presence_topic of the key's hash, and not the wake topic", () => {
    expect(presenceTopic("k-1")).toBe(`worker-presence:${sha(`weft-worker-presence:${sha("k-1")}`)}`);
    expect(presenceTopic("k-1")).not.toBe(presenceTopic("k-2"));
  });
});

function fakeClient(trackFails = false) {
  let fire: (status: string, err?: Error) => void = () => {};
  const track = vi.fn(() => (trackFails ? Promise.reject(new Error("closed")) : Promise.resolve("ok")));
  const channel: PresenceChannel = {
    subscribe(cb) {
      fire = cb;
      return channel;
    },
    track,
  };
  const removeChannel = vi.fn(() => Promise.reject(new Error("gone")));
  const open = vi.fn(() => channel);
  return { client: { channel: open, removeChannel }, open, track, removeChannel, fire: (s: string, e?: Error) => fire(s, e) };
}

const hooks = () => ({ up: vi.fn(), down: vi.fn() });

describe("joinPresence", () => {
  it("joins under the worker key, says up and tracks once joined", async () => {
    const c = fakeClient();
    const h = hooks();
    const log = vi.fn();
    const p = joinPresence(c.client, "k-1", h, log);
    expect(c.open).toHaveBeenCalledWith(presenceTopic("k-1"), { config: { presence: { key: PRESENCE_KEY, enabled: true } } });
    void p.track("online");
    expect(c.track).not.toHaveBeenCalled();
    c.fire("SUBSCRIBED");
    expect(h.up).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Weft Worker: presence socket joined");
    void p.track("busy");
    expect(c.track).toHaveBeenCalledWith({ status: "busy" });
    p.leave();
    expect(c.removeChannel).toHaveBeenCalled();
    void p.track("online");
    c.fire("CLOSED");
    expect(c.track).toHaveBeenCalledTimes(1);
    expect(h.down).not.toHaveBeenCalled();
    await Promise.resolve();
  });

  it("says down off the socket, with and without a reason, and stops tracking", () => {
    const c = fakeClient();
    const h = hooks();
    const log = vi.fn();
    const p = joinPresence(c.client, "k-1", h, log);
    c.fire("SUBSCRIBED");
    c.fire("CHANNEL_ERROR", new Error("nope"));
    expect(log).toHaveBeenCalledWith("Weft Worker: presence socket: CHANNEL_ERROR (nope)");
    c.fire("TIMED_OUT");
    expect(log).toHaveBeenCalledWith("Weft Worker: presence socket: TIMED_OUT");
    expect(h.down).toHaveBeenCalledTimes(2);
    void p.track("online");
    expect(c.track).not.toHaveBeenCalled();
  });

  it("logs a track that fails", async () => {
    const c = fakeClient(true);
    const log = vi.fn();
    const p = joinPresence(c.client, "k-1", hooks(), log);
    c.fire("SUBSCRIBED");
    void p.track("online");
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("Weft Worker: presence: closed"));
  });

  it("joins with presence enabled and reports a track the server refused", async () => {
    const c = fakeClient();
    const log = vi.fn();
    const p = joinPresence(c.client, "k-1", hooks(), log);
    expect(c.open).toHaveBeenCalledWith(expect.any(String), { config: { presence: { key: "worker", enabled: true } } });
    c.fire("SUBSCRIBED");
    c.track.mockResolvedValueOnce("timed out");
    expect(await p.track("online")).toBe(false);
    expect(log).toHaveBeenCalledWith("Weft Worker: presence track: timed out");
    expect(await p.track("online")).toBe(true);
  });

  it("falls back to nothing when the socket can't open", () => {
    const log = vi.fn();
    const client = {
      channel: () => {
        throw new Error("no WebSocket");
      },
      removeChannel: vi.fn(),
    };
    const p = joinPresence(client, "k-1", hooks(), log);
    expect(log).toHaveBeenCalledWith("Weft Worker: no presence socket, beating the row instead: no WebSocket");
    void p.track("online");
    p.leave();
    expect(client.removeChannel).not.toHaveBeenCalled();
  });
});

describe("liveStatus", () => {
  const NOW = Date.parse("2026-11-02T10:00:00.000Z");
  const row = (ago: number | null, status: "online" | "busy" | "offline" = "online") => ({ id: "w1", status, last_seen_at: ago === null ? null : new Date(NOW - ago).toISOString() });
  const read = (present: [string, "online" | "busy"][] = [], known: string[] = []): PresenceRead => ({ known: new Set([...known, ...present.map(([id]) => id)]), present: new Map(present) });

  it("believes presence first", () => {
    expect(liveStatus(row(null, "offline"), read([["w1", "busy"]]), NOW)).toBe("busy");
  });

  it("believes a fresh row, whatever presence says", () => {
    expect(liveStatus(row(FRESH_AFTER_MS, "busy"), read([], ["w1"]), NOW)).toBe("busy");
    expect(liveStatus(row(1000, "offline"), null, NOW)).toBe("offline");
  });

  it("reads a synced topic without the worker as offline once its row is past the slow beat", () => {
    expect(liveStatus(row(ABSENT_OFFLINE_AFTER_MS + 1), read([], ["w1"]), NOW)).toBe("offline");
  });

  it("keeps a worker with a row inside the slow beat online when its track is missing", () => {
    expect(liveStatus(row(4 * 60_000), read([], ["w1"]), NOW)).toBe("online");
    expect(liveStatus(row(ABSENT_OFFLINE_AFTER_MS), read([], ["w1"]), NOW)).toBe("online");
  });

  it("reads the row against the slow beat when presence doesn't know", () => {
    expect(liveStatus(row(SLOW_OFFLINE_AFTER_MS), read(), NOW)).toBe("online");
    expect(liveStatus(row(SLOW_OFFLINE_AFTER_MS + 1), null, NOW)).toBe("offline");
    expect(liveStatus(row(null), null, NOW)).toBe("offline");
  });
});
