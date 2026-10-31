// Pairing a phone end to end in main (electron/pairing.cjs, paired-devices.cjs, sync-keys.cjs, pairing-crypto.cjs),
// with the phone's half made by the TypeScript the web and the phone use (lib/pairing-link.ts, lib/approval-sig.ts):
// so this also proves main and the TypeScript side agree on every byte.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalMessage, signApproval } from "../lib/approval-sig";
import { makeClaim, parsePairingLink } from "../lib/pairing-link";
import { b64, sodium as loadSodium, type Sodium } from "../lib/sodium";
import { openItem, sealItemRow } from "../lib/sync-seal";
import { createPairedDevices } from "./paired-devices.cjs";
import { createPairing, TTL_MS } from "./pairing.cjs";
import { checkClaim, verifySignature } from "./pairing-crypto.cjs";
import { createSyncKeys } from "./sync-keys.cjs";
import { fakeDb, fakeSafeStorage } from "./pairing.harness";
import vaultCrypto from "./vault-crypto.cjs";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let s: Sodium;
beforeAll(async () => {
  s = await loadSodium();
  await vaultCrypto.ready();
});

function setup({ confirm = true, clock = { t: 1_000_000 } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pair-"));
  const mac = vaultCrypto.newKeypair();
  const db = fakeDb({ devices: [{ id: "mac-1", public_key: mac.publicKey, kind: "desktop" }] });
  const myDevice = () => Promise.resolve({ id: "mac-1", ...mac });
  const paired = createPairedDevices({ dir, safeStorage: fakeSafeStorage, sodium: () => s });
  const syncKeys = createSyncKeys({ dir, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, db: () => db, myDevice });
  const ask = vi.fn(() => Promise.resolve(confirm));
  const pairing = createPairing({ db: () => db, sodium: () => s, macDevice: () => "mac-device-id", myDevice, paired, syncKeys, confirm: ask, now: () => clock.t });
  return { dir, db, paired, syncKeys, pairing, ask, clock, mac };
}

// The phone's half: keys, a claim written into the row, as weft-mobile does it.
function phone(link: string, db: ReturnType<typeof fakeDb>, over: Record<string, unknown> = {}) {
  const parsed = parsePairingLink(link)!;
  const box = s.crypto_box_keypair();
  const sign = s.crypto_sign_keypair();
  const claim = makeClaim(s, parsed, { name: "Alex's iPhone", platform: "ios", kind: "phone", box_key: b64(s, box.publicKey), sign_key: b64(s, sign.publicKey) }, b64(s, sign.privateKey));
  Object.assign(db.tables.phone_pairings.find((r) => r.id === parsed.id)!, { ...claim, status: "claimed", ...over });
  return { box, sign, parsed };
}

describe("pairing a phone", () => {
  it("pins it, adds its device row and seals the workspace key to it", async () => {
    const { db, pairing, paired, ask } = setup();
    const code = await pairing.start(ORG);
    expect(code.link).toMatch(/^https:\/\/weft\.zip\/pair#/);
    expect(db.tables.phone_pairings[0]!).toMatchObject({ org_id: ORG, mac_device: "mac-device-id" });
    expect(JSON.stringify(db.tables.phone_pairings)).not.toContain(parsePairingLink(code.link)!.secret);
    expect(await pairing.check(code.id)).toEqual({ status: "open" });

    const { box } = phone(code.link, db);
    const done = await pairing.check(code.id);
    expect(done.status).toBe("paired");
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('pair the phone "Alex\'s iPhone"'));
    expect(paired.list()).toHaveLength(1);
    expect(paired.approvers()).toBe(1);
    expect(db.tables.phone_pairings[0]!.status).toBe("paired");
    const device = db.tables.devices.find((d) => d.kind === "phone")!;
    expect(device).toMatchObject({ platform: "ios", name: "Alex's iPhone" });

    // The phone opens its grant and reads what the Mac sealed.
    const grant = db.tables.workspace_key_grants.find((g) => g.device_id === device.id)!;
    const key = b64(s, s.crypto_box_seal_open(s.from_base64(grant.wrapped_key as string, 1), box.publicKey, box.privateKey));
    const row = { org_id: ORG, card_id: "c", seq: 0, kind: "user" as const, item: { kind: "user" as const, text: "hi", at: 1 }, at: "t" };
    const sealed = sealItemRow(s, row, { version: grant.version as number, key });
    expect(openItem(s, sealed, new Map([[grant.version as number, key]]))).toEqual(row.item);
    expect(pairing.list()[0]).not.toHaveProperty("signKey");
  });

  it("refuses a claim made without the code, and says why", async () => {
    const { db, pairing, paired } = setup();
    const code = await pairing.start(ORG);
    phone(code.link, db, { proof: b64(s, new Uint8Array(32)) });
    expect(await pairing.check(code.id)).toEqual({ status: "failed", error: "The claim wasn't made with this code." });
    expect(paired.list()).toHaveLength(0);
    expect(db.tables.phone_pairings[0]!.status).toBe("cancelled");
  });

  it("pairs nothing when Touch ID says no", async () => {
    const { db, pairing, paired } = setup({ confirm: false });
    const code = await pairing.start(ORG);
    phone(code.link, db);
    expect(await pairing.check(code.id)).toEqual({ status: "cancelled" });
    expect(paired.list()).toHaveLength(0);
  });

  it("expires after five minutes, and forgets codes it didn't make", async () => {
    const clock = { t: 0 };
    const { pairing, db } = setup({ clock });
    const code = await pairing.start(ORG);
    clock.t = TTL_MS + 1;
    expect(await pairing.check(code.id)).toEqual({ status: "expired" });
    expect(db.tables.phone_pairings[0]!.status).toBe("cancelled");
    expect(await pairing.check("someone-elses")).toEqual({ status: "expired" });
  });

  it("a code cancelled elsewhere reads cancelled; cancel closes one", async () => {
    const { pairing, db } = setup();
    const a = await pairing.start(ORG);
    db.tables.phone_pairings[0]!.status = "cancelled";
    expect(await pairing.check(a.id)).toEqual({ status: "cancelled" });
    const b = await pairing.start(ORG);
    await pairing.cancel(b.id);
    await pairing.cancel(b.id);
    expect(db.tables.phone_pairings[1]!.status).toBe("cancelled");
  });

  it("needs a workspace, and finds your own when not given one", async () => {
    const { pairing, db } = setup();
    await expect(pairing.start("")).rejects.toThrow(/workspace/);
    db.tables.org_memberships = [{ org_id: "theirs", user_id: "someone", role: "owner", created_at: 1 }];
    await expect(pairing.start("")).rejects.toThrow(/workspace/);
    db.tables.org_memberships.push({ org_id: ORG, user_id: "", role: "owner", created_at: 2 });
    expect(parsePairingLink((await pairing.start("")).link)?.orgId).toBe(ORG);
  });

  it("re-pairs a known device and refuses a revoked one", async () => {
    const { db, pairing } = setup();
    const first = await pairing.start(ORG);
    const { box, sign, parsed } = phone(first.link, db);
    await pairing.check(first.id);
    const again = await pairing.start(ORG);
    const p2 = parsePairingLink(again.link)!;
    const claim = makeClaim(s, p2, { name: "Alex's iPhone", platform: "ios", kind: "phone", box_key: b64(s, box.publicKey), sign_key: b64(s, sign.publicKey) }, b64(s, sign.privateKey));
    Object.assign(db.tables.phone_pairings[1]!, { ...claim, status: "claimed" });
    expect((await pairing.check(again.id)).status).toBe("paired");
    expect(db.tables.devices.filter((d) => d.kind === "phone")).toHaveLength(1);
    expect(parsed.id).not.toBe(p2.id);

    db.tables.devices.find((d) => d.kind === "phone")!.revoked_at = "then";
    const third = await pairing.start(ORG);
    const p3 = parsePairingLink(third.link)!;
    Object.assign(db.tables.phone_pairings[2]!, { ...makeClaim(s, p3, { name: "x", platform: "ios", kind: "phone", box_key: b64(s, box.publicKey), sign_key: b64(s, sign.publicKey) }, b64(s, sign.privateKey)), status: "claimed" });
    await expect(pairing.check(third.id)).rejects.toThrow(/revoked/);
  });
});

describe("revoking", () => {
  it("unpins, drops its grants, marks it revoked and rotates the key", async () => {
    const { db, pairing, paired, syncKeys } = setup();
    const code = await pairing.start(ORG);
    phone(code.link, db);
    const { device } = (await pairing.check(code.id)) as { device: { id: string } };
    expect(await pairing.revoke(device.id)).toEqual({ ok: true, version: 2 });
    expect(paired.list()).toHaveLength(0);
    expect(db.tables.workspace_key_grants.some((g) => g.device_id === device.id)).toBe(false);
    expect(db.tables.devices.find((d) => d.id === device.id)!.revoked_at).toBeTruthy();
    expect((await syncKeys.current(ORG))?.version).toBe(2);
    expect(await pairing.revoke(device.id)).toEqual({ ok: false });
  });
});

describe("the workspace key", () => {
  it("is null until made, then reads back from the cache or a grant", async () => {
    const { syncKeys, db, dir } = setup();
    expect(await syncKeys.current(ORG)).toBeNull();
    const made = await syncKeys.current(ORG, { create: true });
    expect(made).toMatchObject({ version: 1 });
    expect(await syncKeys.current(ORG)).toEqual(made);
    fs.rmSync(syncKeys.file);
    expect(await syncKeys.current(ORG)).toEqual(made);
    expect(db.tables.workspace_keys).toHaveLength(1);
    fs.writeFileSync(syncKeys.file, "garbage");
    expect((await syncKeys.keyring(ORG)).get(1)).toBe(made!.key);
    expect(fs.existsSync(path.join(dir, "vault"))).toBe(true);
  });

  it("is null when another device made it and hasn't granted this Mac", async () => {
    const { syncKeys, db } = setup();
    db.tables.workspace_keys = [{ org_id: ORG, version: 1 }];
    db.tables.workspace_key_grants = [{ org_id: ORG, version: 1, device_id: "mac-1", wrapped_key: "not a box" }];
    expect(await syncKeys.current(ORG)).toBeNull();
  });

  it("names a read that fails", async () => {
    const { db, dir, mac } = setup();
    const failing: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "offline" } }).then(r) };
    for (const m of ["select", "eq", "order", "limit", "single", "maybeSingle", "insert", "update", "delete"]) failing[m] = () => failing;
    const broken = { from: () => failing };
    expect(db).toBeTruthy();
    const keys = createSyncKeys({ dir, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, db: () => broken, myDevice: () => Promise.resolve({ id: "m", ...mac }) });
    await expect(keys.current(ORG)).rejects.toThrow("The workspace key couldn't be read: offline");
  });
});

describe("approvals", () => {
  it("count a paired phone's signature only", async () => {
    const { db, pairing, paired } = setup();
    const code = await pairing.start(ORG);
    const { sign } = phone(code.link, db);
    const { device } = (await pairing.check(code.id)) as { device: { id: string } };
    const message = approvalMessage(s, { orgId: ORG, macDevice: "mac-device-id", cardId: "c", pendingId: "p", allow: true, issuedAt: 5 });
    const sig = signApproval(s, message, b64(s, sign.privateKey));
    expect(paired.verify({ device: device.id, message, sig })).toEqual({ ok: true, name: "Alex's iPhone" });
    expect(paired.verify({ device: device.id, message: message.replace("allow", "deny"), sig }).ok).toBe(false);
    expect(paired.verify({ device: "stranger", message, sig })).toEqual({ ok: false, reason: "That device isn't paired with this Mac." });
  });

  it("never from a browser", () => {
    const { paired } = setup();
    paired.pin({ id: "b", name: "Chrome", kind: "browser", platform: "web", signKey: "k", boxKey: "k", fingerprint: "f", orgId: ORG, pairedAt: "t" });
    expect(paired.verify({ device: "b", message: "m", sig: "s" })).toEqual({ ok: false, reason: "Only a paired phone can approve." });
    expect(paired.approvers()).toBe(0);
  });

  it("a tampered pin file trusts no one but still needs a phone", () => {
    const { paired } = setup();
    paired.pin({ id: "p", name: "x", kind: "phone", platform: "ios", signKey: "k", boxKey: "k", fingerprint: "f", orgId: ORG, pairedAt: "t" });
    fs.writeFileSync(paired.file, "tampered");
    expect(paired.list()).toEqual([]);
    expect(paired.approvers()).toBe(1);
    expect(paired.verify({ device: "p", message: "m", sig: "s" }).ok).toBe(false);
  });
});

describe("main and the TypeScript side agree", () => {
  it("on claims and signatures", () => {
    const link = { id: "11111111-2222-4333-8444-555555555555", orgId: ORG, secret: "A".repeat(43), mac: "" };
    const sign = s.crypto_sign_keypair();
    const claim = makeClaim(s, link, { name: "n", platform: "web", kind: "browser", box_key: "Ym94", sign_key: b64(s, sign.publicKey) }, b64(s, sign.privateKey));
    expect(checkClaim(s, link, { ...claim })).toBeNull();
    expect(checkClaim(s, link, { ...claim, name: "m" })).toMatch(/wasn't made/);
    expect(checkClaim(s, link, { ...claim, sign_key: b64(s, s.crypto_sign_keypair().publicKey), proof: claim.proof })).toMatch(/wasn't made|signature/);
    expect(checkClaim(s, link, { ...claim, sig: "!!" })).toMatch(/readable/);
    expect(checkClaim(s, link, { ...claim, kind: "tv" })).toMatch(/unknown/);
    expect(checkClaim(s, link, { ...claim, sig: "" })).toMatch(/missing/);
    expect(verifySignature(s, "m", signApproval(s, "m", b64(s, sign.privateKey)), b64(s, sign.publicKey))).toBe(true);
    expect(verifySignature(s, "m", "!!", "x")).toBe(false);
  });
});

beforeEach(() => vi.restoreAllMocks());

describe("the switches", () => {
  it("default off, persist, and survive pins", () => {
    const { paired } = setup();
    expect(paired.settings()).toEqual({ seal: false, webApprovals: false });
    expect(paired.setSettings({ seal: true, webApprovals: "yes" as never })).toEqual({ seal: true, webApprovals: false });
    paired.pin({ id: "p", name: "x", kind: "phone", platform: "ios", signKey: "k", boxKey: "k", fingerprint: "f", orgId: ORG, pairedAt: "t" });
    paired.unpin("p");
    expect(paired.settings()).toEqual({ seal: true, webApprovals: false });
    expect(paired.setSettings({ webApprovals: true }).webApprovals).toBe(true);
  });
});
