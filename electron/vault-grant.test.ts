import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { aadFor, acceptGrant, cryptoReady, openGrant, wrapForDevice } from "./vault-grant.cjs";
import { grantPendingDevice } from "./vault-share.cjs";
import { fingerprint } from "./device-fingerprint.cjs";
import { fakeSupabase } from "./vault-grant.harness";
import * as sodium from "./vault-crypto.cjs";

beforeAll(async () => {
  await cryptoReady(sodium);
  await sodium.ready();
});

// A keypair pair: the granter's machine and the device that joins later.
const granter = () => sodium.newKeypair();
const newcomer = () => sodium.newKeypair();

describe("wrapForDevice and acceptGrant", () => {
  it("seals the vault key to the new device, and only that device opens it", () => {
    const mine = granter();
    const theirs = newcomer();
    const vault = { id: "vault-1", key: sodium.newVaultKey(), keyVersion: 1 };

    const { wrappedKey, keyVersion } = wrapForDevice({ vault, granterDevice: mine, newDevice: { id: "device-2", publicKey: theirs.publicKey } });

    expect(keyVersion).toBe(1);
    // The box is the sealed key, not the key.
    expect(wrappedKey).not.toBe(vault.key);
    expect(Buffer.from(wrappedKey, "base64").length).toBe(32 + 48);

    // The new device opens it; nobody else does.
    expect(acceptGrant({ vault, myDevice: theirs, wrappedKey }).key).toBe(vault.key);
    expect(() => acceptGrant({ vault, myDevice: granter(), wrappedKey })).toThrow();
  });

  it("refuses to seal without a key or a public key", () => {
    const vault = { id: "v", key: sodium.newVaultKey() };
    expect(() => wrapForDevice({ vault, granterDevice: granter(), newDevice: { publicKey: "" } })).toThrow(/public key/);
    expect(() => wrapForDevice({ vault: { id: "v" }, granterDevice: granter(), newDevice: { publicKey: "x" } })).toThrow(/key isn't available/);
    expect(() => wrapForDevice({ vault, granterDevice: { publicKey: "" }, newDevice: { publicKey: "x" } })).toThrow(/no key to share/);
  });

  it("refuses to open a grant without a private key", () => {
    const vault = { key: sodium.newVaultKey() };
    expect(() => acceptGrant({ vault, myDevice: { publicKey: "x" }, wrappedKey: "abc" })).toThrow(/private key/);
    expect(() => acceptGrant({ vault, myDevice: { publicKey: "x", privateKey: "y" }, wrappedKey: "" })).toThrow(/no key/);
  });
});

describe("a sealed key opens the values under it", () => {
  it("binds each value to its vault, name, environment and key version", () => {
    const mine = granter();
    const theirs = newcomer();
    const vault = { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1 };

    // The granter encrypts with the vault key.
    const box = sodium.encrypt("sk_test_0123456789", vault.key, aadFor(vault.id, "API_KEY", "development", vault.keyVersion)); // gitleaks:allow

    // The new device gets the same key, sealed, and opens the value.
    const { wrappedKey } = wrapForDevice({ vault, granterDevice: mine, newDevice: { publicKey: theirs.publicKey } });
    const opened = acceptGrant({ vault, myDevice: theirs, wrappedKey });
    expect(sodium.decrypt(box, opened.key, aadFor(vault.id, "API_KEY", "development", opened.keyVersion))).toBe("sk_test_0123456789"); // gitleaks:allow

    // The AAD holds: the same ciphertext on another name, environment or version doesn't open.
    expect(() => sodium.decrypt(box, opened.key, aadFor(vault.id, "OTHER", "development", 1))).toThrow();
    expect(() => sodium.decrypt(box, opened.key, aadFor(vault.id, "API_KEY", "production", 1))).toThrow();
    expect(() => sodium.decrypt(box, opened.key, aadFor(vault.id, "API_KEY", "development", 2))).toThrow();
    expect(() => sodium.decrypt(box, opened.key, aadFor("github:other/name", "API_KEY", "development", 1))).toThrow();
  });

  it("keeps the vault key out of everything that gets written down", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-grant-"));
    const mine = granter();
    const theirs = newcomer();
    const vault = { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1 };

    const { wrappedKey } = wrapForDevice({ vault, granterDevice: mine, newDevice: { publicKey: theirs.publicKey } });

    // The two artifacts a shared vault writes: the shadow's metadata and the sealed grant.
    const sharedFile = path.join(dir, "shared.json");
    fs.writeFileSync(sharedFile, JSON.stringify({ orgId: "org-1", vaultId: "vault-1", repo: "owner/name", keyVersion: 1 }));
    const grantFile = path.join(dir, "grant.json");
    fs.writeFileSync(grantFile, JSON.stringify({ vault_id: "vault-1", device_id: "device-2", key_version: 1, wrapped_key: wrappedKey }));

    const written = fs.readFileSync(sharedFile, "utf8") + fs.readFileSync(grantFile, "utf8");
    expect(written).not.toContain(vault.key);
    expect(written).not.toContain(theirs.privateKey);
    expect(written).not.toContain(mine.privateKey);
    // What it does hold is the sealed box, which is not the key.
    expect(written).toContain(wrappedKey);
  });
});

describe("grantPendingDevice", () => {
  it("seals the vault key to the accepted device and stores it through the server's function", async () => {
    const mine = granter();
    const theirs = newcomer();
    const vault = { id: "vault-1", key: sodium.newVaultKey(), keyVersion: 2 };
    const { written, client } = fakeSupabase({
      pending: { id: "pending-1", vault_id: "vault-1", status: "accepted", matched_device_id: "device-2", target_public_key: theirs.publicKey, target_fingerprint: fingerprint(theirs.publicKey) },
      rpc: "device-2",
    });

    const result = await grantPendingDevice({ accountClient: client, pendingId: "pending-1", vault, device: { id: "device-1", publicKey: mine.publicKey }, sodium });

    expect(result).toEqual({ deviceId: "device-2", keyVersion: 2 });
    const call = written.find((w) => w.op === "grant_vault_device")!.row as { p_pending_id: string; p_key_version: number; p_wrapped_key: string };
    expect(call.p_pending_id).toBe("pending-1");
    expect(call.p_key_version).toBe(2);
    // The server got a sealed box, never the key.
    expect(call.p_wrapped_key).not.toBe(vault.key);
    expect(acceptGrant({ vault, myDevice: theirs, wrappedKey: call.p_wrapped_key }).key).toBe(vault.key);
  });

  it("refuses a pending row that isn't accepted, or isn't for this vault", async () => {
    const vault = { id: "vault-1", key: sodium.newVaultKey() };
    const mine = granter();
    const pending = { id: "p", vault_id: "vault-1", status: "pending", matched_device_id: "d", target_public_key: "k" };
    const { client } = fakeSupabase({ pending, device: { id: "d", public_key: "k" } });
    await expect(grantPendingDevice({ accountClient: client, pendingId: "p", vault, device: { id: "device-1", publicKey: mine.publicKey }, sodium })).rejects.toThrow(/hasn't accepted/);

    const other = fakeSupabase({ pending: { ...pending, status: "accepted" }, device: { id: "d", public_key: "k" } });
    await expect(grantPendingDevice({ accountClient: other.client, pendingId: "p", vault: { ...vault, id: "other" }, device: { id: "device-1", publicKey: mine.publicKey }, sodium })).rejects.toThrow(/another vault/);
  });

  it("refuses a key that doesn't match the fingerprint the admin compared", async () => {
    const mine = granter();
    const vault = { id: "vault-1", key: sodium.newVaultKey() };
    // A server that swapped in a key of its own, behind the fingerprint the teammate read out.
    const { written, client } = fakeSupabase({
      pending: { id: "p", vault_id: "vault-1", status: "accepted", matched_device_id: "device-2", target_public_key: sodium.newKeypair().publicKey, target_fingerprint: fingerprint(sodium.newKeypair().publicKey) },
    });
    await expect(grantPendingDevice({ accountClient: client, pendingId: "p", vault, device: { id: "device-1", publicKey: mine.publicKey }, sodium })).rejects.toThrow(/doesn't match its fingerprint/);
    expect(written).toHaveLength(0);
  });
});

describe("openGrant", () => {
  it("opens the grant the granter wrote, with this device's own key", async () => {
    const mine = granter();
    const theirs = newcomer();
    const vault = { id: "vault-1", key: sodium.newVaultKey(), keyVersion: 1 };
    const { wrappedKey } = wrapForDevice({ vault, granterDevice: mine, newDevice: { publicKey: theirs.publicKey } });
    const { client } = fakeSupabase({ grant: { key_version: 1, wrapped_key: wrappedKey } });

    const opened = await openGrant({ accountClient: client, vaultId: "vault-1", myDevice: { id: "device-2", publicKey: theirs.publicKey, privateKey: theirs.privateKey }, sodium });
    expect(opened.key).toBe(vault.key);
    expect(opened.keyVersion).toBe(1);
  });

  it("says so when the device has no grant yet", async () => {
    const theirs = newcomer();
    const { client } = fakeSupabase({ grant: null });
    await expect(openGrant({ accountClient: client, vaultId: "vault-1", myDevice: { id: "device-2", publicKey: theirs.publicKey, privateKey: theirs.privateKey }, sodium })).rejects.toThrow(/no grant/);
    await expect(openGrant({ accountClient: client, vaultId: "vault-1", myDevice: { publicKey: theirs.publicKey }, sodium })).rejects.toThrow(/registered/);
  });
});
