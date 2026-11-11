import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDeviceKey, registeredDevice } from "./device-key.cjs";
import * as sodium from "./vault-crypto.cjs";

// safeStorage stand-in: reversible, but not the identity, so a test can tell the key was wrapped.
const safeStorage = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`wrapped:${text}`),
  decryptString: (buf: Buffer) => buf.toString().replace(/^wrapped:/, ""),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-device-"));

beforeAll(() => sodium.ready());

describe("registeredDevice", () => {
  // A devices table you can look a row up in, by every filter the lookup sets.
  const devicesTable = (rows: Record<string, unknown>[], sub: unknown = "user-1") => {
    const looks: Record<string, unknown>[] = [];
    const lookup = (filters: Record<string, unknown>) => ({
      eq: (column: string, value: unknown) => lookup({ ...filters, [column]: value }),
      maybeSingle: () => {
        looks.push(filters);
        return Promise.resolve({ data: rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null });
      },
    });
    const table = {
      select: () => lookup({}),
      upsert: (row: Record<string, unknown>) => {
        rows.push({ ...row, id: "device-new" });
        return Promise.resolve({ data: null, error: null });
      },
      // The bump after the insert-or-skip: name and last_seen_at, on this user's row for the key.
      update: () => {
        const done = Object.assign(Promise.resolve({ data: null, error: null }), { eq: () => done });
        return done;
      },
    };
    return { looks, accountClient: { getClaims: () => ({ sub }), supabase: { from: () => table } } };
  };

  it("finds this Mac's row and keeps the keypair with its id", async () => {
    const dir = tmp();
    const pair = loadDeviceKey({ dir, safeStorage: safeStorage(), crypto: sodium });
    const { accountClient } = devicesTable([{ id: "device-1", user_id: "user-1", public_key: pair.publicKey }]);
    const device = await registeredDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium });
    expect(device).toEqual({ id: "device-1", publicKey: pair.publicKey, privateKey: pair.privateKey });
  });

  it("refuses a revoked row with what to do, instead of a revoked id the server would turn down", async () => {
    const dir = tmp();
    const { publicKey } = loadDeviceKey({ dir, safeStorage: safeStorage(), crypto: sodium });
    const { accountClient } = devicesTable([{ id: "gone", user_id: "user-1", public_key: publicKey, revoked_at: "2026-11-05T00:00:00Z" }]);
    await expect(registeredDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium })).rejects.toThrow("This Mac was removed from your account. Re-add it");
  });

  it("takes this account's row when two accounts share the Mac", async () => {
    const dir = tmp();
    const { publicKey } = loadDeviceKey({ dir, safeStorage: safeStorage(), crypto: sodium });
    const { accountClient } = devicesTable([
      { id: "theirs", user_id: "user-2", public_key: publicKey },
      { id: "mine", user_id: "user-1", public_key: publicKey },
    ]);
    expect((await registeredDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium })).id).toBe("mine");
  });

  it("registers the Mac the first time, then reads the id back", async () => {
    const dir = tmp();
    const { accountClient, looks } = devicesTable([]);
    expect((await registeredDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium })).id).toBe("device-new");
    expect(looks).toHaveLength(2);
  });

  it("says so when the row still can't be read", async () => {
    const dir = tmp();
    const { accountClient } = devicesTable([]);
    accountClient.supabase.from().upsert = () => Promise.resolve({ data: null, error: null });
    await expect(registeredDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium })).rejects.toThrow("isn't registered");
  });

  it("asks a signed-out user to sign in", async () => {
    const dir = tmp();
    const { accountClient } = devicesTable([], null);
    await expect(registeredDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium })).rejects.toThrow("Sign in");
  });
});
