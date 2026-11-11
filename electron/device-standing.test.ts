import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { loadDeviceKey } from "./device-key.cjs";
import { createStanding, readdDevice, resealVaults, RETRY_MS } from "./device-standing.cjs";

// This Mac's standing with the account and Re-add (docs/architecture/device-registry.md, "Re-adding a Mac").
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};
const keychain = () => ({ safeStorage, crypto: sodium });

type Row = { id: string; user_id: string; public_key: string; revoked_at: string | null; name?: string };

// An in-memory devices table behind the supabase-js calls registerDevice and the standing make.
type Fake = { rows?: Row[]; sub?: string | null; readError?: string | null; insertError?: string | null };
function fakeAccount({ rows = [], sub = "user-1", readError = null, insertError = null }: Fake = {}) {
  const table = [...rows];
  const from = () => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const match = () => table.filter((r) => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
    const query = {
      select: () => query,
      eq: (k: string, v: unknown) => ((filters[k] = v), query),
      maybeSingle: () => Promise.resolve(readError ? { data: null, error: { message: readError } } : { data: match()[0] ?? null, error: null }),
      upsert: (row: Row) => {
        if (insertError) return Promise.resolve({ data: null, error: { message: insertError } });
        const found = table.find((r) => r.user_id === row.user_id && r.public_key === row.public_key);
        if (found) return Promise.resolve({ data: [], error: null });
        const added = { ...row, id: `dev-${table.length + 1}`, revoked_at: null };
        table.push(added);
        return Promise.resolve({ data: [added], error: null });
      },
      update: (p: Record<string, unknown>) => ((patch = p), query),
      then: (done: (r: { error: null }) => unknown) => {
        match().forEach((r) => Object.assign(r, patch));
        return done({ error: null });
      },
    };
    return query;
  };
  return { table, accountClient: { signedIn: () => sub !== null, getClaims: () => (sub ? { sub } : null), supabase: { from } } };
}

type Grant = { device: string; keyVersion: number; wrapped: string };
const grantsIn = (file: string) => (JSON.parse(fs.readFileSync(file, "utf8")) as { grants: Grant[] }).grants;
const keyFileIn = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as { publicKey: string };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-standing-"));

// A data dir with a device key and one local vault sealed to it.
async function withVault() {
  await sodium.ready();
  const dir = tmp();
  const device = loadDeviceKey({ dir, safeStorage, crypto: sodium });
  const vaultKey = sodium.newVaultKey();
  fs.mkdirSync(path.join(dir, "vault"));
  const file = path.join(dir, "vault", "0123456789abcdef.json");
  fs.writeFileSync(file, JSON.stringify({ id: "github:o/r", label: "r", keyVersion: 1, grants: [{ device: device.publicKey, keyVersion: 1, wrapped: sodium.wrapKey(vaultKey, device.publicKey) }], secrets: [] }));
  return { dir, device, vaultKey, file };
}

describe("createStanding", () => {
  it("says signed out without touching the key or the server", async () => {
    const dir = tmp();
    expect(await createStanding({ accountClient: fakeAccount({ sub: null }).accountClient, dir, keychain })()).toEqual({ state: "signed-out" });
    expect(await createStanding({ accountClient: null, dir, keychain })()).toEqual({ state: "signed-out" });
    expect(fs.existsSync(path.join(dir, "device-key.json"))).toBe(false);
  });

  it("registers a signed-in Mac that has no row (m1mini's case)", async () => {
    const { table, accountClient } = fakeAccount();
    const dir = tmp();
    expect(await createStanding({ accountClient, dir, keychain })()).toEqual({ state: "registered" });
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ user_id: "user-1", revoked_at: null });
  });

  it("says a revoked row is revoked, and registers nothing (m5air's case)", async () => {
    const { dir, device } = await withVault();
    const { table, accountClient } = fakeAccount({ rows: [{ id: "d1", user_id: "user-1", public_key: device.publicKey, revoked_at: "2026-11-05T00:00:00Z" }] });
    expect(await createStanding({ accountClient, dir, keychain })()).toEqual({ state: "revoked", revokedAt: "2026-11-05T00:00:00Z" });
    expect(table).toHaveLength(1);
  });

  it("says why registering failed, and waits before trying again", async () => {
    let now = 0;
    const { accountClient } = fakeAccount({ insertError: "permission denied for table devices" });
    const standing = createStanding({ accountClient, dir: tmp(), keychain, now: () => now });
    const failed = { state: "unregistered", error: "This device could not be registered: permission denied for table devices" };
    expect(await standing()).toEqual(failed);
    expect(await standing()).toEqual(failed);
    now = RETRY_MS;
    expect(await standing()).toEqual(failed);
  });

  it("says nothing it can't know when the read fails", async () => {
    const { dir } = await withVault();
    expect(await createStanding({ accountClient: fakeAccount({ readError: "offline" }).accountClient, dir, keychain })()).toEqual({ state: "unknown" });
  });
});

describe("resealVaults", () => {
  it("seals each vault's key to the new key too, once", async () => {
    const { dir, device, vaultKey, file } = await withVault();
    const fresh = sodium.newKeypair();
    const vaultDir = path.join(dir, "vault");
    fs.writeFileSync(path.join(vaultDir, "notes.json"), "not json");
    expect(resealVaults({ vaultDir, from: device, to: fresh, sodium })).toBe(1);
    expect(resealVaults({ vaultDir, from: device, to: fresh, sodium })).toBe(0);
    const grants = grantsIn(file);
    expect(grants).toHaveLength(2);
    expect(sodium.unwrapKey(grants[1]!.wrapped, fresh)).toBe(vaultKey);
    expect(resealVaults({ vaultDir: path.join(dir, "none"), from: device, to: fresh, sodium })).toBe(0);
  });
});

describe("readdDevice", () => {
  it("gives a removed Mac a new key and row, and keeps its vaults open", async () => {
    const { dir, device, vaultKey, file } = await withVault();
    const { table, accountClient } = fakeAccount({ rows: [{ id: "d1", user_id: "user-1", public_key: device.publicKey, revoked_at: "2026-11-05T00:00:00Z" }] });
    const result = await readdDevice({ accountClient, dir, safeStorage, sodium, now: () => 42 });
    const fresh = loadDeviceKey({ dir, safeStorage, crypto: sodium });
    expect(fresh.publicKey).not.toBe(device.publicKey);
    expect(result).toMatchObject({ publicKey: fresh.publicKey, resealed: 1 });
    // The old row stays revoked; the new key is a row of its own.
    expect(table.map((r) => [r.public_key, r.revoked_at])).toEqual([[device.publicKey, "2026-11-05T00:00:00Z"], [fresh.publicKey, null]]);
    const grant = grantsIn(file).find((g) => g.device === fresh.publicKey);
    expect(sodium.unwrapKey(grant!.wrapped, fresh)).toBe(vaultKey);
    expect(keyFileIn(path.join(dir, "device-key.revoked-42.json")).publicKey).toBe(device.publicKey);
    expect(fs.existsSync(path.join(dir, "device-key.next.json"))).toBe(false);
  });

  it("never replaces a live key", async () => {
    const { dir, device } = await withVault();
    const { accountClient } = fakeAccount({ rows: [{ id: "d1", user_id: "user-1", public_key: device.publicKey, revoked_at: null }] });
    await expect(readdDevice({ accountClient, dir, safeStorage, sodium })).rejects.toThrow("already on your account");
    expect(loadDeviceKey({ dir, safeStorage, crypto: sodium }).publicKey).toBe(device.publicKey);
  });

  it("only registers a Mac with no row, keeping its key", async () => {
    const { dir, device } = await withVault();
    const { table, accountClient } = fakeAccount();
    expect(await readdDevice({ accountClient, dir, safeStorage, sodium })).toMatchObject({ publicKey: device.publicKey, resealed: 0 });
    expect(table).toHaveLength(1);
  });

  it("refuses signed out, and says when the standing can't be read", async () => {
    const { dir } = await withVault();
    await expect(readdDevice({ accountClient: fakeAccount({ sub: null }).accountClient, dir, safeStorage, sodium })).rejects.toThrow("Sign in");
    await expect(readdDevice({ accountClient: fakeAccount({ readError: "offline" }).accountClient, dir, safeStorage, sodium })).rejects.toThrow("couldn't be read: offline");
  });
});
