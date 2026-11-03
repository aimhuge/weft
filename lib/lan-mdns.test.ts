// The mDNS side of the LAN path (lib/lan-mdns.ts) over a fake socket: what a worker advertises and when, and what this
// Mac's browser keeps and hands out.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hintFingerprint, hintTxt, LAN_SERVICE, signHint } from "./lan-hint";
import { WORKER, workerKeys } from "./lan-hint.harness";
import { advertise, createLanBrowser, HEARD_MS, MAX_WORKERS, PER_WORKER, QUERY_MS, type MdnsLike } from "./lan-mdns";

type Sent = { answers?: { name: string; type: string; ttl?: number; data?: unknown }[]; questions?: { name: string; type: string }[] };

class FakeMdns extends EventEmitter {
  responded: Sent[] = [];
  queried: Sent[] = [];
  destroyed = false;
  respond(p: Sent) {
    this.responded.push(p);
  }
  query(p: Sent) {
    this.queried.push(p);
  }
  destroy() {
    this.destroyed = true;
  }
}
const fake = () => new FakeMdns();
const asMdns = (m: FakeMdns) => m as unknown as MdnsLike;

const w = workerKeys();
let t = 1_800_000_000_000;
const txt = (over: Partial<{ id: string; port: number; at: number }> = {}) =>
  hintTxt(signHint({ id: WORKER, fp: hintFingerprint(w.box.publicKey), port: 4242, at: t, ...over }, w.signer)).map((s) => Buffer.from(s));

beforeEach(() => {
  vi.useFakeTimers();
  t = 1_800_000_000_000;
});
afterEach(() => vi.useRealTimers());

describe("advertise", () => {
  const ad = { instance: "weft-1a2b3c4d", host: "weft-1a2b3c4d.local", port: 4242, txt: () => ["v=1"], addresses: () => ["192.168.1.9"], refreshMs: 60_000, now: () => t };

  it("announces PTR, SRV, TXT and A at once, again every refresh, and says goodbye", () => {
    const m = fake();
    const stop = advertise(asMdns(m), ad);
    expect(m.responded[0]!.answers).toEqual([
      { name: LAN_SERVICE, type: "PTR", ttl: 120, data: `weft-1a2b3c4d.${LAN_SERVICE}` },
      { name: `weft-1a2b3c4d.${LAN_SERVICE}`, type: "SRV", ttl: 120, data: { port: 4242, target: "weft-1a2b3c4d.local", priority: 0, weight: 0 } },
      { name: `weft-1a2b3c4d.${LAN_SERVICE}`, type: "TXT", ttl: 120, data: ["v=1"] },
      { name: "weft-1a2b3c4d.local", type: "A", ttl: 120, data: "192.168.1.9" },
    ]);
    vi.advanceTimersByTime(60_000);
    expect(m.responded).toHaveLength(2);
    stop();
    expect(m.responded.at(-1)!.answers!.every((a) => a.ttl === 0)).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(m.responded).toHaveLength(3);
  });

  it("answers a query for its service, instance or host, at most once a second, and ignores the rest", () => {
    const m = fake();
    const log = vi.fn();
    advertise(asMdns(m), { ...ad, log });
    t += 2_000;
    m.emit("query", { questions: [{ name: "_other._tcp.local", type: "PTR" }] });
    m.emit("query", {});
    expect(m.responded).toHaveLength(1);
    m.emit("query", { questions: [{ name: "_WEFT._tcp.local", type: "PTR" }] });
    m.emit("query", { questions: [{ name: "weft-1a2b3c4d.local", type: "A" }] });
    expect(m.responded).toHaveLength(2);
    t += 1_000;
    m.emit("query", { questions: [{ name: `weft-1a2b3c4d.${LAN_SERVICE}`, type: "TXT" }] });
    expect(m.responded).toHaveLength(3);
    m.emit("error", new Error("EADDRINUSE"));
    m.emit("warning", new Error("w"));
    expect(log).toHaveBeenCalledWith("Weft Worker: mDNS: EADDRINUSE");
    // No log given: an error is still caught.
    const quiet = fake();
    advertise(asMdns(quiet), { ...ad, now: undefined });
    quiet.emit("error", new Error("x"));
  });
});

describe("the browser", () => {
  const response = (data: unknown, name = `weft-1a2b3c4d.${LAN_SERVICE}`, where: "answers" | "additionals" = "answers") => ({ [where]: [{ name, type: "TXT", data }] });
  const any = () => true;

  it("asks at once and every QUERY_MS, and keeps the TXT records it hears, by worker, newest hint first", async () => {
    const m = fake();
    const b = createLanBrowser(asMdns(m), { now: () => t });
    expect(m.queried).toEqual([{ questions: [{ name: LAN_SERVICE, type: "PTR" }] }]);
    vi.advanceTimersByTime(QUERY_MS);
    expect(m.queried).toHaveLength(2);
    m.emit("response", response(txt({ at: t - 10 })), { address: "10.0.0.2", port: 5353 });
    m.emit("response", response(txt(), undefined, "additionals"), { address: "10.0.0.3", port: 5353 });
    m.emit("response", { answers: [{ name: "x.local", type: "A", data: "1.2.3.4" }, { name: "other._ipp._tcp.local", type: "TXT", data: txt() }] }, { address: "10.0.0.4", port: 5353 });
    m.emit("response", response(["v=1"]), { address: "10.0.0.5", port: 5353 });
    m.emit("response", {}, { address: "10.0.0.6", port: 5353 });
    await expect(b.candidate(WORKER.toUpperCase(), any, 0)).resolves.toMatchObject({ address: "10.0.0.3", hint: { port: 4242, at: t } });
    // Only one that passes the check.
    await expect(b.candidate(WORKER, (c) => c.address === "10.0.0.2", 0)).resolves.toMatchObject({ address: "10.0.0.2" });
    await expect(b.candidate(WORKER, () => false, 0)).resolves.toBeNull();
    m.emit("error", new Error("x"));
    m.emit("warning", new Error("x"));
    b.close();
    expect(m.destroyed).toBe(true);
  });

  it("forgets what it heard long ago, and keeps PER_WORKER per worker, one per address and signature", async () => {
    const m = fake();
    const b = createLanBrowser(asMdns(m), { now: () => t });
    const same = txt();
    m.emit("response", response(same), { address: "10.0.0.2", port: 5353 });
    m.emit("response", response(same), { address: "10.0.0.2", port: 5353 });
    for (let i = 0; i < PER_WORKER + 2; i++) m.emit("response", response(txt({ at: t + i + 1 })), { address: `10.0.1.${i}`, port: 5353 });
    const seen: string[] = [];
    await b.candidate(WORKER, (c) => (seen.push(c.address), false), 0);
    expect(seen).toHaveLength(PER_WORKER);
    t += HEARD_MS;
    await expect(b.candidate(WORKER, any, 0)).resolves.toBeNull();
    b.close();
  });

  it("keeps at most MAX_WORKERS workers, dropping the first heard", async () => {
    const m = fake();
    const b = createLanBrowser(asMdns(m));
    const id = (i: number) => `1a2b3c4d-0000-4000-8000-${String(i).padStart(12, "0")}`;
    for (let i = 0; i <= MAX_WORKERS; i++) m.emit("response", response(txt({ id: id(i) })), { address: "10.0.0.2", port: 5353 });
    await expect(b.candidate(id(0), any, 0)).resolves.toBeNull();
    await expect(b.candidate(id(MAX_WORKERS), any, 0)).resolves.not.toBeNull();
    b.close();
  });

  it("waits for a hint after a fresh query, up to waitMs", async () => {
    const m = fake();
    const b = createLanBrowser(asMdns(m), { now: () => t, queryMs: 1e9 });
    const waiting = b.candidate(WORKER, any, 400);
    expect(m.queried).toHaveLength(2);
    m.emit("response", response(txt({ id: "1a2b3c4d-0000-4000-8000-000000000000" })), { address: "10.0.0.9", port: 5353 });
    m.emit("response", response(txt()), { address: "10.0.0.2", port: 5353 });
    await expect(waiting).resolves.toMatchObject({ address: "10.0.0.2" });
    const late = b.candidate("1a2b3c4d-0000-4000-8000-00000000ffff", any, 400);
    vi.advanceTimersByTime(400);
    await expect(late).resolves.toBeNull();
    b.close();
  });
});
