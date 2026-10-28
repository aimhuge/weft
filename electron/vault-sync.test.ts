import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSyncFiles, hashOf } from "./vault-sync-files.cjs";
import { createVaultSync } from "./vault-sync.cjs";
import { fakeDb, tmp } from "./vault-sync.harness";

const ID = "github:a/b";
const box = (n: string) => ({ ciphertext: `ct-${n}`, nonce: `n-${n}`, keyVersion: 1 });

function setup({ register = true } = {}) {
  const dir = tmp();
  const db = fakeDb();
  db.tables.vaults.push({ id: "v1", org_id: "o1", server_version: 1, current_key_version: 1 });
  db.tables.devices.push({ id: "d1", public_key: "PK", revoked_at: null });
  db.tables.vault_grants.push({ vault_id: "v1", device_id: "d1", key_version: 1, wrapped_key: "W" });
  const accountClient = { supabase: db.client, getClaims: () => ({ sub: "u1", email: "me@x.dev" }) };
  const sync = createVaultSync({ accountClient, dir, now: () => 0 });
  sync.markShared(ID, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });
  if (register) sync.useDevice("PK");
  const queueFile = path.join(dir, `${hashOf(ID)}.queue.jsonl`);
  const secret = (name = "API_KEY", environment = "development") => db.tables.vault_secrets.find((r) => r.name === name && r.environment === environment);
  return { dir, db, sync, queueFile, secret };
}

describe("push", () => {
  it("refuses a vault that isn't shared", async () => {
    const { sync } = setup();
    await expect(sync.push("github:x/y", { op: "set", name: "A", environment: "development", ...box("1") })).rejects.toThrow(/isn't shared/);
    await expect(sync.pull("github:x/y")).rejects.toThrow(/isn't shared/);
    expect(sync.shared("github:x/y")).toBeNull();
    expect(sync.queued("github:x/y")).toBe(0);
  });

  it("inserts, then updates against the row version it saw, logging each without a value", async () => {
    const { db, sync, secret } = setup();
    const first = await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1"), source: ".env.local" });
    expect(first).toMatchObject({ row: { name: "API_KEY", ciphertext: "ct-1", row_version: 0, is_blank: false, updated_by: "u1" } });
    const second = await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("2") });
    expect(second).toMatchObject({ row: { ciphertext: "ct-2", row_version: 1 } });
    expect(secret()).not.toHaveProperty("source");
    expect(db.tables.vault_events).toEqual([
      expect.objectContaining({ vault_id: "v1", action: "set", target_name: "API_KEY", target_environment: "development", actor_user_id: "u1", actor_email: "me@x.dev", device_id: "d1", metadata: { row_version: 0 } }),
      expect.objectContaining({ metadata: { row_version: 1 } }),
    ]);
    expect(JSON.stringify(db.tables.vault_events)).not.toMatch(/ct-/);
  });

  it("writes a blank with its hint and no ciphertext", async () => {
    const { db, sync, secret } = setup({ register: false });
    await sync.push(ID, { op: "blank", name: "API_KEY", environment: "development", keyVersion: 1, hint: "Stripe" });
    expect(secret()).toMatchObject({ is_blank: true, ciphertext: null, nonce: null, hint: "Stripe", key_version: 1 });
    await sync.push(ID, { op: "blank", name: "OTHER", environment: "development", keyVersion: 1 });
    expect(secret("OTHER")).toMatchObject({ hint: null });
    expect(db.tables.vault_events[0]).toMatchObject({ action: "add blank", device_id: null });
  });

  it("answers a conflict with the server's row instead of throwing, then writes against it", async () => {
    const { db, sync } = setup();
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") });
    db.teammate.update("API_KEY", "development", { ciphertext: "ct-sam" });
    const result = await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("mine") });
    expect(result).toMatchObject({ conflict: true, current: { ciphertext: "ct-sam", row_version: 1 } });
    expect(Object.keys(result)).toEqual(["conflict", "current"]);
    expect(await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("mine") })).toMatchObject({ row: { ciphertext: "ct-mine", row_version: 2 } });
  });

  it("answers a conflict when someone else made the row first", async () => {
    const { db, sync } = setup();
    db.teammate.insert({ vault_id: "v1", name: "API_KEY", environment: "development", ciphertext: "ct-sam", key_version: 1 });
    expect(await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") })).toMatchObject({ conflict: true, current: { ciphertext: "ct-sam" } });
  });

  it("removes a row, a row only ever local, and one a teammate removed first; a changed row conflicts", async () => {
    const { db, sync, secret } = setup();
    expect(await sync.push(ID, { op: "remove", name: "LOCAL", environment: "development" })).toEqual({ row: null });
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") });
    expect(await sync.push(ID, { op: "remove", name: "API_KEY", environment: "development" })).toEqual({ row: null });
    expect(secret()).toBeUndefined();
    await sync.push(ID, { op: "set", name: "B", environment: "development", ...box("1") });
    db.teammate.remove("B", "development");
    expect(await sync.push(ID, { op: "remove", name: "B", environment: "development" })).toEqual({ row: null });
    await sync.push(ID, { op: "set", name: "C", environment: "development", ...box("1") });
    db.teammate.update("C", "development", { ciphertext: "ct-sam" });
    expect(await sync.push(ID, { op: "remove", name: "C", environment: "development" })).toMatchObject({ conflict: true, current: { ciphertext: "ct-sam" } });
    expect(db.tables.vault_events.map((e) => e.action)).toContain("remove");
  });

  it("throws a refusal that isn't about the network, and keeps a write whose event line failed", async () => {
    const { db, sync, secret } = setup();
    db.net.fail = { table: "vault_events", message: "nope" };
    expect(await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") })).toMatchObject({ row: {} });
    expect(secret()).toBeDefined();
    db.net.fail = { message: "permission denied" };
    await expect(sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("2") })).rejects.toThrow("permission denied");
    db.net.fail = { table: "vault_secrets", message: "bad insert" };
    await expect(sync.push(ID, { op: "set", name: "NEW", environment: "development", ...box("2") })).rejects.toThrow("bad insert");
  });
});

describe("pull", () => {
  it("returns the diff: changed rows, removed names, this device's grants", async () => {
    const { db, sync } = setup();
    db.teammate.insert({ vault_id: "v1", name: "A", environment: "development", ciphertext: "ct-a", key_version: 1 });
    db.teammate.insert({ vault_id: "v1", name: "B", environment: "production", ciphertext: "ct-b", key_version: 1 });
    const first = await sync.pull(ID);
    expect(first).toMatchObject({ serverVersion: 3, keyVersion: 1, removed: [], grants: [{ key_version: 1, wrapped_key: "W", device: { public_key: "PK" } }] });
    expect(first.rows?.map((r) => String(r.name)).sort()).toEqual(["A", "B"]);
    expect(await sync.pull(ID)).toMatchObject({ rows: [], removed: [] });

    db.teammate.update("A", "development", { ciphertext: "ct-a2" });
    db.teammate.remove("B", "production");
    const next = await sync.pull(ID);
    expect(next.rows).toEqual([expect.objectContaining({ name: "A", ciphertext: "ct-a2" })]);
    expect(next.removed).toEqual([{ name: "B", environment: "production" }]);
  });

  it("leaves a name with a queued write alone, and answers offline without throwing", async () => {
    const { db, sync } = setup();
    await sync.push(ID, { op: "set", name: "A", environment: "development", ...box("1") });
    db.net.offline = true;
    expect(await sync.pull(ID)).toEqual({ offline: true });
    await sync.push(ID, { op: "set", name: "A", environment: "development", ...box("2") });
    db.net.offline = false;
    db.teammate.update("A", "development", { ciphertext: "ct-sam" });
    expect((await sync.pull(ID)).rows).toEqual([]);
    db.net.throws = true;
    expect(await sync.pull(ID)).toEqual({ offline: true });
    db.net.throws = false;
    db.net.fail = { message: "denied" };
    await expect(sync.pull(ID)).rejects.toThrow("denied");
  });
});

describe("the offline queue", () => {
  it("queues writes 0600 with ciphertext only, and drains them in order", async () => {
    const { db, sync, queueFile, secret } = setup();
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") });
    db.net.offline = true;
    expect(await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("2"), value: "plain" })).toEqual({ queued: true });
    expect(await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("3") })).toEqual({ queued: true });
    expect(await sync.push(ID, { op: "blank", name: "OTHER", environment: "preview", keyVersion: 1, hint: "h" })).toEqual({ queued: true });
    expect(fs.statSync(queueFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(queueFile, "utf8")).not.toContain("plain");
    const queue = createSyncFiles(path.dirname(queueFile)).queue(ID);
    expect(queue.map((e) => [e.name, e.expectedRowVersion, e.chained ?? false])).toEqual([["API_KEY", 0, false], ["API_KEY", 0, true], ["OTHER", null, false]]);
    expect(queue[0]).toMatchObject({ expectedServerVersion: 0, queuedAt: "1970-01-01T00:00:00.000Z" });
    expect(sync.queued(ID)).toBe(3);

    expect(await sync.drain(ID)).toEqual({ offline: true, drained: 0, remaining: 3 });
    db.net.offline = false;
    expect(await sync.drain(ID)).toEqual({ drained: 3, remaining: 0 });
    expect(secret()).toMatchObject({ ciphertext: "ct-3", row_version: 2 });
    expect(secret("OTHER", "preview")).toMatchObject({ is_blank: true });
    expect(fs.existsSync(queueFile)).toBe(false);
    expect(await sync.drain(ID)).toEqual({ drained: 0, remaining: 0 });
  });

  it("joins a write to a waiting queue and drains it when the network is back", async () => {
    const { db, sync } = setup();
    db.net.throws = true;
    await sync.push(ID, { op: "set", name: "A", environment: "development", ...box("1") });
    expect(await sync.push(ID, { op: "set", name: "B", environment: "development", ...box("1") })).toEqual({ queued: true });
    db.net.throws = false;
    expect(await sync.push(ID, { op: "set", name: "C", environment: "development", ...box("1") })).toEqual({ queued: false, drained: true });
    expect(db.tables.vault_secrets.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });

  it("stops at a conflict with the queue intact until it's resolved", async () => {
    const { db, sync, secret } = setup();
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") });
    db.net.offline = true;
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("mine") });
    await sync.push(ID, { op: "set", name: "B", environment: "development", ...box("b") });
    db.net.offline = false;
    db.teammate.update("API_KEY", "development", { ciphertext: "ct-sam" });
    const stuck = await sync.drain(ID);
    expect(stuck).toMatchObject({ conflict: true, current: { ciphertext: "ct-sam" }, entry: { op: "set", name: "API_KEY", environment: "development" }, drained: 0, remaining: 2 });
    expect(stuck.entry).not.toHaveProperty("ciphertext");
    expect(sync.queued(ID)).toBe(2);
    expect(await sync.drain(ID)).toMatchObject({ conflict: true, remaining: 2 });

    // Keep mine: written over the teammate's version, then the rest drains.
    expect(await sync.resolve(ID, true)).toEqual({ drained: 2, remaining: 0 });
    expect(secret()).toMatchObject({ ciphertext: "ct-mine" });
    expect(await sync.resolve(ID, true)).toEqual({ drained: 0, remaining: 0 });
  });

  it("takes theirs: drops the write, and the next pull brings the server's row", async () => {
    const { db, sync } = setup();
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") });
    db.net.offline = true;
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("mine") });
    db.net.offline = false;
    db.teammate.update("API_KEY", "development", { ciphertext: "ct-sam" });
    await sync.drain(ID);
    expect(await sync.resolve(ID, false)).toEqual({ dropped: true, remaining: 0 });
    expect((await sync.pull(ID)).rows).toEqual([expect.objectContaining({ ciphertext: "ct-sam" })]);
  });

  it("keeps mine on a row the teammate deleted, and throws a refusal mid-drain", async () => {
    const { db, sync, secret } = setup();
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("1") });
    db.net.offline = true;
    await sync.push(ID, { op: "set", name: "API_KEY", environment: "development", ...box("mine") });
    db.net.offline = false;
    db.teammate.remove("API_KEY", "development");
    expect(await sync.drain(ID)).toMatchObject({ conflict: true, current: null });
    db.net.fail = { table: "vault_secrets", message: "denied" };
    await expect(sync.drain(ID)).rejects.toThrow("denied");
    db.net.fail = null;
    expect(await sync.resolve(ID, true)).toEqual({ drained: 1, remaining: 0 });
    expect(secret()).toMatchObject({ ciphertext: "ct-mine", row_version: 0 });
  });
});

describe("Realtime", () => {
  it("subscribes once per vault, passes on only this vault's events, and tears down on close()", async () => {
    const { db, sync } = setup();
    await sync.push(ID, { op: "set", name: "A", environment: "development", ...box("1") });
    const events: unknown[] = [];
    const channel = sync.subscribe(ID, (e: unknown) => events.push(e));
    expect(sync.subscribe(ID, () => undefined)).toBe(channel);
    const ch = db.channels[0]!;
    expect(ch).toMatchObject({ name: "vault:v1", subscribed: true });
    expect(ch.handlers.map((h) => h.filter)).toEqual(["vault_secrets", "vault_events", "vault_grants"].map((table) => ({ event: "*", schema: "public", table, filter: "vault_id=eq.v1" })));
    const secrets = ch.handlers[0]!;
    const log = ch.handlers[1]!;
    secrets.cb({ eventType: "UPDATE", new: { vault_id: "v1", id: "x" }, old: {} });
    secrets.cb({ eventType: "UPDATE", new: { vault_id: "v2", id: "y" }, old: {} });
    secrets.cb({ eventType: "DELETE", new: {}, old: { id: db.tables.vault_secrets[0]!.id } });
    secrets.cb({ eventType: "DELETE", new: {}, old: { id: "elsewhere" } });
    log.cb({ eventType: "INSERT", new: { vault_id: "v1" } });
    expect(events).toEqual([
      { table: "vault_secrets", eventType: "UPDATE" },
      { table: "vault_secrets", eventType: "DELETE" },
      { table: "vault_events", eventType: "INSERT" },
    ]);
    sync.close();
    expect(db.removed).toEqual([channel]);
    sync.close();
    expect(db.removed).toHaveLength(1);
  });

  it("closes with no account client at all", () => {
    const sync = createVaultSync({ dir: tmp() });
    expect(() => sync.close()).not.toThrow();
  });
});

describe("the sync files", () => {
  it("reads nothing for a vault that isn't shared, and keeps state, queue and the shared mark 0600", () => {
    const dir = path.join(tmp(), "vault");
    const files = createSyncFiles(dir);
    expect(files.shared(ID)).toBeNull();
    expect(files.state(ID)).toBeNull();
    expect(files.queue(ID)).toEqual([]);
    files.setQueue(ID, []);
    files.markShared(ID, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });
    expect(files.state(ID)).toEqual({ vaultId: "v1", orgId: "o1", serverVersion: 0, rows: {} });
    files.setState(ID, { vaultId: "v1", orgId: "o1", serverVersion: 4, rows: { "development\nA": { rowId: "r", rowVersion: 2 } } });
    expect(files.state(ID)?.serverVersion).toBe(4);
    const entry = { op: "remove" as const, name: "A", environment: "development", expectedRowVersion: 2, expectedServerVersion: 4, queuedAt: "t" };
    files.enqueue(ID, entry);
    files.enqueue(ID, entry);
    expect(files.queue(ID)).toEqual([entry, entry]);
    for (const suffix of ["shared.json", "sync.json", "queue.jsonl"]) expect(fs.statSync(path.join(dir, `${hashOf(ID)}.${suffix}`)).mode & 0o777).toBe(0o600);
    files.setQueue(ID, []);
    expect(files.queue(ID)).toEqual([]);
  });
});

describe("finding a local vault by the server's id", () => {
  it("joins the server's vault id to the local vault whose key makes the words", () => {
    const dir = path.join(tmp(), "vault");
    const files = createSyncFiles(dir);
    // The vault's own file carries the local id; the shared file beside it carries the server's.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${hashOf(ID)}.json`), JSON.stringify({ id: ID, label: "app", grants: [], secrets: [] }));
    files.markShared(ID, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });

    const found = files.byVaultId("v1");
    expect(found?.id).toBe(ID);
    // vault-sync-files.cjs is CommonJS: it reaches the test as `any`, so the shared file's shape is
    // asserted here rather than taken on trust from the module.
    expect(found?.shared).toMatchObject({ vaultId: "v1", orgId: "o1", repo: "a/b", keyVersion: 1 });
  });

  it("finds nothing for a vault id that was never shared from here", () => {
    const dir = path.join(tmp(), "vault");
    const files = createSyncFiles(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${hashOf(ID)}.json`), JSON.stringify({ id: ID, label: "app", grants: [], secrets: [] }));
    files.markShared(ID, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });
    expect(files.byVaultId("v2")).toBeNull();
    expect(files.byVaultId("")).toBeNull();
  });

  it("finds nothing when the vault's own file is gone", () => {
    const dir = path.join(tmp(), "vault");
    const files = createSyncFiles(dir);
    files.markShared(ID, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });
    expect(files.byVaultId("v1")).toBeNull();
  });
});
