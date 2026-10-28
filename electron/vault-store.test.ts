import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDeviceKey, registerDevice } from "./device-key.cjs";
import * as sodium from "./vault-crypto.cjs";
import { createVaultStore, tailOf } from "./vault-store.cjs";

// safeStorage stand-in: reversible, but not the identity, so a test can tell the key was wrapped.
const safeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(`wrapped:${text}`),
  decryptString: (buf: Buffer) => buf.toString().replace(/^wrapped:/, ""),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-vault-"));

beforeAll(() => sodium.ready());

describe("vault crypto", () => {
  it("refuses to run before ready()", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = await import("./vault-crypto.cjs");
    expect(() => fresh.newVaultKey()).toThrow(/ready/);
    await fresh.ready();
    await fresh.ready();
    expect(fresh.newVaultKey()).toHaveLength(44);
  });

  it("seals a vault key to a device and binds values to their name and environment", () => {
    const device = sodium.newKeypair();
    const key = sodium.newVaultKey();
    expect(sodium.unwrapKey(sodium.wrapKey(key, device.publicKey), device)).toBe(key);
    expect(() => sodium.unwrapKey(sodium.wrapKey(key, device.publicKey), sodium.newKeypair())).toThrow();

    const box = sodium.encrypt("s3cret-value", key, sodium.aad("github:a/b", "API_KEY", "development", 1));
    expect(sodium.decrypt(box, key, sodium.aad("github:a/b", "API_KEY", "development", 1))).toBe("s3cret-value");
    expect(() => sodium.decrypt(box, key, sodium.aad("github:a/b", "API_KEY", "production", 1))).toThrow();
    expect(() => sodium.decrypt(box, key, sodium.aad("github:a/b", "OTHER", "development", 1))).toThrow();
  });
});

describe("loadDeviceKey", () => {
  it("makes a keypair once, keeps the private half wrapped, and loads it again", () => {
    const dir = tmp();
    const first = loadDeviceKey({ dir: path.join(dir, "sub"), safeStorage: safeStorage(), crypto: sodium });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "sub", "device-key.json"), "utf8")) as { privateKey: string };
    expect(saved.privateKey).not.toBe(first.privateKey);
    expect(fs.statSync(path.join(dir, "sub", "device-key.json")).mode & 0o777).toBe(0o600);
    expect(loadDeviceKey({ dir: path.join(dir, "sub"), safeStorage: safeStorage(), crypto: sodium })).toEqual(first);
  });

  it("refuses without the Keychain", () => {
    expect(() => loadDeviceKey({ dir: tmp(), safeStorage: safeStorage(false), crypto: sodium })).toThrow(/Keychain/);
  });
});

// A supabase-js stand-in: it records what was upserted, so a test can see the row Weft would send.
// Every other table method is recorded too, and fails the test if it is called: the registration
// must be a single upsert, not a select-then-write. That fallback existed because the index behind
// (user_id, public_key) was partial, and a partial index is not a valid ON CONFLICT inference
// target (Postgres 42P10). The index is now non-partial with NULLS NOT DISTINCT
// (supabase/migrations/20261027165308_devices_upsert_unique_index.sql), so the upsert stands alone.
const fakeSupabase = () => {
  const upserted: { row: Record<string, unknown>; options: Record<string, unknown> | undefined }[] = [];
  const otherCalls: string[] = [];
  const table = {
    upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => {
      upserted.push({ row, options });
      return Promise.resolve({ data: [{ id: "device-1" }], error: null });
    },
    // Any other read or write is the fallback creeping back in, so it is recorded and refused.
    select: () => {
      otherCalls.push("select");
      return Promise.resolve({ data: null, error: null });
    },
    insert: () => {
      otherCalls.push("insert");
      return Promise.resolve({ data: null, error: null });
    },
    update: () => {
      otherCalls.push("update");
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { upserted, otherCalls, client: { supabase: { from: () => table } } };
};

describe("registerDevice", () => {
  it("upserts the public half and the fingerprint, as the signed-in user", async () => {
    const dir = tmp();
    const { upserted, otherCalls, client } = fakeSupabase();
    const accountClient = { ...client, getClaims: () => ({ sub: "user-1" }) };

    const result = await registerDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium, name: "Studio Mac", platform: "darwin" });

    expect(upserted).toHaveLength(1);
    const { row, options } = upserted[0]!;
    expect(options).toEqual({ onConflict: "user_id,public_key" });
    // The registration is the upsert and nothing else.
    expect(otherCalls).toEqual([]);
    expect(row.user_id).toBe("user-1");
    expect(row.name).toBe("Studio Mac");
    expect(row.platform).toBe("darwin");
    expect(row.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    // The public key is the device's own; the fingerprint is the hash of it.
    const device = loadDeviceKey({ dir, safeStorage: safeStorage(), crypto: sodium });
    expect(row.public_key).toBe(device.publicKey);
    expect(result.fingerprint).toBe(row.fingerprint);
    expect(result.publicKey).toBe(device.publicKey);
  });

  it("never sends the private half", async () => {
    const dir = tmp();
    const { upserted, client } = fakeSupabase();
    const accountClient = { ...client, getClaims: () => ({ sub: "user-1" }) };

    await registerDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium, name: "Studio Mac" });

    const device = loadDeviceKey({ dir, safeStorage: safeStorage(), crypto: sodium });
    expect(JSON.stringify(upserted)).not.toContain(device.privateKey);
    expect(JSON.stringify(upserted)).not.toContain("private");
  });

  it("saves the name next to the keypair, and sends it again next time", async () => {
    const dir = tmp();
    const { upserted, client } = fakeSupabase();
    const accountClient = { ...client, getClaims: () => ({ sub: "user-1" }) };

    await registerDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium, name: "Studio Mac" });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "device-key.json"), "utf8")) as { name: string; privateKey: string };
    expect(saved.name).toBe("Studio Mac");
    // The file stays 0600, and the private half is still sealed in it.
    expect(fs.statSync(path.join(dir, "device-key.json")).mode & 0o777).toBe(0o600);

    // A later registration with no name keeps the one the user picked.
    await registerDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium });
    expect(upserted[1]!.row.name).toBe("Studio Mac");
  });

  it("refuses to register without a signed-in user", async () => {
    const dir = tmp();
    const { upserted, client } = fakeSupabase();
    await expect(registerDevice({ accountClient: { ...client, getClaims: () => null }, dir, safeStorage: safeStorage(), crypto: sodium })).rejects.toThrow(/Sign in/);
    expect(upserted).toHaveLength(0);
  });

  it("registers with one upsert, never a select-then-write", async () => {
    // The regression this pins: the registration used to fall back to reading the row and then
    // updating or inserting it, because the unique index behind (user_id, public_key) was partial
    // (`where user_id is not null`) and Postgres refuses a partial index as an ON CONFLICT target
    // with 42P10. The index is now non-partial and NULLS NOT DISTINCT
    // (supabase/migrations/20261027165308_devices_upsert_unique_index.sql), so the upsert is the
    // whole path — one round trip. If the fallback ever comes back, this fails.
    const dir = tmp();
    const { upserted, otherCalls, client } = fakeSupabase();
    const accountClient = { ...client, getClaims: () => ({ sub: "user-1" }) };

    await registerDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium, name: "Studio Mac" });

    expect(upserted).toHaveLength(1);
    // The conflict target the design names, and the index that makes it legal.
    expect(upserted[0]!.options).toEqual({ onConflict: "user_id,public_key" });
    // No read, no separate insert, no update: the upsert is the only write.
    expect(otherCalls).toEqual([]);
  });

  it("fails loudly when the upsert is refused, rather than writing the row another way", async () => {
    // With the fallback gone, a refused upsert is an error the user sees. It must not silently
    // degrade into a select-then-write.
    const dir = tmp();
    const { otherCalls, client } = fakeSupabase();
    const table = {
      upsert: () => Promise.resolve({ data: null, error: { message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" } }),
      select: () => {
        otherCalls.push("select");
        return Promise.resolve({ data: null, error: null });
      },
    };
    const accountClient = { ...client, supabase: { from: () => table }, getClaims: () => ({ sub: "user-1" }) };

    await expect(registerDevice({ accountClient, dir, safeStorage: safeStorage(), crypto: sodium })).rejects.toThrow(/could not be registered/);
    expect(otherCalls).toEqual([]);
  });
});

describe("createVaultStore", () => {
  const make = (dir = tmp(), device = sodium.newKeypair()) => ({ dir, device, store: createVaultStore({ dir, device, sodium, now: () => 0 }) });

  it("shows tails only for long values", () => {
    expect(tailOf("short")).toBe("");
    expect(tailOf("abcdefghijkl")).toBe("ijkl");
  });

  it("writes ciphertext only and lists names with masked tails", () => {
    const { dir, store } = make();
    expect(store.exists("v")).toBe(false);
    expect(store.list("v")).toEqual([]);
    expect(store.get("v", "A", "development")).toBeUndefined();
    void store.set("v", "a/b", [
      { name: "API_KEY", environment: "development", value: "sk_test_0123456789", source: ".env.local" }, // gitleaks:allow
      { name: "TODO", environment: "development", value: null, source: ".env.example" },
    ]);
    expect(store.exists("v")).toBe(true);
    const [file] = fs.readdirSync(dir) as [string];
    expect(fs.readFileSync(path.join(dir, file), "utf8")).not.toContain("sk_test_0123456789"); // gitleaks:allow
    expect(store.list("v")).toEqual([
      { name: "API_KEY", environment: "development", missing: false, tail: "6789", updatedAt: "1970-01-01T00:00:00.000Z", source: ".env.local" },
      { name: "TODO", environment: "development", missing: true, tail: "", updatedAt: "1970-01-01T00:00:00.000Z", source: ".env.example" },
    ]);
    expect(store.get("v", "API_KEY", "development")).toBe("sk_test_0123456789"); // gitleaks:allow
    expect(store.get("v", "TODO", "development")).toBeUndefined();
  });

  it("updates in place, never blanks a value with a missing marker, and fills a missing one", () => {
    const { store } = make();
    void store.set("v", "v", [{ name: "A", environment: "production", value: "one" }]);
    void store.set("v", "v", [
      { name: "A", environment: "production", value: null },
      { name: "M", environment: "production", value: null },
    ]);
    expect(store.get("v", "A", "production")).toBe("one");
    void store.set("v", "v", [
      { name: "A", environment: "production", value: "two" },
      { name: "M", environment: "production", value: "filled" },
    ]);
    expect(store.list("v").map((s: { name: string; missing: boolean }) => [s.name, s.missing])).toEqual([
      ["A", false],
      ["M", false],
    ]);
    expect(store.get("v", "A", "production")).toBe("two");
    expect(() => store.set("v", "v", [{ name: "A", environment: "staging", value: "x" }])).toThrow(/staging/);
  });

  it("removes entries", () => {
    const { store } = make();
    expect(store.remove("v", "A", "development")).toBe(false);
    void store.set("v", "v", [{ name: "A", environment: "development", value: "x" }]);
    expect(store.remove("v", "B", "development")).toBe(false);
    expect(store.remove("v", "A", "development")).toBe(true);
    expect(store.list("v")).toEqual([]);
  });

  it("opens a vault again from disk with the device key, and refuses another device", () => {
    const { dir, device, store } = make();
    void store.set("v", "v", [{ name: "A", environment: "development", value: "kept" }]);
    expect(make(dir, device).store.get("v", "A", "development")).toBe("kept");
    expect(() => make(dir).store.get("v", "A", "development")).toThrow(/no key/);
  });

  it("keeps a local vault's set unchanged: it answers nothing and can never conflict", () => {
    const { store } = make();
    // A local vault has no row_version, so there is nothing to mismatch against: the set answers
    // nothing, as it always has (docs/architecture/teams-vault.md, "Push on change").
    expect(store.set("v", "a/b", [{ name: "API_KEY", environment: "development", value: "mine" }])).toBeUndefined();
    expect(store.get("v", "API_KEY", "development")).toBe("mine");
  });
});

// A shared vault's set, through a fake sync engine (docs/architecture/teams-vault.md, "Push on
// change"): a write that lost the row's optimistic-concurrency check answers { conflict: true,
// current } — the server's row — instead of throwing, so the drawer can offer the two ways out.
describe("a shared vault's set", () => {
  // A sync engine whose push answers whatever the test says: a row, a conflict, or a queue. The
  // vault key it hands out is the one the server's row is encrypted with, so the shadow can read it.
  const fakeSync = (push: (op: { op: string; name: string; environment: string }) => unknown) => {
    const key = sodium.newVaultKey();
    const device = sodium.newKeypair();
    const grants = [{ device: { public_key: device.publicKey }, key_version: 1, wrapped_key: sodium.wrapKey(key, device.publicKey) }];
    return {
      key,
      device,
      // The server's row: another device's write, with the row_version it now holds.
      row: (name: string, environment: string, value: string, rowVersion = 4) => ({
        name,
        environment,
        ...sodium.encrypt(value, key, sodium.aad("github:a/b", name, environment, 1)),
        key_version: 1,
        row_version: rowVersion,
        is_blank: false,
        updated_at: "2026-10-27T00:00:00.000Z",
      }),
      sync: {
        useDevice: () => undefined,
        shared: () => ({ orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 }),
        pull: () => Promise.resolve({ keyVersion: 1, grants, rows: [], removed: [] }),
        push: (_id: string, op: { op: string; name: string; environment: string }) => Promise.resolve(push(op)),
        queued: () => 0,
        subscribe: () => undefined,
        drain: () => Promise.resolve({ remaining: 0 }),
      },
    };
  };

  it("answers a row_version mismatch with the server's row, never a throw", async () => {
    const fake = fakeSync(() => ({ conflict: true, current: fake.row("API_KEY", "development", "sams-value") }));
    const store = createVaultStore({ dir: tmp(), device: fake.device, sodium, now: () => 0, sync: fake.sync });

    const result = (await store.set("github:a/b", "a/b", [{ name: "API_KEY", environment: "development", value: "mine" }])) as {
      conflicts: { name: string; environment: string; current: { row_version: number } | null }[];
      queued: number;
    };

    expect(result.queued).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ name: "API_KEY", environment: "development" });
    // The server's row comes with it: the row_version a re-push expects, and the row itself.
    expect(result.conflicts[0]!.current).toMatchObject({ row_version: 4 });
  });

  it("takes the server's row as the shadow, so the local edit is rolled back", async () => {
    const fake = fakeSync(() => ({ conflict: true, current: fake.row("API_KEY", "development", "sams-value") }));
    const store = createVaultStore({ dir: tmp(), device: fake.device, sodium, now: () => 0, sync: fake.sync });
    await store.set("github:a/b", "a/b", [{ name: "API_KEY", environment: "development", value: "mine" }]);

    // The shadow holds the server's row, not the value that lost.
    expect(store.get("github:a/b", "API_KEY", "development")).toBe("sams-value");
  });
});
