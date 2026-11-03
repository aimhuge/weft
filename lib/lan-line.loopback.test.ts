// The LAN path end to end on 127.0.0.1 (docs/architecture/weft-worker.md#the-lan-path): a worker daemon advertises its
// signed hint on a fake mDNS bus and listens on a real port; this Mac's server browses the bus, checks the hint against
// its pins, seals and signs the board's offer and posts it; the worker opens the line through its own `line` kind and
// the board opens the sealed answer with its one-time key. Only the mDNS socket and the WebRTC peer are fakes.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostLines } from "./host-line";
import { hintFingerprint, hintTxt, lanOfferMessage, signHint } from "./lan-hint";
import { macKey, WORKER, workerKeys } from "./lan-hint.harness";
import { createLanBrowser, RESPOND_GAP_MS, type MdnsLike } from "./lan-mdns";
import { offerOverLan, realLanDeps } from "./lan-offer";
import { newAnswerKey, openAnswer } from "./rtc-signal";
import { makeDeps } from "./worker-daemon.harness";
import { startWorkerLan } from "./worker-lan-start";
import { open } from "./worker-seal";

// One multicast group: what anyone responds reaches every browser, from the responder's address; a query reaches every
// advertiser.
class Bus {
  members = new Set<{ e: EventEmitter; address: string }>();
  join(address: string): MdnsLike {
    const e = new EventEmitter();
    const me = { e, address };
    this.members.add(me);
    const others = () => [...this.members].filter((m) => m !== me);
    return {
      on: (event: string, fn: (...args: never[]) => void) => e.on(event, fn as (...args: unknown[]) => void),
      respond: (packet) => others().forEach((m) => m.e.emit("response", packet, { address, port: 5353 })),
      query: (packet) => others().forEach((m) => m.e.emit("query", packet, { address, port: 5353 })),
      destroy: () => void this.members.delete(me),
    };
  }
}

const w = workerKeys();
const mac = macKey();
let home: string;
let stops: (() => Promise<void>)[] = [];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-lan-"));
  stops = [];
});
afterEach(async () => {
  for (const stop of stops) await stop();
  fs.rmSync(home, { recursive: true, force: true });
});

// A worker daemon with its LAN path: lines open through its own `line` kind, the peer faked to answer "worker sdp".
async function worker(bus: Bus) {
  const peer = vi.fn(() => Promise.resolve({ answer: "worker sdp", close: vi.fn(), renegotiate: vi.fn(), onClosed: vi.fn() }));
  const lines = createHostLines({ unseal: (sealed, purpose) => open(w.box, sealed, purpose), answerOn: vi.fn(), hear: () => () => {}, answer: peer });
  const { daemon } = makeDeps({ owner: "u1", line: (sealed, run, answerOn) => lines.open(sealed, run, answerOn) });
  const stop = await startWorkerLan({
    home,
    workerId: WORKER,
    boxKey: w.box.publicKey,
    sign: w.signer,
    macKeys: () => [mac.raw],
    open: daemon.lanLine,
    env: { WEFT_LAN_PORT: "0" },
    mdns: () => bus.join("127.0.0.1"),
    addresses: () => ["127.0.0.1"],
  });
  stops.push(async () => (lines.closeAll(), stop()));
  // It announced as it started; a query inside the next second (RESPOND_GAP_MS) goes unanswered, as mDNS asks.
  await new Promise((done) => setTimeout(done, RESPOND_GAP_MS + 50));
  return { peer, lines };
}

// What electron/lan-line-sign.cjs answers: this Mac's device key over the offer's digest, now, with a fresh nonce.
const signFor = (workerId: string, digest: string) => {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  return { key: mac.raw, sig: mac.sign(lanOfferMessage(workerId, issuedAt, nonce, digest)), issuedAt, nonce };
};

// This Mac's server: the pins main holds, main's signature, a browser on the bus, a real fetch.
function theMac(bus: Bus, pins = { signKey: w.sign.publicKey, boxKey: w.box.publicKey }) {
  const real = realLanDeps(vi.fn(), vi.fn(), {});
  const browser = createLanBrowser(bus.join("127.0.0.2"));
  stops.push(() => {
    browser.close();
    return Promise.resolve();
  });
  return {
    keys: () => Promise.resolve(pins),
    sign: (workerId: string, digest: string) => Promise.resolve(signFor(workerId, digest)),
    browser: () => browser,
    post: (url: string, body: unknown, ms: number) => real.post(url, body, ms),
  };
}
const offerFor = (key: string) => ({ sdp: "board sdp", key, topic: "worker-line:t", ice: [] });

describe("a board on the same LAN", () => {
  it("finds the worker by its signed hint and opens a line straight to it, with no Supabase", async () => {
    const bus = new Bus();
    const { peer, lines } = await worker(bus);
    const key = newAnswerKey();
    const answer = await offerOverLan(WORKER, offerFor(key), theMac(bus));
    expect(answer).not.toBeNull();
    await expect(openAnswer(key, answer!)).resolves.toBe("worker sdp");
    expect(peer).toHaveBeenCalledWith("board sdp", expect.any(Object), expect.objectContaining({ ice: [] }));
    expect(lines.count()).toBe(1);
  });

  it("ignores a spoofed advert, and takes nothing from a board this box wasn't paired with", async () => {
    const bus = new Bus();
    await worker(bus);
    // An impostor on the LAN advertises this worker's id with its own key, at a fresher time.
    const impostor = workerKeys();
    const fake = bus.join("127.0.0.66");
    fake.respond({ answers: [{ name: `x._weft._tcp.local`, type: "TXT", data: hintTxt(signHint({ id: WORKER, fp: hintFingerprint(impostor.box.publicKey), port: 9, at: Date.now() + 1_000 }, impostor.signer)) }] });
    const key = newAnswerKey();
    const answer = await offerOverLan(WORKER, offerFor(key), theMac(bus));
    await expect(openAnswer(key, answer!)).resolves.toBe("worker sdp");
    // A Mac that pinned other keys for this worker finds no hint it trusts, and leaves it to the row.
    expect(await offerOverLan(WORKER, offerFor(key), theMac(bus, { signKey: impostor.sign.publicKey, boxKey: impostor.box.publicKey }))).toBeNull();
  });

  it("is refused at the port when the Mac's signature isn't the pinned one", async () => {
    const bus = new Bus();
    const { peer } = await worker(bus);
    const stranger = macKey();
    const deps = { ...theMac(bus), sign: (workerId: string, digest: string) => Promise.resolve({ ...signFor(workerId, digest), key: stranger.raw }) };
    expect(await offerOverLan(WORKER, offerFor(newAnswerKey()), deps)).toBeNull();
    expect(peer).not.toHaveBeenCalled();
  });
});
