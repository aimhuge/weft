import { beforeAll, describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVaultStore } from "./vault-store.cjs";
import { createVaultSync } from "./vault-sync.cjs";
import { fakeDb, tmp } from "./vault-sync.harness";

const ID = "github:a/b";

beforeAll(() => sodium.ready());

// A local vault with one value, then shared: the server knows the vault and this device's grant.
async function setup() {
  const dir = tmp();
  const device = sodium.newKeypair();
  const db = fakeDb();
  const onRemote = vi.fn();
  const sync = createVaultSync({ accountClient: { supabase: db.client, getClaims: () => ({ sub: "u1" }) }, dir, now: () => 0 });
  const store = createVaultStore({ dir, device, sodium, now: () => 0, sync, onRemote });
  await store.set(ID, "a/b", [{ name: "OLD", environment: "development", value: "local-only" }]);
  const file = JSON.parse((await import("node:fs")).readFileSync(`${dir}/${(await import("./vault-sync-files.cjs")).hashOf(ID)}.json`, "utf8")) as { grants: { wrapped: string }[] };
  const key = sodium.unwrapKey(file.grants[0]!.wrapped, device);
  db.tables.vaults.push({ id: "v1", org_id: "o1", server_version: 1, current_key_version: 1 });
  db.tables.devices.push({ id: "d1", public_key: device.publicKey, revoked_at: null });
  db.tables.vault_grants.push({ vault_id: "v1", device_id: "d1", key_version: 1, wrapped_key: file.grants[0]!.wrapped });
  sync.markShared(ID, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });
  // A teammate's value: the same key, bound to the same vault, name and environment.
  const seal = (value: string, name: string, environment = "development", version = 1) => {
    const b = sodium.encrypt(value, key, sodium.aad(ID, name, environment, version));
    return { vault_id: "v1", name, environment, ciphertext: b.ciphertext, nonce: b.nonce, key_version: version };
  };
  return { dir, db, sync, store, seal, key, device, onRemote };
}

describe("a shared vault's store", () => {
  it("pushes a value to the server and keeps the server's row as the shadow", async () => {
    const { db, store } = await setup();
    expect(store.isShared(ID)).toBe(true);
    expect(await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "s3cret-value-1234", source: ".env.local" }])).toEqual({ conflicts: [], queued: 0 });
    expect(store.get(ID, "API_KEY", "development")).toBe("s3cret-value-1234");
    expect(store.list(ID).find((s) => s.name === "API_KEY")).toMatchObject({ source: ".env.local", tail: "1234" });
    expect(JSON.stringify(db.tables)).not.toContain("s3cret");
    await expect(store.set(ID, "a/b", [{ name: "X", environment: "staging", value: "v" }])).rejects.toThrow(/Unknown environment/);
  });

  it("keeps a blank from replacing a value, and pushes a blank's new hint", async () => {
    const { db, store } = await setup();
    await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "v" }]);
    await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: null, hint: "ignored" }]);
    expect(store.get(ID, "API_KEY", "development")).toBe("v");
    await store.set(ID, "a/b", [{ name: "TOKEN", environment: "preview", value: null }]);
    await store.set(ID, "a/b", [{ name: "TOKEN", environment: "preview", value: null }]);
    await store.set(ID, "a/b", [{ name: "TOKEN", environment: "preview", value: null, hint: "Stripe" }]);
    expect(db.tables.vault_secrets.find((r) => r.name === "TOKEN")).toMatchObject({ is_blank: true, hint: "Stripe", row_version: 1 });
    expect(store.list(ID).find((s) => s.name === "TOKEN")).toMatchObject({ missing: true, hint: "Stripe" });
  });

  it("rolls back to the server's row on a conflict, and says which row it lost against", async () => {
    const { db, store, seal } = await setup();
    db.teammate.insert(seal("sams-value", "API_KEY"));
    const lost = (await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "mine" }])) as { conflicts: { name: string; environment: string; current: { name: string; row_version: number } | null }[]; queued: number };
    // The conflict names the row and carries the server's row, so the drawer can offer the two ways
    // out without asking the server twice (docs/architecture/teams-vault.md, "Push on change").
    expect(lost.queued).toBe(0);
    expect(lost.conflicts).toHaveLength(1);
    expect(lost.conflicts[0]).toMatchObject({ name: "API_KEY", environment: "development" });
    expect(lost.conflicts[0]!.current).toMatchObject({ name: "API_KEY", environment: "development" });
    expect(store.get(ID, "API_KEY", "development")).toBe("sams-value");
    await store.set(ID, "a/b", [{ name: "GONE", environment: "development", value: "1" }]);
    await store.pull(ID);
    db.teammate.remove("GONE", "development");
    db.teammate.insert(seal("x", "OTHER"));
    // The server no longer has GONE: the shadow drops it.
    const again = (await store.set(ID, "a/b", [{ name: "GONE", environment: "development", value: "2" }])) as { conflicts: unknown[] };
    expect(again.conflicts).toHaveLength(1);
    expect(store.has(ID, "GONE", "development")).toBe(false);
  });

  it("keeps an offline write in the shadow and in the queue until it drains", async () => {
    const { db, store } = await setup();
    db.net.offline = true;
    expect(await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "offline" }])).toEqual({ conflicts: [], queued: 1 });
    expect(store.get(ID, "API_KEY", "development")).toBe("offline");
    expect(store.queued(ID)).toBe(1);
    expect(await store.pull(ID)).toEqual({ offline: true, queued: 1 });
    db.net.offline = false;
    expect(await store.pull(ID)).toMatchObject({ queued: 0 });
    expect(db.tables.vault_secrets).toHaveLength(1);
  });

  it("says which queued write conflicts when a pull drains", async () => {
    const { db, store, seal } = await setup();
    await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "1" }]);
    db.net.offline = true;
    await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "2" }]);
    db.net.offline = false;
    db.teammate.update("API_KEY", "development", seal("sams", "API_KEY"));
    expect(await store.pull(ID)).toMatchObject({ queued: 1, conflict: { name: "API_KEY", environment: "development" } });
    expect(store.get(ID, "API_KEY", "development")).toBe("2");
  });

  it("pulls a teammate's changes in, live through Realtime", async () => {
    const { db, store, seal, onRemote } = await setup();
    await store.set(ID, "a/b", [{ name: "B", environment: "development", value: "b" }]);
    db.teammate.insert(seal("from-sam", "SAM"));
    db.teammate.insert({ vault_id: "v1", name: "BLANK", environment: "preview", is_blank: true, key_version: 1, hint: "ask Sam" });
    db.teammate.insert({ vault_id: "v1", name: "BARE", environment: "preview", is_blank: true, key_version: 1, hint: null });
    expect(await store.pull(ID)).toMatchObject({ changed: 3, removed: 0 });
    expect(store.get(ID, "SAM", "development")).toBe("from-sam");
    expect(store.list(ID).find((s) => s.name === "BLANK")).toMatchObject({ missing: true, hint: "ask Sam" });
    expect(store.list(ID).find((s) => s.name === "BARE")?.hint).toBeUndefined();

    db.teammate.remove("B", "development");
    db.channels[0]!.handlers[0]!.cb({ eventType: "DELETE", new: {}, old: { vault_id: "v1" } });
    await vi.waitFor(() => expect(onRemote).toHaveBeenCalledWith(ID));
    expect(store.has(ID, "B", "development")).toBe(false);
    expect(db.channels).toHaveLength(1);
  });

  it("removes through the server, and keeps a name a teammate changed", async () => {
    const { db, store, seal } = await setup();
    expect(await store.remove(ID, "NOPE", "development")).toBe(false);
    await store.set(ID, "a/b", [{ name: "API_KEY", environment: "development", value: "1" }]);
    expect(await store.remove(ID, "API_KEY", "development")).toBe(true);
    expect(store.has(ID, "API_KEY", "development")).toBe(false);
    await store.set(ID, "a/b", [{ name: "B", environment: "development", value: "1" }]);
    db.teammate.update("B", "development", seal("sams", "B"));
    expect(await store.remove(ID, "B", "development")).toBe(false);
    expect(store.get(ID, "B", "development")).toBe("sams");
  });

  it("fills a new device's shadow from the server, and takes up a rotated key it has a grant for", async () => {
    const { db, sync, seal, key } = await setup();
    db.teammate.insert(seal("shared-value", "API_KEY"));
    const device = sodium.newKeypair();
    db.tables.devices.push({ id: "d2", public_key: device.publicKey, revoked_at: null });
    db.tables.vault_grants.push({ vault_id: "v1", device_id: "d2", key_version: 1, wrapped_key: sodium.wrapKey(key, device.publicKey) });
    const dir = tmp();
    const sync2 = createVaultSync({ accountClient: { supabase: db.client }, dir });
    sync2.markShared(ID, sync.shared(ID)!);
    const store = createVaultStore({ dir, device, sodium, sync: sync2 });
    expect(await store.set(ID, "a/b", [{ name: "NEW", environment: "development", value: "n" }])).toEqual({ conflicts: [], queued: 0 });
    expect(store.get(ID, "API_KEY", "development")).toBe("shared-value");

    const key2 = sodium.newVaultKey();
    db.tables.vaults[0]!.current_key_version = 2;
    db.tables.vault_grants.push({ vault_id: "v1", device_id: "d2", key_version: 2, wrapped_key: sodium.wrapKey(key2, device.publicKey) });
    const b = sodium.encrypt("rotated", key2, sodium.aad(ID, "API_KEY", "development", 2));
    db.teammate.update("API_KEY", "development", { ...b, key_version: 2 });
    await store.pull(ID);
    expect(store.get(ID, "API_KEY", "development")).toBe("rotated");
    // A key version this device has no grant for stays unused.
    db.tables.vaults[0]!.current_key_version = 3;
    db.tables.vault_grants.push({ vault_id: "v1", device_id: "other", key_version: 3, wrapped_key: "x" });
    await store.pull(ID);
    expect(store.get(ID, "API_KEY", "development")).toBe("rotated");
  });

  it("refuses a write on a device the server never granted", async () => {
    const { db, sync } = await setup();
    const dir = tmp();
    const sync2 = createVaultSync({ accountClient: { supabase: db.client }, dir });
    sync2.markShared(ID, sync.shared(ID)!);
    const store = createVaultStore({ dir, device: sodium.newKeypair(), sodium, sync: sync2 });
    await expect(store.set(ID, "a/b", [{ name: "A", environment: "development", value: "v" }])).rejects.toThrow(/no key/);
    db.net.offline = true;
    const offline = createVaultStore({ dir: tmp(), device: sodium.newKeypair(), sodium, sync: createVaultSync({ accountClient: { supabase: db.client }, dir: tmp() }) });
    expect(offline.isShared(ID)).toBe(false);
    expect(await offline.pull(ID)).toBeNull();
    expect(offline.queued(ID)).toBe(0);
  });

  it("leaves a personal vault on the local file", async () => {
    const store = createVaultStore({ dir: tmp(), device: sodium.newKeypair(), sodium });
    expect(store.isShared(ID)).toBe(false);
    expect(await store.pull(ID)).toBeNull();
    expect(store.queued(ID)).toBe(0);
  });
});
