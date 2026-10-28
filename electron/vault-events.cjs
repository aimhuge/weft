// The shared vault's event log in Electron main (docs/architecture/teams-vault.md, "What the 🔐 drawer
// shows" and Q14): the last hundred `vault_events` rows of a vault, newest first, for the drawer's
// Event log tab.
//
// The rows say who did what to which name, and never carry a value: the query below names its columns
// one by one and leaves out `metadata`, which is writer-controlled jsonb. The renderer gets a fixed
// shape (lib/vault-events.ts), so a column added to the table later cannot reach the UI.
//
// The scope is the user's own actions by default and every member's on request. RLS already scopes the
// read to the members of the vault's org; the scope here is a filter inside that.
//
// The live feed is one supabase channel on vault_events, scoped to the vault (docs/architecture/teams-vault.md,
// Q14). The rows that land come in as appended rows; the channel is silent when the desktop is offline.
//
// The vault's server id comes from the same <hash>.shared.json the sync engine reads
// (electron/vault-sync-files.cjs), so the log knows which server vault a local vault id means.

const { createSyncFiles } = require("./vault-sync-files.cjs");

// The columns the log reads. No `metadata`, no ciphertext, no value: a row is an action and a name.
const COLUMNS = "id, action, target_name, target_environment, actor_user_id, actor_email, created_at";
// How many rows the tab holds (docs/architecture/teams-vault.md: the last 100 vault_events).
const LIMIT = 100;

/**
 * The event log for the drawer's tab.
 * @param {{ accountClient: any, dir: string }} deps
 */
function createVaultEvents({ accountClient, dir }) {
  const files = createSyncFiles(dir);
  const channels = new Map(); // local vault id -> the Realtime channel

  const db = () => accountClient?.supabase;

  // The server's uuid for a local vault id ("github:owner/name"), or null when the vault is local only.
  function serverId(localId) {
    return files.shared(localId)?.vaultId ?? null;
  }

  // The signed-in user's id, for the "mine" scope. Null when nobody is signed in.
  function userId() {
    const claims = accountClient?.getClaims?.() ?? null;
    return typeof claims?.sub === "string" ? claims.sub : null;
  }

  // The rows since a timestamp, newest first. A `since` of null is the whole log.
  /** @returns {Promise<Record<string, unknown>[]>} */
  async function rows(vaultId, { since, scope }) {
    const client = db();
    if (!client || !vaultId) return [];
    let query = client.from("vault_events").select(COLUMNS).eq("vault_id", vaultId).order("created_at", { ascending: false }).limit(LIMIT);
    if (since) query = query.gt("created_at", since);
    // "mine" is the default; "all" is the team's view.
    if (scope !== "all") {
      const me = userId();
      // Without a signed-in user there is no "mine" to filter by, so nothing is shown rather than
      // everybody's actions.
      if (!me) return [];
      query = query.eq("actor_user_id", me);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  }

  return {
    /**
     * The log for a vault, for the drawer's tab.
     * @param {string} localId the local vault id ("github:owner/name")
     * @param {{ since?: string | null, scope?: "mine" | "all" }} [query]
     */
    async list(localId, query = {}) {
      const vaultId = serverId(localId);
      // shared: whether the vault is shared at all, so the tab can say so instead of showing nothing.
      if (!vaultId) return { events: [], since: null, shared: false };
      const scope = query.scope === "all" ? "all" : "mine";
      const events = await rows(vaultId, { since: query.since ?? null, scope });
      // The oldest row's timestamp, for the next read. Null when the log is empty.
      const since = events.length ? events[events.length - 1].created_at ?? null : null;
      // The signed-in user's id, so the renderer can check the live feed's rows against the "mine"
      // filter itself. An id, not a secret.
      return { events, since, shared: true, userId: userId() };
    },

    /**
     * Watches a vault's log: the rows that land are handed to onRows. One channel per vault, scoped
     * to it server-side; the rows are read from the same source the tab shows, so what arrives is
     * what the tab would have read anyway.
     *
     * @param {string} localId
     * @param {(rows: Record<string, unknown>[]) => void} onRows
     * @param {"mine" | "all"} [scope]
     * @returns {() => void} stops watching
     */
    watch(localId, onRows, scope = "mine") {
      const client = db();
      const vaultId = serverId(localId);
      if (!client || !vaultId) return () => {};
      const existing = channels.get(localId);
      if (existing) return existing.stop;
      let since = null;
      const channel = client
        .channel(`vault-events:${vaultId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "vault_events", filter: `vault_id=eq.${vaultId}` }, () => {
          rows(vaultId, { since, scope })
            .then((fresh) => {
              if (!fresh.length) return;
              since = fresh[fresh.length - 1].created_at ?? since;
              onRows(fresh);
            })
            .catch(() => null);
        })
        .subscribe();
      const stop = () => {
        client.removeChannel?.(channel);
        channels.delete(localId);
      };
      channels.set(localId, { stop });
      return stop;
    },

    // Every channel this opened, for the shell's close.
    close() {
      for (const { stop } of channels.values()) stop();
      channels.clear();
    },
  };
}

module.exports = { createVaultEvents, EVENT_COLUMNS: COLUMNS, EVENTS_LIMIT: LIMIT };
