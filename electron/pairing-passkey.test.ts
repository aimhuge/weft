// A browser pairing with a passkey, in main: the claim (made by lib/web-sync-key.ts's TypeScript) is checked, Touch ID
// names the passkey, and the passkey is pinned with the device, so POST /pairing/passkey hands it over and the counter
// moves on. A browser without one, and every phone, pair as before (electron/pairing.test.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeClaim, parsePairingLink } from "../lib/pairing-link";
import { passkeyCode } from "../lib/passkey-code";
import { authData, makePasskey, type TestPasskey } from "../lib/passkey.harness";
import { b64, sodium as loadSodium, type Sodium } from "../lib/sodium";
import { createPairedDevices } from "./paired-devices.cjs";
import { createPairing } from "./pairing.cjs";
import { checkClaim } from "./pairing-crypto.cjs";
import { createSyncKeys } from "./sync-keys.cjs";
import { fakeDb, fakeSafeStorage } from "./pairing.harness";
import vaultCrypto from "./vault-crypto.cjs";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let s: Sodium;
beforeAll(async () => {
  s = await loadSodium();
  await vaultCrypto.ready();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-passkey-"));
  const mac = vaultCrypto.newKeypair();
  const db = fakeDb({ devices: [{ id: "mac-1", public_key: mac.publicKey, kind: "desktop" }] });
  const myDevice = () => Promise.resolve({ id: "mac-1", ...mac });
  const paired = createPairedDevices({ dir, safeStorage: fakeSafeStorage, sodium: () => s });
  const syncKeys = createSyncKeys({ dir, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, db: () => db, myDevice });
  const ask = vi.fn(() => Promise.resolve(true));
  const pairing = createPairing({ db: () => db, sodium: () => s, macDevice: () => "mac-device-id", myDevice, paired, syncKeys, confirm: ask, now: () => 1_000_000 });
  return { db, paired, pairing, ask };
}

let key: TestPasskey;
let PASSKEY: { passkey_id: string; passkey_key: string };
beforeAll(async () => {
  key = await makePasskey();
  PASSKEY = { passkey_id: "Y3JlZA", passkey_key: key.publicKey };
});
const MESSAGE = '{"v":"weft-passkey-approval-v1"}';

function browser(link: string, db: ReturnType<typeof fakeDb>, over: Record<string, unknown> = {}) {
  const parsed = parsePairingLink(link)!;
  const sign = s.crypto_sign_keypair();
  const body = { name: "Alex · Safari", platform: "web" as const, kind: "browser" as const, box_key: b64(s, s.crypto_box_keypair().publicKey), sign_key: b64(s, sign.publicKey), ...PASSKEY, ...over };
  const claim = makeClaim(s, parsed, body, b64(s, sign.privateKey));
  Object.assign(db.tables.phone_pairings.find((r) => r.id === parsed.id)!, { ...claim, status: "claimed" });
}

describe("pairing a browser with a passkey", () => {
  it("names the passkey at Touch ID, pins it, records it and counts it as an approver", async () => {
    const { db, pairing, paired, ask } = setup();
    const code = await pairing.start(ORG, { passkey: true });
    expect(code.link).toMatch(/^https:\/\/sign\.weft\.zip\/pair#/);
    expect(code.passkey).toBe(true);
    browser(code.link, db);
    const done = (await pairing.check(code.id)) as { status: string; device: { id: string; passkey?: boolean } };
    expect(done.status).toBe("paired");
    expect(done.device.passkey).toBe(true);
    // Touch ID names the same code the sign.weft.zip page shows, from main's own copy of the derivation.
    expect(ask).toHaveBeenCalledWith(expect.stringContaining(`only if sign.weft.zip shows the code ${await passkeyCode(PASSKEY.passkey_key)}`));
    expect(db.tables.devices.find((d) => d.kind === "browser")).toMatchObject(PASSKEY);
    expect(paired.approvers()).toBe(1);
    // Still not a phone: its Ed25519 key signs nothing.
    expect(paired.verify({ device: done.device.id, message: "m", sig: "s" }).ok).toBe(false);

    // Main verifies against the pin and keeps the counter in the same step; nothing else moves it.
    const verify = async (counter: number, over: Record<string, string> = {}) => paired.verifyPasskey({ device: done.device.id, credId: "Y3JlZA", message: MESSAGE, ...(await key.sign(MESSAGE, { auth: await authData({ counter }) })), ...over });
    expect(await verify(9)).toEqual({ ok: true, name: "Alex · Safari" });
    expect((await verify(9)).ok).toBe(false);
    expect((await verify(3)).ok).toBe(false);
    expect(await verify(10)).toMatchObject({ ok: true });
    expect(await verify(11, { credId: "other" })).toEqual({ ok: false, reason: "That passkey isn't paired with this Mac." });
    expect(await verify(11, { device: "stranger" })).toEqual({ ok: false, reason: "That device isn't paired with this Mac." });
    expect(paired.list().find((d) => d.id === done.device.id)?.passkey?.counter).toBe(10);
  });

  it("takes a passkey only through a passkey code, and a passkey code only with one", async () => {
    const { db, pairing, paired } = setup();
    // A phone or read-only code (its link opens on weft.zip) can't pin a passkey: a script there could have made it.
    const plain = await pairing.start(ORG);
    expect(plain.link).toMatch(/^https:\/\/weft\.zip\/pair#/);
    browser(plain.link, db);
    expect(await pairing.check(plain.id)).toEqual({ status: "failed", error: "This code can't pair a passkey. Use Pair a passkey on your Mac." });
    // A passkey code with no passkey in the claim is refused too.
    const code = await pairing.start(ORG, { passkey: true });
    browser(code.link, db, { passkey_id: null, passkey_key: null });
    expect(await pairing.check(code.id)).toEqual({ status: "failed", error: "A passkey code needs a passkey made on sign.weft.zip." });
    expect(paired.list()).toEqual([]);
  });

  it("verifies no passkey for a phone or a browser without one", async () => {
    const { paired } = setup();
    const base = { platform: "web", signKey: "k", fingerprint: "f", orgId: ORG, pairedAt: "t" };
    paired.pin({ id: "b", name: "Chrome", kind: "browser", boxKey: "b", ...base });
    paired.pin({ id: "p", name: "iPhone", kind: "phone", boxKey: "p", ...base, passkey: { credId: "Y3JlZA", publicKey: key.publicKey, counter: 0 } });
    const sig = await key.sign(MESSAGE);
    expect(paired.verifyPasskey({ device: "b", credId: "Y3JlZA", message: MESSAGE, ...sig }).ok).toBe(false);
    expect(paired.verifyPasskey({ device: "p", credId: "Y3JlZA", message: MESSAGE, ...sig }).ok).toBe(false);
  });

  it("refuses a pin that reuses a pinned device's id with other keys", () => {
    const { paired } = setup();
    const base = { name: "iPhone", kind: "phone" as const, platform: "ios", signKey: "k", fingerprint: "f", orgId: ORG, pairedAt: "t" };
    paired.pin({ id: "p", boxKey: "phone-box", ...base });
    expect(() => paired.pin({ id: "p", boxKey: "server-box", ...base })).toThrow(/already paired/);
    paired.pin({ id: "p", boxKey: "phone-box", ...base, name: "renamed" });
    expect(paired.list()).toEqual([expect.objectContaining({ id: "p", boxKey: "phone-box", name: "renamed" })]);
  });

  it("main checks the passkey lines as the TypeScript does", () => {
    const link = { id: "11111111-2222-4333-8444-555555555555", orgId: ORG, secret: "A".repeat(43), mac: "" };
    const sign = s.crypto_sign_keypair();
    const claim = makeClaim(s, link, { name: "n", platform: "web", kind: "browser", box_key: "Ym94", sign_key: b64(s, sign.publicKey), ...PASSKEY }, b64(s, sign.privateKey));
    expect(checkClaim(s, link, { ...claim })).toBeNull();
    expect(checkClaim(s, link, { ...claim, passkey_key: "b3RoZXI" })).toMatch(/wasn't made/);
    expect(checkClaim(s, link, { ...claim, passkey_key: null })).toMatch(/incomplete/);
    expect(checkClaim(s, link, { ...claim, kind: "phone" })).toMatch(/incomplete/);
  });
});
