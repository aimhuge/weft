import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { endorseMessage, ENDORSE_MAX_AGE_MS, ENDORSE_OLD, readEndorsement, type EndorsedKey, type Endorsement } from "./host-endorse";
import { createHostSigners, NO_MAC } from "./host-signers";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { makePasskey } from "./passkey.harness";
import { PASSKEY_ORIGIN, PASSKEY_RP_ID } from "./passkey-verify";

const ORIGINS = [{ origin: PASSKEY_ORIGIN, rpId: PASSKEY_RP_ID }];
const home = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-signers-")), "home");
const NOW = 5_000_000;

// One endorsement of a set of passkeys for w1, signed by `mac`.
function endorsement(mac: ReturnType<typeof macSigner>, passkeys: EndorsedKey[], generation: number, over: Partial<Endorsement> = {}) {
  const e: Endorsement = { worker: "w1", passkeys, generation, issuedAt: NOW, ...over };
  return { ...e, mac: "mac-1", sig: mac.sign(endorseMessage(e)) };
}

async function endorsed(mac = macSigner(), device = "browser-1") {
  const pk = await makePasskey();
  const key: EndorsedKey = { device, credId: "Y3JlZA", publicKey: pk.publicKey };
  return { pk, key, raw: endorsement(mac, [key], 1) };
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

describe("createHostSigners: approvers", () => {
  it("counts the pinned Mac and the passkeys it endorsed, and none on a token-enrolled box", async () => {
    expect(createHostSigners(home(), ORIGINS, memoryMacs()).approvers()).toBe(0);
    const mac = macSigner();
    const s = createHostSigners(home(), ORIGINS, memoryMacs([mac.key]));
    expect(s.approvers()).toBe(1);
    const { raw } = await endorsed(mac);
    await s.endorse(raw, "w1", NOW);
    expect(s.approvers()).toBe(2);
  });
});

describe("createHostSigners: passkeys the Mac endorsed", () => {
  it("pins the endorsed set, checks an assertion and keeps its counter, and drops a passkey a newer set leaves out", async () => {
    const mac = macSigner();
    const h = home();
    const s = createHostSigners(h, ORIGINS, memoryMacs([mac.key]));
    const { pk, key } = await endorsed(mac);
    const other: EndorsedKey = { device: "browser-0", credId: "b3RoZXI", publicKey: (await makePasskey()).publicKey };
    await s.endorse(endorsement(mac, [key, other], 1), "w1", NOW);
    expect(s.read().find((p) => p.device === key.device)).toEqual({ ...key, counter: 0, by: "mac-1" });
    expect(fs.statSync(s.file).mode & 0o777).toBe(0o600);
    const body = (message: string, a: Awaited<ReturnType<typeof pk.sign>>) => ({ device: key.device, credId: key.credId, message, ...a });
    expect(await s.verifyPasskey(body("hello", await pk.sign("hello")))).toEqual({ ok: true });
    const counter = s.read().find((p) => p.device === key.device)?.counter;
    expect((await s.verifyPasskey(body("hello", await pk.sign("other")))).ok).toBe(false);
    expect((await s.verifyPasskey({ ...body("hello", await pk.sign("hello")), credId: "bm9wZQ" })).reason).toMatch(/isn't trusted/);
    // A newer set that keeps the key keeps its counter; one without it unpins it.
    await s.endorse(endorsement(mac, [key], 2), "w1", NOW);
    expect(s.read()).toEqual([{ ...key, counter, by: "mac-1" }]);
    await s.endorse(endorsement(mac, [], 3), "w1", NOW);
    expect(s.read()).toEqual([]);
  });

  it("refuses an endorsement no newer than the one it has, so one read off an earlier pin row can't undo a revoke", async () => {
    const mac = macSigner();
    const h = home();
    const s = createHostSigners(h, ORIGINS, memoryMacs([mac.key]));
    const { raw } = await endorsed(mac);
    await s.endorse(raw, "w1", NOW);
    await s.endorse(endorsement(mac, [], 2), "w1", NOW);
    await expect(s.endorse(raw, "w1", NOW)).rejects.toThrow(ENDORSE_OLD);
    await expect(createHostSigners(h, ORIGINS, memoryMacs([mac.key])).endorse(endorsement(mac, [raw.passkeys[0] as EndorsedKey], 2), "w1", NOW)).rejects.toThrow(ENDORSE_OLD);
    expect(s.read()).toEqual([]);
  });

  it("takes a set that only takes passkeys away however old it is, and the set it holds again, with its generation", async () => {
    const mac = macSigner();
    const s = createHostSigners(home(), ORIGINS, memoryMacs([mac.key]));
    const { key, raw } = await endorsed(mac);
    expect(await s.endorse(raw, "w1", NOW)).toBe(1);
    // The same set sent again (its receipt was lost) is held, not refused.
    expect(await s.endorse(raw, "w1", NOW + ENDORSE_MAX_AGE_MS * 50)).toBe(1);
    // A worker that was off for a day still takes the revoke waiting for it.
    expect(await s.endorse(endorsement(mac, [], 2), "w1", NOW + ENDORSE_MAX_AGE_MS * 100)).toBe(2);
    expect(s.read()).toEqual([]);
    // A set that adds one is still fresh or refused.
    await expect(s.endorse(endorsement(mac, [key], 3), "w1", NOW + ENDORSE_MAX_AGE_MS + 1)).rejects.toThrow(/too old/);
    // The same generation with another set is no receipt.
    await expect(s.endorse(endorsement(mac, [key], 2), "w1", NOW)).rejects.toThrow(ENDORSE_OLD);
  });

  it("refuses an endorsement for another worker, an old one, a bent one, or one no pinned Mac signed", async () => {
    const mac = macSigner();
    const s = createHostSigners(home(), ORIGINS, memoryMacs([mac.key]));
    const { raw } = await endorsed(mac);
    await expect(s.endorse({ ...raw, sig: undefined }, "w1", NOW)).rejects.toThrow(/incomplete/);
    await expect(s.endorse(raw, "w2", NOW)).rejects.toThrow(/another worker/);
    await expect(s.endorse(raw, "w1", NOW + ENDORSE_MAX_AGE_MS + 1)).rejects.toThrow(/too old/);
    await expect(s.endorse({ ...raw, generation: 9 }, "w1", NOW)).rejects.toThrow(/pairing Mac/);
    await expect(s.endorse((await endorsed(macSigner())).raw, "w1", NOW)).rejects.toThrow(/pairing Mac/);
    expect(s.read()).toEqual([]);
  });

  it("reads a damaged passkeys file as none, and a list from before generations as generation 0", () => {
    const h = home();
    fs.mkdirSync(h, { recursive: true });
    fs.writeFileSync(path.join(h, "passkeys.json"), "{}");
    expect(createHostSigners(h, ORIGINS, memoryMacs()).read()).toEqual([]);
    fs.writeFileSync(path.join(h, "passkeys.json"), "{");
    expect(createHostSigners(h, ORIGINS, memoryMacs()).read()).toEqual([]);
    fs.writeFileSync(path.join(h, "passkeys.json"), JSON.stringify([{ device: "d" }]));
    expect(createHostSigners(h, ORIGINS, memoryMacs()).read()).toEqual([{ device: "d" }]);
  });
});

describe("endorseMessage", () => {
  it("is one message for a set in any order, the same key twice included", () => {
    const a = { device: "a", credId: "c", publicKey: "k" };
    const b = { device: "b", credId: "c", publicKey: "k" };
    const e = { worker: "w", passkeys: [b, a, a], generation: 1, issuedAt: 1 };
    expect(endorseMessage(e)).toBe(endorseMessage({ ...e, passkeys: [a, b, a] }));
  });
});

describe("readEndorsement", () => {
  it("takes only a whole one", async () => {
    const { raw } = await endorsed();
    expect(readEndorsement(raw)).toEqual(raw);
    const key = raw.passkeys[0];
    for (const bad of [null, "x", { ...raw, worker: "a b" }, { ...raw, passkeys: [{ ...key, publicKey: "a b" }] }, { ...raw, passkeys: "no" }, { ...raw, generation: "1" }, { ...raw, issuedAt: Infinity }, { ...raw, mac: 1 }, { ...raw, passkeys: Array(51).fill(key) }, { ...raw, passkeys: [null] }]) {
      expect(readEndorsement(bad)).toBeNull();
    }
  });
});
