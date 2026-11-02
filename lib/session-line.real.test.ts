// Two real WebRTC peers on this machine (werift for the board too, which speaks the browser's API): the whole session
// line but Supabase, which is an in-memory topic here. The offer is really sealed to the worker's key under LINE_PURPOSE,
// the answer really comes back under the one-time key, and verbs run through the worker's real `host` command path.
import { describe, expect, it, vi } from "vitest";
import { RTCPeerConnection } from "werift";
import { createCardCommands } from "./worker-card-commands";
import { createHostLines } from "./host-line";
import { LINE_PURPOSE, type LineEvent } from "./host-line-protocol";
import type { SealedAnswer } from "./rtc-signal";
import { createSessionLine } from "./session-line";
import type { BoardEvent, Card } from "./types";
import type { Engine } from "./worker-daemon";
import { newSealKeys, open, seal } from "./worker-seal";

function topics() {
  const subs = new Map<string, (sealed: SealedAnswer) => void>();
  return {
    listen: (topic: string, fn: (sealed: SealedAnswer) => void) => (subs.set(topic, fn), () => void subs.delete(topic)),
    answerOn: (topic: string, sealed: SealedAnswer) => Promise.resolve(subs.get(topic)?.(sealed)),
  };
}

describe("a real session line", () => {
  it("opens through a sealed offer, runs verbs under the relay's checks, pushes events, pings and restarts ICE over itself", async () => {
    const keys = newSealKeys();
    const bus = new Set<(e: BoardEvent) => void>();
    const card = { id: "c1", title: "T", cwd: "/w/app", column: "running" } as Card;
    const host = vi.fn((verb: string, args: Record<string, unknown>) => Promise.resolve({ verb, args }));
    const commands = createCardCommands({ getCard: (id: string) => (id === "c1" ? card : undefined), host, receive: (t: string) => Promise.resolve(t) } as unknown as Engine);
    const wire = topics();
    const lines = createHostLines({
      unseal: (sealed, purpose) => open(keys, sealed, purpose),
      answerOn: wire.answerOn,
      hear: (fn) => (bus.add(fn), () => void bus.delete(fn)),
      project: (e) => Promise.resolve(e.type === "card" ? ({ t: "card", card: e.card }) : null),
    });
    let skew = 0;
    let restarts = 0;
    const line = createSessionLine("w1", {
      peer: () => {
        const pc = new RTCPeerConnection({});
        const offer = pc.createOffer.bind(pc);
        pc.createOffer = ((o?: { iceRestart?: boolean }) => (o?.iceRestart && restarts++, offer(o)));
        return pc as unknown as globalThis.RTCPeerConnection;
      },
      ice: () => Promise.resolve([]),
      offer: (_, offer) => lines.open(seal(keys.publicKey, JSON.stringify(offer), LINE_PURPOSE), (payload) => commands.host({ payload } as never)),
      listen: wire.listen,
      token: () => "t1",
      now: () => Date.now() + skew,
    });
    await vi.waitFor(() => expect(line.route()).toEqual({ kind: "direct", ms: null }), { timeout: 15_000 });

    await expect(line.call("card.update", { id: "c1", body: { title: "New" } })).resolves.toEqual({ ok: true, cardId: "c1" });
    expect(host).toHaveBeenCalledWith("card.update", { id: "c1", body: { title: "New" } });
    // The same refusals as the relay: a shell, a folder move, a card that isn't the worker's.
    await expect(line.call("card.shell", { id: "c1", command: "ls" })).rejects.toThrow("only runs from Weft's own window");
    await expect(line.call("card.update", { id: "c1", body: { cwd: "/etc" } })).rejects.toThrow("can't change a card's folder");
    await expect(line.call("card.stop", { id: "nope" })).rejects.toThrow("isn't on this worker");

    const heard: LineEvent[] = [];
    line.onEvent((e) => heard.push(e));
    bus.forEach((fn) => fn({ type: "card", card: { ...card, title: "Pushed" } }));
    await vi.waitFor(() => expect(heard).toEqual([{ t: "card", card: { ...card, title: "Pushed" } }]), { timeout: 5_000 });

    // A renegotiation over the line itself, then the heartbeat's pong.
    await line.renegotiate(() => {}, undefined);
    await vi.waitFor(() => expect(line.route()).toMatchObject({ kind: "direct", ms: expect.any(Number) as number }), { timeout: 12_000 });
    // No pong for DEAD_MS (the clock jumps): an ICE restart over the line, and the line stays up.
    skew = 20_000;
    await vi.waitFor(() => expect(restarts).toBeGreaterThan(0), { timeout: 12_000 });
    await vi.waitFor(() => expect(line.route()).toMatchObject({ kind: "direct" }), { timeout: 12_000 });
    expect(line.up()).toBe(true);
    line.close();
    lines.closeAll();
    expect(lines.count()).toBe(0);
  }, 40_000);

  it("carries a watched simulator as a track: a new m-line and input channel renegotiated over the line", async () => {
    const keys = newSealKeys();
    const wire = topics();
    const stop = vi.fn();
    const touched: string[] = [];
    const attach = vi.fn((transceivers: { kind: string }[]) => (transceivers.some((t) => t.kind === "video") ? stop : null));
    const screen = { size: { width: 1, height: 1 }, connect: vi.fn(), close: vi.fn(), attach, input: (c: { onMessage: { subscribe(fn: (m: unknown) => void): unknown } }) => c.onMessage.subscribe((m) => touched.push(String(m))) };
    const lines = createHostLines({
      unseal: (sealed, purpose) => open(keys, sealed, purpose),
      answerOn: wire.answerOn,
      hear: () => () => {},
      project: () => Promise.resolve(null),
      screen: (device) => (device === "sim1" ? (screen) : null),
    });
    const line = createSessionLine("w1", {
      peer: () => new RTCPeerConnection({}) as unknown as globalThis.RTCPeerConnection,
      ice: () => Promise.resolve([]),
      offer: (_, offer) => lines.open(seal(keys.publicKey, JSON.stringify(offer), LINE_PURPOSE), () => Promise.reject(new Error("no verbs"))),
      listen: wire.listen,
      token: () => "t2",
    });
    await vi.waitFor(() => expect(line.up()).toBe(true), { timeout: 15_000 });
    let input: { readyState: string; send(t: string): void; close(): void } | null = null;
    await line.renegotiate(
      (pc) => {
        pc.addTransceiver("video", { direction: "recvonly" });
        input = pc.createDataChannel("input:sim1:abc", { ordered: true });
      },
      { device: "sim1", quality: "low", channel: "input:sim1:abc" },
    );
    expect(attach).toHaveBeenCalledWith([expect.objectContaining({ kind: "video" })], "low");
    await vi.waitFor(() => expect(input?.readyState).toBe("open"), { timeout: 5_000 });
    input!.send(JSON.stringify({ t: "down", x: 0.5, y: 0.5 }));
    await vi.waitFor(() => expect(touched).toHaveLength(1), { timeout: 5_000 });
    input!.close();
    await vi.waitFor(() => expect(stop).toHaveBeenCalled(), { timeout: 5_000 });
    line.close();
    lines.closeAll();
  }, 40_000);
});
