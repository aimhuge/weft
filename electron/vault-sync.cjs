// The shared vault's sync engine in Electron main (docs/architecture/teams-vault.md, "Sync model" and
// "Offline behavior"). The server is the source of truth; the local <hash>.json is its shadow, which
// electron/vault-store.cjs reads with no network. This engine only ever handles ciphertext: the store
// encrypts before a push and decrypts after a pull, so no plaintext value reaches Supabase, a file or a log.
//
//   pull(id)        the diff since the last pull: changed rows, removed names, this device's grants
//   push(id, op)    one write ({ op: "set" | "blank" | "remove", name, environment, ciphertext?, nonce?,
//                   keyVersion?, hint? }); answers { row }, { conflict: true, current } or { queued: true }
//   drain(id)       the offline queue, in order, stopping at a conflict with the queue left intact
//   resolve(id, k)  the hand-resolve of a queued conflict: keep mine (k true) or take theirs
//   subscribe(id)   Realtime on the vault's rows, events and grants; close() ends every subscription
// id is the local vault id (github:owner/name); the server's uuid comes from <hash>.shared.json.
const { createSyncFiles, rowKey } = require("./vault-sync-files.cjs");
const { server } = require("./vault-sync-server.cjs");

const TABLES = ["vault_secrets", "vault_events", "vault_grants"];

// The queue keeps what a write needs and nothing of the caller's: no source, no stray fields.
const opOf = ({ op, name, environment, ciphertext, nonce, keyVersion, hint }) => ({ op, name, environment, ...(ciphertext !== undefined && { ciphertext, nonce }), ...(keyVersion !== undefined && { keyVersion }), ...(hint !== undefined && { hint }) });

/**
 * @param {{ accountClient?: { supabase: any, getClaims?: () => Record<string, unknown> | null }, supabase?: any, dir: string, now?: () => number }} deps
 */
function createVaultSync({ accountClient, supabase, dir, now = Date.now }) {
  const files = createSyncFiles(dir);
  const db = () => supabase ?? accountClient?.supabase;
  const channels = new Map(); // local id -> Realtime channel
  let publicKey = null;
  let deviceId = null;

  function who() {
    const claims = accountClient?.getClaims?.() ?? null;
    return { userId: /** @type {string | null} */ (claims?.sub ?? null), email: /** @type {string | null} */ (claims?.email ?? null) };
  }

  // This device's devices.id for the event log, once it's registered (card 3); null until then.
  async function device() {
    if (!deviceId && publicKey) deviceId = await server.deviceId(db(), publicKey).catch(() => null);
    return deviceId;
  }

  function need(id) {
    const st = files.state(id);
    if (!st) throw new Error("This vault isn't shared.");
    return st;
  }

  // What the server now holds for a row, into the sync file's map.
  function record(st, op, row) {
    const key = rowKey(op.name, op.environment);
    if (row) st.rows[key] = { rowId: row.id, rowVersion: Number(row.row_version) };
    else delete st.rows[key];
  }

  // One write against the server, recorded and logged on success. Throws OfflineError with no network.
  async function send(id, st, op, expected) {
    const { userId, email } = who();
    const result = await server.write(db(), st.vaultId, op, expected, userId);
    record(st, op, result.conflict ? result.current : result.row);
    files.setState(id, st);
    if (result.conflict) return { conflict: true, current: result.current };
    await server.event(db(), { vaultId: st.vaultId, op, userId, email, deviceId: await device(), rowVersion: result.row ? Number(result.row.row_version) : null });
    return { row: result.row };
  }

  /** @returns {Promise<{ offline?: boolean, serverVersion?: number, keyVersion?: number, rows?: Record<string, any>[], removed?: { name: string, environment: string }[], grants?: Record<string, any>[] }>} */
  async function pull(id) {
    const st = need(id);
    try {
      const { serverVersion, keyVersion } = await server.version(db(), st.vaultId);
      const grants = await server.grants(db(), st.vaultId);
      if (serverVersion === st.serverVersion) return { serverVersion, keyVersion, rows: [], removed: [], grants };
      // A name with a queued write keeps the user's value in the shadow until the queue drains.
      const pending = new Set(files.queue(id).map((e) => rowKey(e.name, e.environment)));
      const keys = await server.keys(db(), st.vaultId);
      const live = new Set(keys.map((k) => rowKey(k.name, k.environment)));
      const changed = keys.filter((k) => !pending.has(rowKey(k.name, k.environment)) && st.rows[rowKey(k.name, k.environment)]?.rowVersion !== Number(k.row_version));
      const rows = await server.rows(db(), st.vaultId, changed.map((k) => k.id));
      const removed = Object.keys(st.rows).filter((k) => !live.has(k) && !pending.has(k)).map((k) => ({ environment: k.split("\n")[0], name: k.split("\n")[1] }));
      for (const row of rows) record(st, row, row);
      for (const gone of removed) record(st, gone, null);
      files.setState(id, { ...st, serverVersion });
      return { serverVersion, keyVersion, rows, removed, grants };
    } catch (error) {
      if (error.offline) return { offline: true };
      throw error;
    }
  }

  async function drain(id) {
    const st = need(id);
    let queue = files.queue(id);
    let drained = 0;
    while (queue.length) {
      const entry = queue[0];
      // A chained entry follows an earlier queued write to the same row, so it expects what that one made.
      const expected = entry.chained ? (st.rows[rowKey(entry.name, entry.environment)]?.rowVersion ?? null) : entry.expectedRowVersion;
      let result;
      try {
        result = await send(id, st, entry, expected);
      } catch (error) {
        if (error.offline) return { offline: true, drained, remaining: queue.length };
        throw error;
      }
      // A hand-resolve: the entry stays at the head of the queue until resolve() says which write wins.
      if (result.conflict) return { conflict: true, current: result.current, entry: { op: entry.op, name: entry.name, environment: entry.environment, queuedAt: entry.queuedAt }, drained, remaining: queue.length };
      queue = queue.slice(1);
      files.setQueue(id, queue);
      drained += 1;
    }
    return { drained, remaining: 0 };
  }

  return {
    // The store's device, for the events' device_id.
    useDevice(key) {
      publicKey = key;
    },

    shared: (id) => files.shared(id),
    // The local vault that is shared as a given server vault (the recovery page's lookup).
    byVaultId: (vaultId) => files.byVaultId(vaultId),
    markShared: files.markShared,
    // How many writes wait to go out: the drawer's "queued" chip.
    queued: (id) => files.queue(id).length,

    pull,
    drain,

    /** @returns {Promise<{ row?: Record<string, any> | null, conflict?: boolean, current?: Record<string, any> | null, queued?: boolean, drained?: boolean }>} */
    async push(id, op) {
      const st = need(id);
      const key = rowKey(op.name, op.environment);
      const queue = files.queue(id);
      const entry = { ...opOf(op), expectedRowVersion: st.rows[key]?.rowVersion ?? null, expectedServerVersion: st.serverVersion, queuedAt: new Date(now()).toISOString() };
      // Writes go out in order: behind a queue, this one joins it.
      if (queue.length) {
        files.enqueue(id, { ...entry, chained: queue.some((e) => rowKey(e.name, e.environment) === key) });
        const drained = await drain(id);
        return drained.remaining ? { queued: true } : { queued: false, drained: true };
      }
      try {
        return await send(id, st, opOf(op), entry.expectedRowVersion);
      } catch (error) {
        if (!error.offline) throw error;
        files.enqueue(id, entry);
        return { queued: true };
      }
    },

    async resolve(id, keepMine) {
      const st = need(id);
      const [head, ...rest] = files.queue(id);
      if (!head) return { drained: 0, remaining: 0 };
      if (!keepMine) {
        // Theirs wins: drop the write and forget the row's version, so the next pull brings the server's row.
        delete st.rows[rowKey(head.name, head.environment)];
        files.setState(id, st);
        files.setQueue(id, rest);
        return { dropped: true, remaining: rest.length };
      }
      const current = await server.row(db(), st.vaultId, head.name, head.environment);
      files.setQueue(id, [{ ...head, chained: false, expectedRowVersion: current ? Number(current.row_version) : null }, ...rest]);
      return drain(id);
    },

    // Realtime per vault, scoped server-side by vault_id and checked again here, so a stray event for
    // another vault never reaches onEvent. A delete carries only the row's id, matched against the shadow.
    /** @returns {unknown} The channel, the same one for a second subscribe to the vault. */
    subscribe(id, onEvent) {
      if (channels.has(id)) return channels.get(id);
      const st = need(id);
      const ours = (row) => row?.vault_id === st.vaultId || Object.values(files.state(id)?.rows ?? {}).some((r) => r.rowId === row?.id);
      const channel = db().channel(`vault:${st.vaultId}`);
      for (const table of TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `vault_id=eq.${st.vaultId}` }, (payload) => {
          const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
          if (ours(row)) onEvent({ table, eventType: payload.eventType });
        });
      }
      channel.subscribe();
      channels.set(id, channel);
      return channel;
    },

    close() {
      for (const channel of channels.values()) db()?.removeChannel(channel);
      channels.clear();
    },
  };
}

module.exports = { createVaultSync };
