// A shared vault's values on this Mac only (docs/architecture/teams-vault.md, "Joining a shared vault" step 4): a join
// keeps them here, the store flags them, and Push sends them up without ever replacing a teammate's value.
import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVaultStore } from "./vault-store.cjs";
import { createVaultSync } from "./vault-sync.cjs";
import { hashOf } from "./vault-sync-files.cjs";
import { fakeDb, tmp } from "./vault-sync.harness";

const ID = "github:a/b";
const DEV = "development";

beforeAll(() => sodium.ready());

// A Mac with values of its own joins a vault the team already shares: one value of the team's, one blank.
async function joined() {
  const dir = tmp();
  const device = sodium.newKeypair();
  const db = fakeDb();
  const sync = createVaultSync({ accountClient: { supabase: db.client, getClaims: () => ({ sub: "u2" }) }, dir, now: () => 0 });
  const store = createVaultStore({ dir, device, sodium, now: () => 0, sync, onRemote: vi.fn() });
  await store.set(ID, "a/b", [
    { name: "SUPABASE_SECRET_KEY", environment: "production", value: "air-only-secret" },
    { name: "FILLED_HERE", environment: DEV, value: "team-is-missing-this" },
    { name: "SHARED", environment: DEV, value: "mine-is-older" },
    { name: "lower_case", environment: DEV, value: "stays-local" },
  ]);
  const team = sodium.newVaultKey();
  const seal = (value: string, name: string, environment = DEV) => {
    const b = sodium.encrypt(value, team, sodium.aad(ID, name, environment, 1));
    return { vault_id: "v1", name, environment, ciphertext: b.ciphertext, nonce: b.nonce, key_version: 1, is_blank: false };
  };
  db.tables.vaults.push({ id: "v1", org_id: "o1", server_version: 2, current_key_version: 1 });
  db.tables.vault_secrets.push({ id: "r1", row_version: 0, ...seal("from-the-team", "SHARED") });
  db.tables.vault_secrets.push({ id: "r2", vault_id: "v1", name: "FILLED_HERE", environment: DEV, ciphertext: null, nonce: null, key_version: 1, row_version: 0, is_blank: true });
  await store.adopt(ID, "a/b", { key: team, keyVersion: 1, wrappedKey: sodium.wrapKey(team, device.publicKey) }, { orgId: "o1", vaultId: "v1", repo: "a/b", keyVersion: 1 });
  return { dir, db, sync, store, seal };
}

const flagged = (store: ReturnType<typeof createVaultStore>) =>
  store
    .list(ID)
    .filter((s) => (s as { localOnly?: boolean }).localOnly)
    .map((s) => `${s.environment}/${s.name}`)
    .sort();

describe("a joined Mac's values on this Mac only", () => {
  it("flags each value the team's vault has none for: no row, or a blank row", async () => {
    const { store } = await joined();
    // SHARED took the team's value; lower_case can't go to the server, so Push can't help it.
    expect(flagged(store)).toEqual(["development/FILLED_HERE", "production/SUPABASE_SECRET_KEY"]);
    expect(store.localOnly(ID)).toEqual([
      { name: "SUPABASE_SECRET_KEY", environment: "production" },
      { name: "FILLED_HERE", environment: DEV },
    ]);
    expect(store.list(ID).find((s) => s.name === "SHARED")).not.toHaveProperty("localOnly");
  });

  it("pushes the picked ones up, filling the blank, and nothing else", async () => {
    const { db, store } = await joined();
    const result = await store.pushLocal(ID, [{ name: "SUPABASE_SECRET_KEY", environment: "production" }, { name: "FILLED_HERE", environment: DEV }, { name: "SHARED", environment: DEV }]);
    expect(result).toEqual({ pushed: [{ name: "SUPABASE_SECRET_KEY", environment: "production" }, { name: "FILLED_HERE", environment: DEV }], kept: [], queued: 0 });
    expect(flagged(store)).toEqual([]);
    const rows = db.tables.vault_secrets as { name: string; is_blank: boolean }[];
    expect(rows.find((r) => r.name === "FILLED_HERE")?.is_blank).toBe(false);
    expect(rows.map((r) => r.name).sort()).toEqual(["FILLED_HERE", "SHARED", "SUPABASE_SECRET_KEY"]);
    // One event-log line each, and no plaintext on the server.
    expect((db.tables.vault_events as { target_name: string }[]).map((e) => e.target_name).sort()).toEqual(["FILLED_HERE", "SUPABASE_SECRET_KEY"]);
    expect(JSON.stringify(db.tables)).not.toContain("air-only-secret");
    expect(store.get(ID, "SUPABASE_SECRET_KEY", "production")).toBe("air-only-secret");
  });

  it("answers nothing pushed when no picked name is on this Mac only", async () => {
    const { db, store } = await joined();
    expect(await store.pushLocal(ID, [{ name: "SHARED", environment: DEV }])).toEqual({ pushed: [], kept: [], queued: 0 });
    expect(db.tables.vault_events).toHaveLength(0);
  });

  // Sam writes the row between Push's pull and its write.
  function race(t: Awaited<ReturnType<typeof joined>>, row: Record<string, unknown>) {
    const held = t.sync.held.bind(t.sync);
    t.sync.held = (id: string) => {
      if (!t.db.tables.vault_secrets.some((r) => (r as { name: string }).name === row.name)) t.db.teammate.insert(row);
      return held(id);
    };
  }

  it("keeps a teammate's value that landed first, here as on the server", async () => {
    const t = await joined();
    const picked = t.store.localOnly(ID);
    race(t, t.seal("sams-value", "SUPABASE_SECRET_KEY", "production"));
    const result = await t.store.pushLocal(ID, picked);
    expect(result.kept).toEqual([{ name: "SUPABASE_SECRET_KEY", environment: "production" }]);
    expect(result.pushed).toEqual([{ name: "FILLED_HERE", environment: DEV }]);
    expect(t.store.get(ID, "SUPABASE_SECRET_KEY", "production")).toBe("sams-value");
    expect(t.store.localOnly(ID)).toEqual([]);
  });

  it("keeps this Mac's value when a teammate's write was only a blank, still to push", async () => {
    const t = await joined();
    const picked = t.store.localOnly(ID);
    race(t, { vault_id: "v1", name: "SUPABASE_SECRET_KEY", environment: "production", ciphertext: null, nonce: null, key_version: 1, is_blank: true });
    expect((await t.store.pushLocal(ID, picked)).kept).toEqual([{ name: "SUPABASE_SECRET_KEY", environment: "production" }]);
    expect(t.store.get(ID, "SUPABASE_SECRET_KEY", "production")).toBe("air-only-secret");
    expect(t.store.localOnly(ID)).toEqual([{ name: "SUPABASE_SECRET_KEY", environment: "production" }]);
    expect((await t.store.pushLocal(ID, picked)).pushed).toEqual([{ name: "SUPABASE_SECRET_KEY", environment: "production" }]);
  });

  it("queues the push offline, and a queued write no longer counts as this Mac's only", async () => {
    const { db, store } = await joined();
    db.net.offline = true;
    const result = await store.pushLocal(ID, store.localOnly(ID));
    expect(result).toMatchObject({ queued: 2, kept: [] });
    expect(store.localOnly(ID)).toEqual([]);
    db.net.offline = false;
    await store.pull(ID);
    expect(store.queued(ID)).toBe(0);
    expect(store.localOnly(ID)).toEqual([]);
  });

  it("reads rows once more from a sync file written before rows said whether they were blank", async () => {
    const { dir, store } = await joined();
    const file = `${dir}/${hashOf(ID)}.sync.json`;
    const st = JSON.parse(fs.readFileSync(file, "utf8")) as { rows: Record<string, { blank?: boolean }> };
    for (const row of Object.values(st.rows)) delete row.blank;
    fs.writeFileSync(file, JSON.stringify(st));
    // Without `blank`, the blank row would read as a value the server has.
    expect(store.localOnly(ID)).toEqual([{ name: "SUPABASE_SECRET_KEY", environment: "production" }]);
    await store.pull(ID);
    expect(store.localOnly(ID)).toHaveLength(2);
  });

  it("has nothing on this Mac only in a personal vault", async () => {
    const store = createVaultStore({ dir: tmp(), device: sodium.newKeypair(), sodium, now: () => 0 });
    await store.set(ID, "a/b", [{ name: "A", environment: DEV, value: "v" }]);
    expect(store.localOnly(ID)).toEqual([]);
    expect(store.list(ID)[0]).not.toHaveProperty("localOnly");
  });
});
