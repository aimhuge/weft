// The board's session line (lib/session-line.ts) over a fake RTCPeerConnection: opening through the sealed offer, the
// heartbeat and its ms, and falling back to the relay and trying again. Repair and renegotiation are in
// lib/session-line-repair.test.ts; two real peers run in lib/session-line.real.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineOffer } from "./host-line-protocol";
import { sealAnswer } from "./rtc-signal";
import { ANSWER_MS, BEAT_MS, GATHER_MS, RETRY_MS } from "./session-line";
import { LineDown } from "./session-line-calls";
import { answer, flush, flushUntil, FakePc, fresh, last, seen, setup, up } from "./session-line.harness";

beforeEach(fresh);
afterEach(() => vi.useRealTimers());

describe("opening", () => {
  it("offers with the minted ICE servers on its own topic, takes the sealed answer and goes direct", async () => {
    const { line, deps } = setup();
    expect(line.route()).toEqual({ kind: "connecting" });
    await flushUntil(() => vi.mocked(deps.offer).mock.calls.length > 0);
    expect(deps.offer).toHaveBeenCalledWith("w1", { sdp: "offer 1", key: expect.any(String) as string, topic: "worker-line:tok1", ice: [{ urls: "turn:t", username: "u", credential: "c" }] });
    // A forged answer doesn't open; the real one does.
    seen.topics.get("worker-line:tok1")?.({ iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" });
    await flush();
    expect(last().remote).toEqual([]);
    await answer();
    expect(last().remote).toEqual([{ type: "answer", sdp: "the answer" }]);
    const routed = vi.fn();
    const off = line.onRoute(routed);
    last().channels.host!.open();
    expect(line.route()).toEqual({ kind: "connecting" });
    last().channels.line!.open();
    expect(line.route()).toEqual({ kind: "direct", ms: null });
    expect(line.up()).toBe(true);
    expect(seen.topics.size).toBe(0);
    expect(routed).toHaveBeenCalledTimes(1);
    off();
  });

  it("takes a sealed answer that came back with the offer (a worker on the LAN), with no Broadcast", async () => {
    const { line } = setup({ offer: vi.fn(async (_: string, o: LineOffer) => ({ answer: await sealAnswer(o.key, "lan answer") })) });
    await flushUntil(() => (seen.pcs.at(-1)?.remote.length ?? 0) > 0);
    expect(last().remote).toEqual([{ type: "answer", sdp: "lan answer" }]);
    last().openAll();
    expect(line.route()).toEqual({ kind: "direct", ms: null });
    line.close();
  });

  it("waits for gathering, up to a limit", async () => {
    const slow = setup({
      peer: () => {
        const pc = new FakePc();
        pc.iceGatheringState = "gathering";
        seen.pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
    });
    await flush();
    expect(slow.deps.offer).not.toHaveBeenCalled();
    last().emit("icegatheringstatechange");
    last().iceGatheringState = "complete";
    last().emit("icegatheringstatechange");
    await flush();
    expect(slow.deps.offer).toHaveBeenCalledTimes(1);
    slow.line.close();

    const stuck = setup({
      peer: () => {
        const pc = new FakePc();
        pc.iceGatheringState = "gathering";
        pc.noSdp = true;
        seen.pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
    });
    await vi.advanceTimersByTimeAsync(GATHER_MS);
    expect(stuck.deps.offer).toHaveBeenCalledWith("w1", expect.objectContaining({ sdp: "" }));
  });

  it("falls back to STUN when no servers can be minted", async () => {
    const { deps } = setup({ ice: () => Promise.reject(new Error("offline")) });
    await flush();
    expect(deps.offer).toHaveBeenCalledWith("w1", expect.objectContaining({ ice: [{ urls: "stun:stun.cloudflare.com:3478" }] }));
  });

  it("is the relay when no answer comes, and tries again later, backing off", async () => {
    const { line, deps } = setup();
    await vi.advanceTimersByTimeAsync(ANSWER_MS);
    expect(line.route()).toEqual({ kind: "relay" });
    expect(seen.pcs[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(deps.offer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ANSWER_MS + RETRY_MS[1]!);
    await vi.advanceTimersByTimeAsync(ANSWER_MS + RETRY_MS[2]!);
    await vi.advanceTimersByTimeAsync(ANSWER_MS + RETRY_MS[3]!);
    await vi.advanceTimersByTimeAsync(ANSWER_MS + RETRY_MS[3]!);
    expect(deps.offer).toHaveBeenCalledTimes(6);
    // An answer for an attempt that was given up on is dropped.
    const stale = seen.offers[0]!;
    seen.pcs[0]!.remote = [];
    await answer(seen.pcs[0], stale);
    expect(seen.pcs[0]!.remote).toEqual([]);
  });

  it("stops trying when this Mac's server refuses the offer", async () => {
    const { line, deps } = setup({ offer: vi.fn(() => Promise.reject(new Error("That worker hasn't published its key yet."))) });
    await flush();
    expect(line.route()).toEqual({ kind: "relay" });
    await vi.advanceTimersByTimeAsync(RETRY_MS[3]! * 2);
    expect(deps.offer).toHaveBeenCalledTimes(1);
  });

  it("drops an answer that opens after its peer was replaced, and a refusal that lands after close", async () => {
    const { line } = setup();
    await flush();
    const pc = last();
    const offer = seen.offers.at(-1)!;
    seen.topics.get(offer.topic)?.(await sealAnswer(offer.key, "late"));
    pc.state("failed");
    await flush();
    expect(pc.remote).toEqual([]);
    line.close();

    let refuse: (err: Error) => void = () => {};
    const late = setup({ offer: () => new Promise((_, no) => (refuse = no)), now: undefined });
    await flush();
    late.line.close();
    refuse(new Error("no"));
    await flush();
    expect(late.line.route()).toEqual({ kind: "relay" });
  });

  it("doesn't start, or stops starting, once closed", async () => {
    let release: (v: never[]) => void = () => {};
    const { line, deps } = setup({ ice: () => new Promise((done) => (release = done)) });
    line.close();
    release([]);
    await flush();
    expect(seen.pcs).toHaveLength(0);
    expect(deps.offer).not.toHaveBeenCalled();
  });
});

describe("live", () => {
  it("pings, and the pong is the chip's ms", async () => {
    const { line } = await up();
    const ctl = last().channels.line!;
    seen.t = 2_000;
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(ctl.sent).toEqual([{ t: "ping", at: 2_000 }]);
    seen.t = 2_004;
    ctl.msg({ t: "pong", at: 2_000 });
    expect(line.route()).toEqual({ kind: "direct", ms: 4 });
    ctl.msg({ t: "pong", at: 9_999 });
    expect(line.route()).toEqual({ kind: "direct", ms: 0 });
    ctl.msg("junk");
    last().state("connected");
    expect(line.route()).toEqual({ kind: "direct", ms: 0 });
    ctl.msg({ t: "answer", sdp: "unasked" });
    ctl.msg({ t: "error", message: "unasked" });
  });

  it("carries verbs on host, and events to whoever listens", async () => {
    const { line } = await up();
    const host = last().channels.host!;
    const call = line.call("card.stop", { id: "c1" });
    expect(host.sent).toEqual([{ id: 1, verb: "card.stop", args: { id: "c1" } }]);
    host.msg({ id: 1, ok: true, result: { ok: true, cardId: "c1" } });
    await expect(call).resolves.toEqual({ ok: true, cardId: "c1" });
    const heard = vi.fn();
    const off = line.onEvent(heard);
    last().channels.events!.msg({ t: "card_deleted", id: "c1" });
    last().channels.events!.msg("junk");
    expect(heard).toHaveBeenCalledWith({ t: "card_deleted", id: "c1" });
    off();
    last().channels.events!.msg({ t: "card_deleted", id: "c2" });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("opens one more channel on a live line (the terminal's), and none before it's up", async () => {
    const early = setup();
    expect(early.line.channel("terminal")).toBeNull();
    const { line } = await up();
    expect(line.channel("terminal")).toBe(last().channels.terminal);
  });

  it("refuses a call before it's up, so the caller takes the relay", async () => {
    const { line } = setup();
    await expect(line.call("card.stop", { id: "c" })).rejects.toBeInstanceOf(LineDown);
    expect(line.up()).toBe(false);
  });
});

