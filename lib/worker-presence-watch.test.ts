import { describe, expect, it, vi } from "vitest";
import type { WatchChannel } from "./worker-presence-watch";
import type { Rpc } from "./worker-registry";

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabase);
const { createPresenceWatch, presenceWatch } = await import("./worker-presence-watch");

function fakeRealtime() {
  const channels = new Map<string, { sync: () => void; status: (s: string) => void; state: Record<string, unknown[]> }>();
  const open = vi.fn((topic: string) => {
    const held = { sync: () => {}, status: (() => {}) as (s: string) => void, state: {} as Record<string, unknown[]> };
    channels.set(topic, held);
    const channel: WatchChannel = {
      on(_type, _filter, cb) {
        held.sync = cb;
        return channel;
      },
      subscribe(cb) {
        held.status = cb;
        return channel;
      },
      presenceState: () => held.state,
    };
    return channel;
  });
  const removeChannel = vi.fn(() => Promise.reject(new Error("gone")));
  return { client: { channel: open, removeChannel }, open, removeChannel, channels };
}

const ME = { owner: "u-1", all: true };

const topicsRpc = (rows: { worker_id: string; topic: string }[] | null, error: { message: string } | null = null) =>
  vi.fn<Rpc>(() => Promise.resolve({ data: rows, error }));

describe("createPresenceWatch", () => {
  it("joins each worker's topic once and reads who is up once it has synced", async () => {
    const rt = fakeRealtime();
    let clock = 0;
    const watch = createPresenceWatch(() => rt.client, () => clock);
    const rpc = topicsRpc([
      { worker_id: "w1", topic: "worker-presence:a" },
      { worker_id: "w2", topic: "worker-presence:b" },
      { worker_id: "w3", topic: "worker-presence:c" },
    ]);
    const first = await watch.read(rpc, ["w1", "w2", "w3"], ME);
    expect(rpc).toHaveBeenCalledWith("worker_presence_topics", {});
    expect(first.known.size).toBe(0);
    const a = rt.channels.get("worker-presence:a")!;
    const b = rt.channels.get("worker-presence:b")!;
    const c = rt.channels.get("worker-presence:c")!;
    a.state = { worker: [{ status: "online" }, { status: "busy" }] };
    b.state = { worker: [{ status: "online" }] };
    c.state = { worker: [{ status: "offline" }, null] };
    a.sync();
    b.sync();
    c.sync();
    clock += 1000;
    const next = await watch.read(rpc, ["w1", "w2", "w3"], ME);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rt.open).toHaveBeenCalledTimes(3);
    expect([...next.known]).toEqual(["w1", "w2", "w3"]);
    expect(next.present).toEqual(new Map([["w1", "busy"], ["w2", "online"]]));
    // Synced with nobody on it: known, and down.
    c.state = {};
    expect((await watch.read(rpc, ["w3"], { owner: "u-1" })).present.size).toBe(0);
    // Off the socket, what it synced no longer counts.
    a.status("CHANNEL_ERROR");
    b.status("SUBSCRIBED");
    const after = await watch.read(rpc, ["w1", "w2"], ME);
    expect([...after.known]).toEqual(["w2"]);
  });

  it("asks again for a worker it has no topic for, at most once a minute", async () => {
    const rt = fakeRealtime();
    let clock = 0;
    const watch = createPresenceWatch(() => rt.client, () => clock);
    const rpc = topicsRpc(null);
    await watch.read(rpc, ["w9"], ME);
    await watch.read(rpc, ["w9"], ME);
    expect(rpc).toHaveBeenCalledTimes(1);
    clock += 60_000;
    await watch.read(rpc, ["w9"], ME);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rt.open).not.toHaveBeenCalled();
  });

  it("knows nothing when the database has no function or the socket can't open", async () => {
    const noSocket = () => {
      throw new Error("no WebSocket");
    };
    expect((await createPresenceWatch(noSocket).read(topicsRpc(null, { message: "no function" }), ["w1"], ME)).known.size).toBe(0);
    const seen = await createPresenceWatch(noSocket).read(topicsRpc([{ worker_id: "w1", topic: "t" }]), ["w1"], ME);
    expect(seen.known.size).toBe(0);
    expect(seen.present.size).toBe(0);
  });

  it("is one watch for the whole server, on one keyless client", async () => {
    const rt = fakeRealtime();
    supabase.createClient.mockReturnValue(rt.client);
    expect(presenceWatch()).toBe(presenceWatch());
    await presenceWatch().read(topicsRpc([{ worker_id: "w1", topic: "t" }]), ["w1"], ME);
    expect(supabase.createClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), { auth: { persistSession: false, autoRefreshToken: false } });
    expect(rt.open).toHaveBeenCalledWith("t");
  });

  it("leaves a worker's channel when it's no longer listed, or the database stops listing it", async () => {
    const rt = fakeRealtime();
    let clock = 0;
    const watch = createPresenceWatch(() => rt.client, () => clock);
    const rpc = topicsRpc([
      { worker_id: "w1", topic: "a" },
      { worker_id: "w2", topic: "b" },
    ]);
    await watch.read(rpc, ["w1", "w2"], ME);
    expect(rt.open).toHaveBeenCalledTimes(2);
    // Only some of them: nothing is left.
    await watch.read(rpc, ["w1"], { owner: "u-1" });
    expect(rt.removeChannel).not.toHaveBeenCalled();
    // The whole list without w2: its channel goes.
    await watch.read(rpc, ["w1"], ME);
    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
    // A new worker makes it ask again, and the database no longer lists w1.
    clock += 60_000;
    rpc.mockResolvedValueOnce({ data: [{ worker_id: "w3", topic: "c" }], error: null });
    await watch.read(rpc, ["w1", "w3"], { owner: "u-1" });
    expect(rt.removeChannel).toHaveBeenCalledTimes(2);
    expect(rt.open).toHaveBeenLastCalledWith("c");
  });

  it("leaves every channel, and asks at once, when the account changes", async () => {
    const rt = fakeRealtime();
    const watch = createPresenceWatch(() => rt.client, () => 0);
    await watch.read(topicsRpc([{ worker_id: "w1", topic: "a" }]), ["w1"], ME);
    const theirs = topicsRpc([{ worker_id: "w9", topic: "z" }]);
    await watch.read(theirs, ["w9"], { owner: "u-2", all: true });
    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
    expect(theirs).toHaveBeenCalledTimes(1);
    expect(rt.open).toHaveBeenLastCalledWith("z");
  });

  it("still reads when leaving a channel throws", async () => {
    let calls = 0;
    const rt = fakeRealtime();
    const watch = createPresenceWatch(() => {
      calls += 1;
      if (calls > 1) throw new Error("no socket");
      return rt.client;
    });
    await watch.read(topicsRpc([{ worker_id: "w1", topic: "a" }]), ["w1"], ME);
    expect((await watch.read(topicsRpc(null), [], { owner: "u-2", all: true })).known.size).toBe(0);
  });

  it("forgets a listed worker it never joined without leaving anything", async () => {
    const rt = fakeRealtime();
    const watch = createPresenceWatch(() => rt.client, () => 0);
    const rpc = topicsRpc([
      { worker_id: "w1", topic: "a" },
      { worker_id: "w2", topic: "b" },
    ]);
    await watch.read(rpc, ["w1"], ME);
    await watch.read(rpc, ["w1"], ME);
    expect(rt.open).toHaveBeenCalledTimes(1);
    expect(rt.removeChannel).not.toHaveBeenCalled();
  });
});
