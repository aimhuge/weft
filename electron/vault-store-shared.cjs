// A shared vault's side of electron/vault-store.cjs (docs/architecture/teams-vault.md, "Sync model"): the
// local <hash>.json is the server's shadow. A write is encrypted here, pushed by the sync engine
// (electron/vault-sync.cjs), and the shadow takes the server's row on success, the server's current row on a
// conflict, or the local entry when the write was queued offline. A pull writes the server's changes in.

/** @typedef {import("./vault-store.cjs").Entry} Entry */
/** @typedef {import("./vault-store.cjs").Vault} Vault */

// A server row as a shadow entry: ciphertext and nonce, or a blank with its hint.
/** @returns {Entry} */
function entryOf(row) {
  const kept = row.is_blank ? row.hint && { hint: row.hint } : { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version };
  return { name: row.name, environment: row.environment, updatedAt: row.updated_at, ...kept };
}

const indexOf = (vault, name, environment) => vault.secrets.findIndex((s) => s.name === name && s.environment === environment);

function put(vault, entry) {
  const at = indexOf(vault, entry.name, entry.environment);
  if (at >= 0) vault.secrets[at] = entry;
  else vault.secrets.push(entry);
}

function drop(vault, name, environment) {
  const at = indexOf(vault, name, environment);
  if (at >= 0) vault.secrets.splice(at, 1);
}

// This device's sealed copies of the vault key from the server, beside the ones the file already has.
function mergeGrants(vault, grants) {
  for (const g of grants) {
    const device = g.device?.public_key;
    if (device && !vault.grants.some((h) => h.device === device && h.keyVersion === g.key_version)) vault.grants.push({ device, keyVersion: g.key_version, wrapped: g.wrapped_key });
  }
}

/**
 * @param {{ sync: any, environments: string[], device: { publicKey: string }, sodium: any, now: () => number, read: (id: string) => Vault | null,
 *   write: (vault: Vault) => void, keyOf: (vault: Vault) => string, forget: (id: string) => void, onRemote: (id: string) => void }} deps
 */
function createSharedOps({ sync, environments, device, sodium, now, read, write, keyOf, forget, onRemote }) {
  async function pull(id) {
    const diff = await sync.pull(id);
    if (diff.offline) return { offline: true, queued: sync.queued(id) };
    const vault = read(id) ?? { id, label: sync.shared(id).repo, keyVersion: diff.keyVersion, grants: [], secrets: [] };
    mergeGrants(vault, diff.grants);
    // A rotated key (card 9) is used once this device holds a grant for it.
    if (diff.keyVersion !== vault.keyVersion && vault.grants.some((g) => g.device === device.publicKey && g.keyVersion === diff.keyVersion)) {
      vault.keyVersion = diff.keyVersion;
      forget(id);
    }
    for (const row of diff.rows) put(vault, entryOf(row));
    for (const gone of diff.removed) drop(vault, gone.name, gone.environment);
    write(vault);
    // A teammate's write arrives as an event; pulling again brings it into the shadow.
    sync.subscribe(id, () => {
      pull(id).then(() => onRemote(id), () => null);
    });
    const drained = await sync.drain(id);
    return { changed: diff.rows.length, removed: diff.removed.length, queued: drained.remaining, ...(drained.conflict && { conflict: { name: drained.entry.name, environment: drained.entry.environment } }) };
  }

  // A write that lost the row: the shadow takes what the server holds, and the conflict is reported
  // with the server's row, so the drawer can offer the two ways out (keep your edit, keep theirs)
  // without asking the server twice. The row is a ciphertext row: it stays here, in main, and never
  // reaches the renderer whole.
  function conflicted(vault, name, environment, current, result) {
    if (current) put(vault, entryOf(current));
    else drop(vault, name, environment);
    result.conflicts.push({ name, environment, current: current ?? null });
  }

  // One entry of a set: encrypted here, pushed, and the shadow takes whatever the server says it now holds.
  async function pushOne(id, vault, key, { name, environment, value, source, hint }, result) {
    if (!environments.includes(environment)) throw new Error(`Unknown environment: ${environment}`);
    const old = vault.secrets[indexOf(vault, name, environment)];
    // A blank never replaces a value, and an unchanged blank has nothing to push.
    if (value === null && old && (old.ciphertext || !hint || hint === old.hint)) return;
    /** @type {Entry} */
    const local = { name, environment, updatedAt: new Date(now()).toISOString(), source, ...(value === null && hint && { hint }) };
    if (value !== null) Object.assign(local, sodium.encrypt(value, key, sodium.aad(id, name, environment, vault.keyVersion)), { keyVersion: vault.keyVersion });
    const pushed = await sync.push(id, { op: value === null ? "blank" : "set", name, environment, ciphertext: local.ciphertext, nonce: local.nonce, keyVersion: vault.keyVersion, hint: local.hint });
    // Rolled back to what the server holds; the drawer shows the conflict (card 12).
    if (pushed.conflict) return conflicted(vault, name, environment, pushed.current, result);
    put(vault, pushed.row ? { ...entryOf(pushed.row), source } : local);
    if (pushed.queued) result.queued += 1;
  }

  // The local set's rules (a null value is a blank), pushed one entry at a time, in order.
  /** @returns {Promise<{ conflicts: { name: string, environment: string, current: Record<string, any> | null }[], queued: number }>} */
  async function set(id, label, entries) {
    const vault = read(id) ?? ((await pull(id)), read(id));
    if (!vault) throw new Error("This device has no key for this vault.");
    const key = keyOf(vault);
    const result = { conflicts: /** @type {{ name: string, environment: string, current: Record<string, any> | null }[]} */ ([]), queued: 0 };
    for (const entry of entries) await pushOne(id, vault, key, entry, result);
    write(vault);
    return result;
  }

  async function remove(id, name, environment) {
    const vault = read(id);
    if (!vault || indexOf(vault, name, environment) < 0) return false;
    const pushed = await sync.push(id, { op: "remove", name, environment });
    if (pushed.conflict) put(vault, entryOf(pushed.current));
    else drop(vault, name, environment);
    write(vault);
    return !pushed.conflict;
  }

  return { pull, set, remove };
}

module.exports = { createSharedOps, entryOf, mergeGrants };
