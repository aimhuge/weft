import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostSigners, endorseMessage, ENDORSE_MAX_AGE_MS, ENDORSE_USED, NO_MAC, readEndorsement, type Endorsement } from "./host-signers";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { makePasskey } from "./passkey.harness";
import { PASSKEY_ORIGIN, PASSKEY_RP_ID } from "./passkey-verify";
import { fileNonceStore, nonceBook } from "./widen-nonces";

const ORIGINS = [{ origin: PASSKEY_ORIGIN, rpId: PASSKEY_RP_ID }];
const home = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-signers-")), "home");
const NOW = 5_000_000;

async function endorsed(mac = macSigner(), over: Partial<Endorsement> = {}) {
  const pk = await makePasskey();
  const e: Endorsement = { worker: "w1", device: "browser-1", credId: "Y3JlZA", publicKey: pk.publicKey, revoke: false, issuedAt: NOW, ...over };
  return { pk, e, raw: { ...e, mac: "mac-1", sig: mac.sign(endorseMessage(e)) } };
}

describe("createHostSigners: the pairing Mac", () => {
  it("checks an Ed25519 signature against the Mac key H8 pinned, and says when none is", async () => {
    const mac = macSigner();
    const s = createHostSigners(home(), ORIGINS, memoryMacs([mac.key]));
    expect(await s.verify({ device: "any", message: "m", sig: mac.sign("m") })).toEqual({ ok: true });
    expect((await s.verify({ device: "any", message: "m", sig: macSigner().sign("m") })).ok).toBe(false);
    expect(await createHostSigners(home(), ORIGINS, memoryMacs()).verify({ device: "d", message: "m", sig: "x" })).toEqual({ ok: false, reason: NO_MAC });
  });

  it("reads mac-keys.json in its home by default", async () => {
    const h = home();
    fs.mkdirSync(h, { recursive: true });
    const mac = macSigner();
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify([mac.key]));
    expect((await createHostSigners(h, ORIGINS).verify({ device: "d", message: "m", sig: mac.sign("m") })).ok).toBe(true);
  });
});

describe("createHostSigners: passkeys the Mac endorsed", () => {
  it("pins an endorsed passkey, checks its assertion and keeps its counter, and unpins on a revoke", async () => {
    const mac = macSigner();
    const h = home();
    const s = createHostSigners(h, ORIGINS, memoryMacs([mac.key]));
    const { pk, e, raw } = await endorsed(mac);
    await s.endorse((await endorsed(mac, { device: "browser-0" })).raw, "w1", NOW);
    await s.endorse(raw, "w1", NOW);
    expect(s.read().slice(1)).toEqual([{ device: e.device, credId: e.credId, publicKey: pk.publicKey, counter: 0, by: "mac-1" }]);
    expect(fs.statSync(s.file).mode & 0o777).toBe(0o600);
    const body = (message: string, a: Awaited<ReturnType<typeof pk.sign>>) => ({ device: e.device, credId: e.credId, message, ...a });
    expect(await s.verifyPasskey(body("hello", await pk.sign("hello")))).toEqual({ ok: true });
    expect((await s.verifyPasskey(body("hello", await pk.sign("other")))).ok).toBe(false);
    expect((await s.verifyPasskey({ ...body("hello", await pk.sign("hello")), credId: "bm9wZQ" })).reason).toMatch(/isn't trusted/);
    // A second endorsement of the same key keeps its counter.
    await s.endorse((endorsedAgain(mac, { ...e, issuedAt: NOW + 1 })).raw, "w1", NOW);
    expect(s.read()).toHaveLength(2);
    await s.endorse((endorsedAgain(mac, { ...e, revoke: true })).raw, "w1", NOW);
    expect(s.read().map((p) => p.device)).toEqual(["browser-0"]);
  });

  it("runs each endorsement once, so one read off an earlier pin row can't undo a revoke, even after a restart", async () => {
    const mac = macSigner();
    const h = home();
    // The book a worker keeps beside passkeys.json, on the test's clock.
    const seen = () => nonceBook(fileNonceStore(path.join(h, "endorsements-seen.json")), () => NOW);
    const s = createHostSigners(h, ORIGINS, memoryMacs([mac.key]), seen());
    const { e, raw } = await endorsed(mac);
    await s.endorse(raw, "w1", NOW);
    await s.endorse(endorsedAgain(mac, { ...e, revoke: true, issuedAt: NOW + 1 }).raw, "w1", NOW);
    await expect(s.endorse(raw, "w1", NOW + 2)).rejects.toThrow(ENDORSE_USED);
    await expect(createHostSigners(h, ORIGINS, memoryMacs([mac.key]), seen()).endorse(raw, "w1", NOW + 2)).rejects.toThrow(ENDORSE_USED);
    expect(s.read()).toEqual([]);
  });

  it("refuses an endorsement for another worker, an old one, a bent one, or one no pinned Mac signed", async () => {
    const mac = macSigner();
    const s = createHostSigners(home(), ORIGINS, memoryMacs([mac.key]));
    const { raw } = await endorsed(mac);
    await expect(s.endorse({ ...raw, sig: undefined }, "w1", NOW)).rejects.toThrow(/incomplete/);
    await expect(s.endorse(raw, "w2", NOW)).rejects.toThrow(/another worker/);
    await expect(s.endorse(raw, "w1", NOW + ENDORSE_MAX_AGE_MS + 1)).rejects.toThrow(/too old/);
    await expect(s.endorse({ ...raw, device: "browser-2" }, "w1", NOW)).rejects.toThrow(/pairing Mac/);
    await expect(s.endorse((await endorsed(macSigner())).raw, "w1", NOW)).rejects.toThrow(/pairing Mac/);
    expect(s.read()).toEqual([]);
  });

  it("reads a damaged passkeys file as none", () => {
    const h = home();
    fs.mkdirSync(h, { recursive: true });
    fs.writeFileSync(path.join(h, "passkeys.json"), "{}");
    expect(createHostSigners(h, ORIGINS, memoryMacs()).read()).toEqual([]);
    fs.writeFileSync(path.join(h, "passkeys.json"), "{");
    expect(createHostSigners(h, ORIGINS, memoryMacs()).read()).toEqual([]);
  });
});

function endorsedAgain(mac: ReturnType<typeof macSigner>, e: Endorsement) {
  return { raw: { ...e, mac: "mac-1", sig: mac.sign(endorseMessage(e)) } };
}

describe("readEndorsement", () => {
  it("takes only a whole one", async () => {
    const { raw } = await endorsed();
    expect(readEndorsement(raw)).toEqual(raw);
    for (const bad of [null, "x", { ...raw, worker: "a b" }, { ...raw, publicKey: "a b" }, { ...raw, revoke: "no" }, { ...raw, issuedAt: Infinity }, { ...raw, mac: 1 }]) {
      expect(readEndorsement(bad)).toBeNull();
    }
  });
});
