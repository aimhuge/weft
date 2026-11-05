// An in-memory stand-in for the shared vault's Supabase tables, for electron/vault-sync.test.ts and
// electron/vault-store-shared.test.ts: supabase-js's query builder (from/select/insert/update/delete,
// eq/in/is, single/maybeSingle), the live triggers (row_version on update, the vault's server_version on
// every secret write), the unique (vault_id, name, environment) index, and Realtime channels.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; status: number };
type Tables = { vaults: Row[]; vault_secrets: Row[]; vault_grants: Row[]; vault_events: Row[]; devices: Row[] };
type Handler = { filter: { table: string; filter: string }; cb: (payload: Row) => void };

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-sync-"));

// A row's value as text. The rows hold anything, so the order and the comparisons are decided on
// the text of the value: a string stays itself, a number or a boolean reads as itself, and anything
// else (an object, a null) reads as the empty string rather than "[object Object]".
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function fakeDb() {
  const tables: Tables = { vaults: [], vault_secrets: [], vault_grants: [], vault_events: [], devices: [] };
  // offline: supabase-js's status 0; throws: a fetch that rejects; fail: a refusal for one table (or every one).
  const net = { offline: false, throws: false, fail: null as null | { table?: string; message: string } };
  const channels: { name: string; handlers: Handler[]; subscribed: boolean }[] = [];
  const removed: unknown[] = [];
  let ids = 0;

  const bump = (vaultId: unknown) => {
    const vault = tables.vaults.find((v) => v.id === vaultId);
    if (vault) vault.server_version = Number(vault.server_version) + 1;
  };

  class Query {
    kind: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    filters: ((r: Row) => boolean)[] = [];
    payload: Row = {};
    mode: "many" | "single" | "maybe" = "many";
    cols = "";
    // The conflict target of an upsert, as "col,col". The row that matches it is replaced.
    conflict = "";
    // The ordering a select asked for, and the row cap.
    sort: { col: string; ascending: boolean } | null = null;
    max = 0;
    constructor(readonly table: keyof Tables) {}
    select(cols = "*") {
      this.cols = cols;
      return this;
    }
    insert(p: Row) {
      this.kind = "insert";
      this.payload = p;
      return this;
    }
    update(p: Row) {
      this.kind = "update";
      this.payload = p;
      return this;
    }
    upsert(p: Row, options?: { onConflict?: string }) {
      this.kind = "upsert";
      this.payload = p;
      this.conflict = options?.onConflict ?? "";
      return this;
    }
    delete() {
      this.kind = "delete";
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    is(c: string, v: unknown) {
      this.filters.push((r) => (r[c] ?? null) === v);
      return this;
    }
    // The ordering a select asks for, and how many rows it wants. The newest-first order the
    // grant and event reads use.
    order(c: string, opts?: { ascending?: boolean }) {
      this.sort = { col: c, ascending: opts?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    single() {
      this.mode = "single";
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this;
    }
    then(resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve()
        .then(() => this.run())
        .then(resolve, reject);
    }
    shape(rows: Row[]): Result {
      const out = this.cols.includes("device:devices")
        ? rows.map((g) => {
            const device = tables.devices.find((d) => d.id === g.device_id);
            // The embedded resource: the device row as the select named its columns, or null when
            // the grant points at a device that isn't there.
            return { ...g, device: device ? { ...device } : null };
          })
        : rows.map((r) => ({ ...r }));
      if (this.mode === "many") return { data: out, error: null, status: 200 };
      if (out.length === 0 && this.mode === "single") return { data: null, error: { message: "no rows" }, status: 406 };
      return { data: out[0] ?? null, error: null, status: 200 };
    }
    // The read: the rows the filters hit, in the order the query asked for.
    readRows(hit: Row[]): Result {
      let out = hit;
      if (this.sort) {
        const { col, ascending } = this.sort;
        out = [...out].sort((a, b) => {
          // The rows hold anything, so the order is decided on their text: the columns the
          // grant and event reads order by are ids and timestamps.
          const av = text(a[col]);
          const bv = text(b[col]);
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if (this.max) out = out.slice(0, this.max);
      return this.shape(out);
    }
    // A write: insert, update, upsert or delete, with the vault's server_version bumped by the
    // live triggers.
    write(hit: Row[]): Result {
      const rows = tables[this.table];
      if (this.kind === "insert") {
        const p = this.payload;
        if (this.table === "vault_secrets" && rows.some((r) => r.vault_id === p.vault_id && r.name === p.name && r.environment === p.environment)) return { data: null, error: { message: "duplicate key", code: "23505" }, status: 409 };
        const row = { id: `row-${String(++ids)}`, row_version: 0, updated_at: "2026-10-27T00:00:00.000Z", ...p };
        rows.push(row);
        if (this.table === "vault_secrets") bump(p.vault_id);
        return this.shape([row]);
      }
      if (this.kind === "update") {
        for (const r of hit) {
          Object.assign(r, this.payload, { row_version: Number(r.row_version) + 1 });
          bump(r.vault_id);
        }
        return this.shape(hit);
      }
      if (this.kind === "upsert") {
        // The row that matches the conflict target is replaced; a target that matches nothing is
        // an insert. The target names the columns the conflict is decided on.
        const cols = this.conflict.split(",").map((c) => c.trim()).filter(Boolean);
        const match = rows.find((r) => cols.every((c) => r[c] === this.payload[c]));
        if (match) {
          Object.assign(match, this.payload);
          return this.shape([match]);
        }
        const row = { id: `row-${String(++ids)}`, row_version: 0, updated_at: "2026-10-27T00:00:00.000Z", ...this.payload };
        rows.push(row);
        if (this.table === "vault_secrets") bump(this.payload.vault_id);
        return this.shape([row]);
      }
      tables[this.table] = rows.filter((r) => !hit.includes(r));
      for (const r of hit) bump(r.vault_id);
      return this.shape(hit);
    }
    run(): Result {
      if (net.throws) throw new TypeError("fetch failed");
      if (net.offline) return { data: null, error: { message: "fetch failed" }, status: 0 };
      if (net.fail && (!net.fail.table || net.fail.table === this.table)) return { data: null, error: { message: net.fail.message }, status: 403 };
      const rows = tables[this.table];
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      return this.kind === "select" ? this.readRows(hit) : this.write(hit);
    }
  }

  const client = {
    from: (table: string) => new Query(table as keyof Tables),
    // The one RPC the recovery flow uses: private.share_vault_recovery. It writes the recovery
    // device row, the grant and the event row, and revokes the vault's old recovery row — the
    // same four writes the real function makes, in one transaction.
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "share_vault_recovery") return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` }, status: 404 });
      const vaultId = text(args.p_vault_id);
      const publicKey = text(args.p_public_key);
      const wrappedKey = text(args.p_wrapped_key);
      const keyVersion = Number(args.p_key_version ?? 1);
      if (!vaultId || !publicKey || !wrappedKey) return Promise.resolve({ data: null, error: { message: "missing arguments" }, status: 400 });
      // A re-show: the vault's old recovery row is revoked, so the old words stop working.
      for (const grant of tables.vault_grants) {
        if (grant.vault_id !== vaultId) continue;
        const device = tables.devices.find((d) => d.id === grant.device_id);
        if (device && device.fingerprint === "recovery" && !device.revoked_at) {
          device.revoked_at = "2026-10-27T00:00:00.000Z";
        }
      }
      const deviceId = `row-${String(++ids)}`;
      tables.devices.push({ id: deviceId, user_id: null, name: "recovery", public_key: publicKey, fingerprint: "recovery", platform: "darwin", last_seen_at: "2026-10-27T00:00:00.000Z", revoked_at: null });
      tables.vault_grants.push({ id: `row-${String(++ids)}`, vault_id: vaultId, device_id: deviceId, key_version: keyVersion, wrapped_key: wrappedKey, granted_by: "u1", granted_at: "2026-10-27T00:00:00.000Z" });
      tables.vault_events.push({ id: `row-${String(++ids)}`, vault_id: vaultId, actor_user_id: "u1", actor_email: null, device_id: deviceId, action: "vault.recovery_shown", metadata: { reason: null }, created_at: "2026-10-27T00:00:00.000Z" });
      return Promise.resolve({ data: deviceId, error: null, status: 200 });
    },
    channel(name: string) {
      const ch = {
        name,
        handlers: [] as Handler[],
        subscribed: false,
        on(_event: string, filter: Handler["filter"], cb: Handler["cb"]) {
          ch.handlers.push({ filter, cb });
          return ch;
        },
        subscribe() {
          ch.subscribed = true;
          return ch;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: (ch: unknown) => removed.push(ch),
  };

  // A teammate's write, straight into the table with the same triggers.
  const teammate = {
    insert: (row: Row) => new Query("vault_secrets").insert(row).run(),
    update: (name: string, environment: string, p: Row) => new Query("vault_secrets").update(p).eq("name", name).eq("environment", environment).run(),
    remove: (name: string, environment: string) => new Query("vault_secrets").delete().eq("name", name).eq("environment", environment).run(),
  };

  return { tables, net, client, channels, removed, teammate };
}
