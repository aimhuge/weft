// The shared vault's Supabase calls (docs/architecture/teams-vault.md, "Sync model"), as the signed-in user
// through electron/account-client.cjs, so RLS scopes every one. The server only ever sees ciphertext; an
// event row says who did what to which name, never a value.
//
// A write is optimistic: it names the row_version it last saw, and a trigger bumps row_version (and the
// vault's server_version) on every change. A write that finds a different version, or a row where it
// expected none, comes back as { conflict: true, current } with the server's row, never as a throw.

// The columns a row is read with. Ciphertext and nonce are what the local shadow keeps.
const COLUMNS = "id, name, environment, ciphertext, nonce, key_version, row_version, is_blank, hint, updated_at, updated_by";
// What the event log calls each op.
const ACTIONS = { set: "set", blank: "add blank", remove: "remove" };

// No network, or no session: the caller queues the write and the reads come from the shadow.
class OfflineError extends Error {
  constructor() {
    super("The shared vault is offline.");
    this.offline = true;
  }
}

/** @returns {Promise<{ data: any, error: { message: string, code?: string } | null, status: number }>} */
async function call(query) {
  let res;
  try {
    res = await query;
  } catch {
    throw new OfflineError();
  }
  // supabase-js answers a failed fetch with status 0; account-client answers a signed-out request with 401.
  if (res.status === 0 || res.status === 401) throw new OfflineError();
  return res;
}

// The data, or a throw with the server's message (a refusal by RLS, a bad column): never a value in it.
async function data(query) {
  const res = await call(query);
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const server = {
  /** @returns {Promise<{ serverVersion: number, keyVersion: number }>} */
  async version(db, vaultId) {
    const row = await data(db.from("vaults").select("server_version, current_key_version").eq("id", vaultId).single());
    return { serverVersion: Number(row.server_version), keyVersion: row.current_key_version };
  },

  // Every row's key and version, no ciphertext: the pull diffs this against the shadow.
  keys: (db, vaultId) => data(db.from("vault_secrets").select("id, name, environment, row_version").eq("vault_id", vaultId)),

  rows: (db, vaultId, ids) => (ids.length ? data(db.from("vault_secrets").select(COLUMNS).eq("vault_id", vaultId).in("id", ids)) : Promise.resolve([])),

  row: (db, vaultId, name, environment) => data(db.from("vault_secrets").select(COLUMNS).eq("vault_id", vaultId).eq("name", name).eq("environment", environment).maybeSingle()),

  // This device's sealed copies of the vault key; RLS only returns the signed-in user's own devices.
  grants: (db, vaultId) => data(db.from("vault_grants").select("key_version, wrapped_key, device:devices(public_key)").eq("vault_id", vaultId)),

  /** @returns {Promise<string | null>} */
  async deviceId(db, publicKey) {
    const row = await data(db.from("devices").select("id").eq("public_key", publicKey).is("revoked_at", null).maybeSingle());
    return row?.id ?? null;
  },

  // One write against the row_version last seen (null: a row the server shouldn't have yet).
  async write(db, vaultId, op, expected, userId) {
    const match = (q) => q.eq("vault_id", vaultId).eq("name", op.name).eq("environment", op.environment).eq("row_version", expected);
    const conflict = async () => ({ conflict: true, current: await server.row(db, vaultId, op.name, op.environment) });
    if (op.op === "remove") {
      // Nothing on the server to remove: the row was only ever local.
      if (expected === null) return { row: null };
      const gone = await data(match(db.from("vault_secrets").delete()).select("id"));
      if (gone.length) return { row: null };
      // Someone else removed it first: that's what this write wanted too.
      const found = await conflict();
      return found.current ? found : { row: null };
    }
    const blank = op.op === "blank";
    const fields = { ciphertext: blank ? null : op.ciphertext, nonce: blank ? null : op.nonce, key_version: op.keyVersion, is_blank: blank, hint: blank ? (op.hint ?? null) : null, updated_by: userId };
    if (expected === null) {
      const res = await call(db.from("vault_secrets").insert({ vault_id: vaultId, name: op.name, environment: op.environment, ...fields }).select(COLUMNS).single());
      // 23505: the unique (vault_id, name, environment) index, so someone else made the row first.
      if (res.error?.code === "23505") return conflict();
      if (res.error) throw new Error(res.error.message);
      return { row: res.data };
    }
    const updated = await data(match(db.from("vault_secrets").update(fields)).select(COLUMNS));
    return updated.length ? { row: updated[0] } : conflict();
  },

  // Who did what, for the event log (card 11). A failed event line doesn't undo the write it describes.
  async event(db, { vaultId, op, userId, email, deviceId, rowVersion }) {
    await call(db.from("vault_events").insert({ vault_id: vaultId, action: ACTIONS[op.op], target_name: op.name, target_environment: op.environment, actor_user_id: userId, actor_email: email, device_id: deviceId, metadata: { row_version: rowVersion } })).catch(() => null);
  },
};

module.exports = { server, OfflineError, COLUMNS };
