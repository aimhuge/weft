// The LAN path's signed bytes (lib/lan-hint.ts): the worker's mDNS hint and the Mac's offer, read off the wire.
import { describe, expect, it } from "vitest";
import { macKey, WORKER, workerKeys } from "./lan-hint.harness";
import {
  HINT_MAX_AGE_MS,
  hintChecks,
  hintFingerprint,
  hintMessage,
  hintTxt,
  lanOfferMessage,
  offerDigest,
  readHintTxt,
  readLanOffer,
  readMacStamp,
  signHint,
} from "./lan-hint";
import { seal, sealFingerprint } from "./worker-seal";

const NOW = 1_800_000_000_000;
const w = workerKeys();
const pinned = { workerId: WORKER, signKey: w.sign.publicKey, boxKey: w.box.publicKey };
const hint = (over: Partial<{ id: string; fp: string; port: number; at: number }> = {}) =>
  signHint({ id: WORKER, fp: hintFingerprint(w.box.publicKey), port: 4242, at: NOW, ...over }, w.signer);

describe("the hint", () => {
  it("round-trips through its TXT strings, as Buffers off the wire", () => {
    const h = hint();
    expect(hintFingerprint(w.box.publicKey)).toBe(sealFingerprint(w.box.publicKey).replace(/ /g, ""));
    const txt = hintTxt(h);
    expect(txt.every((t) => t.length < 255)).toBe(true);
    expect(readHintTxt(txt.map((t) => Buffer.from(t)))).toEqual(h);
    expect(readHintTxt([...txt, "junk", "=x"])).toEqual(h);
    expect(readHintTxt(txt.map((t) => t.replace(WORKER, WORKER.toUpperCase())))?.id).toBe(WORKER);
  });

  it("reads nothing short of a whole one", () => {
    const txt = hintTxt(hint());
    expect(readHintTxt("v=1")).toBeNull();
    expect(readHintTxt(Array(17).fill("v=1"))).toBeNull();
    expect(readHintTxt([...txt, 5])).toBeNull();
    expect(readHintTxt([...txt, "x".repeat(256)])).toBeNull();
    for (const [k, bad] of [["v", "2"], ["id", "w1"], ["fp", "zz"], ["port", "x"], ["port", "70000"], ["port", "0"], ["at", "-1"], ["sig", "!!"], ["sig", "A".repeat(121)]]) {
      expect(readHintTxt(txt.map((t) => (t.startsWith(`${k}=`) ? `${k}=${bad}` : t)))).toBeNull();
    }
  });

  it("checks against the pinned sign key and box key, and only while fresh", () => {
    expect(hintChecks(hint(), pinned, NOW)).toBe(true);
    expect(hintChecks(hint(), { ...pinned, workerId: WORKER.toUpperCase() }, NOW)).toBe(true);
    expect(hintChecks(hint({ at: NOW - HINT_MAX_AGE_MS - 1 }), pinned, NOW)).toBe(false);
    expect(hintChecks(hint({ at: NOW + HINT_MAX_AGE_MS + 1 }), pinned, NOW)).toBe(false);
    expect(hintChecks(hint({ id: "1a2b3c4d-0000-4000-8000-000000000000" }), pinned, NOW)).toBe(false);
    // Another box key, another sign key, or a port changed after signing.
    expect(hintChecks(hint(), { ...pinned, boxKey: workerKeys().box.publicKey }, NOW)).toBe(false);
    expect(hintChecks(hint(), { ...pinned, signKey: workerKeys().sign.publicKey }, NOW)).toBe(false);
    expect(hintChecks({ ...hint(), port: 4243 }, pinned, NOW)).toBe(false);
    expect(hintChecks(hint(), { ...pinned, signKey: "bm90IGEga2V5" }, NOW)).toBe(false);
    expect(hintMessage(hint())).toBe(`weft-lan-hint-v1\n${WORKER}\n${hintFingerprint(w.box.publicKey)}\n4242\n${NOW}`);
  });
});

describe("the offer", () => {
  const sealed = seal(w.box.publicKey, "offer", "rtc-line");
  const mac = macKey();

  it("reads a whole one, its worker id lowercased", () => {
    const stamp = mac.stamp(WORKER, sealed, NOW);
    expect(readLanOffer({ v: 1, workerId: WORKER.toUpperCase(), sealed, mac: stamp })).toEqual({ v: 1, workerId: WORKER, sealed, mac: stamp });
    expect(lanOfferMessage(WORKER, 5, "n", "d")).toBe(`weft-lan-offer-v1\n${WORKER}\n5\nn\nd`);
    expect(offerDigest(sealed)).toMatch(/^[0-9a-f]{64}$/);
    expect(offerDigest({ ...sealed, ct: `${sealed.ct}A` })).not.toBe(offerDigest(sealed));
  });

  it("reads nothing short of a whole one", () => {
    const stamp = mac.stamp(WORKER, sealed, NOW);
    expect(readLanOffer(null)).toBeNull();
    expect(readLanOffer([])).toBeNull();
    expect(readLanOffer({ v: 2, workerId: WORKER, sealed, mac: stamp })).toBeNull();
    expect(readLanOffer({ v: 1, workerId: "w1", sealed, mac: stamp })).toBeNull();
    expect(readLanOffer({ v: 1, workerId: WORKER, sealed: { v: 1 }, mac: stamp })).toBeNull();
    expect(readLanOffer({ v: 1, workerId: WORKER, sealed, mac: null })).toBeNull();
    expect(readMacStamp(stamp)).toEqual(stamp);
    for (const bad of [{ key: 5 }, { key: "!" }, { key: "A".repeat(65) }, { sig: 5 }, { sig: "A".repeat(121) }, { issuedAt: 1.5 }, { issuedAt: "1" }, { nonce: "xyz" }, { nonce: 5 }]) {
      expect(readMacStamp({ ...stamp, ...bad })).toBeNull();
    }
  });
});
