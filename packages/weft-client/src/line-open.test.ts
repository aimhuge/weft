import { describe, expect, it, vi } from "vitest";
import { gathered, GATHER_MS, offerLine, openLine, STUN, type LinePeer, type OfferDeps, type SdpInit } from "./line-open";
import type { SealedAnswer } from "./seal";

class Peer implements LinePeer<string> {
  iceGatheringState = "complete";
  localDescription: { sdp: string } | null = null;
  remote: SdpInit[] = [];
  channels: string[] = [];
  closed = false;
  listeners: (() => void)[] = [];
  constructor(readonly ice: unknown = null) {}
  createDataChannel(label: string) {
    this.channels.push(label);
    return label;
  }
  createOffer() {
    return Promise.resolve<SdpInit>({ type: "offer", sdp: "v=0 offer" });
  }
  setLocalDescription(d: SdpInit) {
    this.localDescription = d.sdp ? { sdp: d.sdp } : null;
    return Promise.resolve();
  }
  setRemoteDescription(d: SdpInit) {
    this.remote.push(d);
    return Promise.resolve();
  }
  addEventListener(_: string, fn: () => void) {
    this.listeners.push(fn);
  }
  close() {
    this.closed = true;
  }
}

const never = () => new Promise<void>(() => {});
const flush = () => new Promise((done) => setTimeout(done, 0));

function deps(over: Partial<OfferDeps> = {}) {
  const heard = new Map<string, (sealed: SealedAnswer) => void>();
  const stopped: string[] = [];
  const d: OfferDeps = {
    keys: { newKey: () => "key-1", open: (key, sealed) => (key === "key-1" && sealed.ct === "good" ? Promise.resolve("v=0 answer") : Promise.reject(new Error("forged"))) },
    listen: (topic, fn) => (heard.set(topic, fn), () => void stopped.push(topic)),
    token: () => "00ff",
    wait: never,
    current: () => true,
    ...over,
  };
  return { d, heard, stopped };
}

describe("gathered", () => {
  it("is done at once when gathering is, else on complete, else after GATHER_MS", async () => {
    const pc = new Peer();
    await gathered(pc, never);
    pc.iceGatheringState = "gathering";
    let done = false;
    void gathered(pc, never).then(() => (done = true));
    pc.listeners.forEach((fn) => fn());
    await flush();
    expect(done).toBe(false);
    pc.iceGatheringState = "complete";
    pc.listeners.forEach((fn) => fn());
    await flush();
    expect(done).toBe(true);
    const slow = new Peer();
    slow.iceGatheringState = "gathering";
    const wait = vi.fn(() => Promise.resolve());
    await gathered(slow, wait);
    expect(wait).toHaveBeenCalledWith(GATHER_MS);
  });
});

describe("offerLine", () => {
  it("offers on a topic of its own and lands only an answer that opens, while it's current", async () => {
    const pc = new Peer();
    const { d, heard, stopped } = deps();
    const { offer, stop } = await offerLine(pc, [{ urls: STUN }], d);
    expect(offer).toEqual({ sdp: "v=0 offer", key: "key-1", topic: "worker-line:00ff", ice: [{ urls: STUN }] });
    heard.get("worker-line:00ff")?.({ iv: "i", ct: "forged" });
    await flush();
    expect(pc.remote).toEqual([]);
    heard.get("worker-line:00ff")?.({ iv: "i", ct: "good" });
    await flush();
    expect(pc.remote).toEqual([{ type: "answer", sdp: "v=0 answer" }]);
    stop();
    expect(stopped).toEqual(["worker-line:00ff"]);
  });

  it("drops an answer once its attempt is over, and offers an empty sdp when there is none", async () => {
    const pc = new Peer();
    pc.createOffer = () => Promise.resolve({ type: "offer" });
    const { d, heard } = deps({ current: () => false });
    const { offer } = await offerLine(pc, [], d);
    expect(offer.sdp).toBe("");
    heard.get(offer.topic)?.({ iv: "i", ct: "good" });
    await flush();
    expect(pc.remote).toEqual([]);
  });
});

describe("openLine", () => {
  it("makes the three channels on a peer of the caller's, and sends the offer", async () => {
    let made: Peer | null = null;
    const offer = vi.fn(() => Promise.resolve());
    const { d, heard, stopped } = deps();
    const line = await openLine("w1", { ...d, peer: (ice) => (made = new Peer(ice)), ice: () => Promise.reject(new Error("no TURN")), offer });
    const pc = made as unknown as Peer;
    expect(pc.ice).toEqual([{ urls: STUN }]);
    expect(pc.channels).toEqual(["host", "events", "line"]);
    expect([line.host, line.events, line.control]).toEqual(["host", "events", "line"]);
    expect(offer).toHaveBeenCalledWith("w1", expect.objectContaining({ topic: "worker-line:00ff", key: "key-1" }));
    heard.get("worker-line:00ff")?.({ iv: "i", ct: "good" });
    await flush();
    expect(pc.remote).toHaveLength(1);
    line.stopListening();
    expect(stopped).toEqual(["worker-line:00ff"]);
    line.close();
    expect(pc.closed).toBe(true);
    heard.get("worker-line:00ff")?.({ iv: "i", ct: "good" });
    await flush();
    expect(pc.remote).toHaveLength(1);
  });

  it("closes the peer when the offer can't go", async () => {
    let made: Peer | null = null;
    const { d, stopped } = deps();
    const peer = () => (made = new Peer());
    await expect(openLine("w1", { ...d, peer, ice: () => Promise.resolve([]), offer: () => Promise.reject(new Error("not yours")) })).rejects.toThrow("not yours");
    expect((made as unknown as Peer).closed).toBe(true);
    expect(stopped).toEqual(["worker-line:00ff"]);
    const broken = () => {
      const pc = (made = new Peer());
      pc.createOffer = () => Promise.reject(new Error("no offer"));
      return pc;
    };
    await expect(openLine("w1", { ...d, peer: broken, ice: () => Promise.resolve([]), offer: vi.fn() })).rejects.toThrow("no offer");
    expect((made as unknown as Peer).closed).toBe(true);
  });
});
