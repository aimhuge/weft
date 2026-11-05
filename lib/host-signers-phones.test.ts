// Paired phones on a worker (lib/host-signers.ts, H10): the pairing Mac endorses each phone's Ed25519 sign key in its
// signed set (`weft-endorse-v3`, lib/host-endorse.ts); the worker takes a phone's signature for an answer only, and only
// while the set it holds is the Mac's latest head.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { endorseMessage, readEndorsement, type EndorsedPhone, type Endorsement } from "./host-endorse";
import { createHostSigners, PHONE_SIG } from "./host-signers";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { behind, headMessage } from "./passkey-head";

const home = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-signers-phones-")), "home");
const NOW = 5_000_000;

function phone(device = "ph1") {
  const pair = crypto.generateKeyPairSync("ed25519");
  const signKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const sign = (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64");
  const key: EndorsedPhone = { device, signKey };
  return { key, sign };
}

function endorsement(mac: ReturnType<typeof macSigner>, phones: EndorsedPhone[], generation: number, over: Partial<Endorsement> = {}) {
  const e: Endorsement = { worker: "w1", passkeys: [], phones, generation, issuedAt: NOW, ...over };
  return { ...e, mac: "mac-1", sig: mac.sign(endorseMessage(e)) };
}

describe("readEndorsement with phones", () => {
  it("reads a v3 set's phones, and a set without them as none", () => {
    const mac = macSigner();
    const p = phone();
    expect(readEndorsement(endorsement(mac, [p.key], 1))?.phones).toEqual([p.key]);
    const v2 = Object.fromEntries(Object.entries(endorsement(mac, [], 1)).filter(([k]) => k !== "phones"));
    expect(readEndorsement(v2)?.phones).toEqual([]);
  });

  it("refuses a malformed list: not a list, too long, a bad key or id, or one device twice", () => {
    const raw = endorsement(macSigner(), [phone().key], 1);
    const k = raw.phones![0]!;
    for (const phones of ["x", Array(21).fill(k), [{ ...k, signKey: "c2hvcnQ=" }], [{ ...k, device: "a b" }], [k, { ...phone().key, device: k.device }], [null]]) {
      expect(readEndorsement({ ...raw, phones })).toBeNull();
    }
  });
});

describe("createHostSigners: phones", () => {
  it("pins the phones a newer set names, counts them as approvers, and takes their signature for an answer", async () => {
    const mac = macSigner();
    const p = phone();
    const s = createHostSigners(home(), [], memoryMacs([mac.key]));
    expect(s.phones()).toEqual([]);
    expect(await s.endorse(endorsement(mac, [p.key], 1), "w1", NOW)).toBe(1);
    expect(s.phones()).toEqual([{ ...p.key, by: "mac-1" }]);
    expect(s.approvers()).toBe(2);
    expect(await s.verifyAnswer({ device: "ph1", message: "m", sig: p.sign("m") })).toEqual({ ok: true });
    expect(await s.verifyAnswer({ device: "ph1", message: "m", sig: p.sign("other") })).toEqual({ ok: false, reason: PHONE_SIG });
    // Another device id goes to the pairing Mac's key; a phone's key there is no Mac's.
    expect(await s.verifyAnswer({ device: "mac-1", message: "m", sig: mac.sign("m") })).toEqual({ ok: true });
    expect((await s.verifyAnswer({ device: "ph2", message: "m", sig: p.sign("m") })).ok).toBe(false);
    // A widening stays the Mac's alone.
    expect((await s.verify({ device: "ph1", message: "m", sig: p.sign("m") })).ok).toBe(false);
  });

  it("takes the same set again as held, refuses an old one adding a phone, and a narrower newer one unpins it", async () => {
    const mac = macSigner();
    const p = phone();
    const s = createHostSigners(home(), [], memoryMacs([mac.key]));
    const first = endorsement(mac, [p.key], 2);
    await s.endorse(first, "w1", NOW);
    expect(await s.endorse(first, "w1", NOW + 60 * 60_000)).toBe(2);
    await expect(s.endorse(endorsement(mac, [p.key, phone("ph2").key], 3), "w1", NOW + 60 * 60_000)).rejects.toThrow(/too old/);
    expect(await s.endorse(endorsement(mac, [], 4), "w1", NOW + 60 * 60_000)).toBe(4);
    expect(s.phones()).toEqual([]);
    expect((await s.verifyAnswer({ device: "ph1", message: "m", sig: p.sign("m") })).ok).toBe(false);
  });

  it("refuses a phone while the set held is behind the Mac's latest head", async () => {
    const mac = macSigner();
    const p = phone();
    const head = (generation: number) => {
      const h = { worker: "w1", generation, issuedAt: NOW };
      return { ...h, sig: mac.sign(headMessage(h)) };
    };
    let rows: unknown[] = [head(1)];
    const s = createHostSigners(home(), [], memoryMacs([mac.key]), { worker: "w1", heads: () => Promise.resolve(rows) });
    await s.endorse(endorsement(mac, [p.key], 1), "w1", NOW);
    expect((await s.verifyAnswer({ device: "ph1", message: "m", sig: p.sign("m") })).ok).toBe(true);
    rows = [head(1), head(2)];
    expect(await s.verifyAnswer({ device: "ph1", message: "m", sig: p.sign("m") })).toEqual({ ok: false, reason: behind(1, 2) });
  });

  it("reads a passkeys.json from before phones as none", () => {
    const h = home();
    fs.mkdirSync(h, { recursive: true });
    fs.writeFileSync(path.join(h, "passkeys.json"), JSON.stringify({ generation: 3, passkeys: [], seen: 0 }));
    const s = createHostSigners(h, [], memoryMacs([macSigner().key]));
    expect(s.phones()).toEqual([]);
    expect(s.approvers()).toBe(1);
  });
});
