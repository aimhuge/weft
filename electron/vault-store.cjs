// The local vault: one file per project vault in ~/.weft/vault/, holding only ciphertext, the vault key
// sealed to each device that may open it ("grants"), and names marked missing (from .env.example) that
// have no value yet. Decryption happens here in Electron main and nowhere else (docs/architecture/secrets.md).
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createSharedOps } = require("./vault-store-shared.cjs");

const ENVIRONMENTS = ["development", "preview", "production"];

/** @typedef {{ name: string, environment: string, ciphertext?: string, nonce?: string, keyVersion?: number, updatedAt: string, source?: string, hint?: string }} Entry */
/** @typedef {{ id: string, label: string, keyVersion: number, grants: { device: string, keyVersion: number, wrapped: string }[], secrets: Entry[] }} Vault */

// Long enough values show their last 4 characters; shorter ones show nothing, since 4 of 8 is half of it.
function tailOf(value) {
  return value.length >= 12 ? value.slice(-4) : "";
}

// sync (electron/vault-sync.cjs) is there once the account client is: a shared vault's set and remove go to
// the server first and return a promise, and this file becomes its shadow. A personal vault never touches it.
/**
 * @param {{ dir: string, device: { publicKey: string, privateKey: string }, sodium: any, now?: () => number, sync?: any, onRemote?: (id: string) => void }} deps
 */
function createVaultStore({ dir, device, sodium, now = Date.now, sync = null, onRemote = (id) => void id }) {
  const keys = new Map(); // vault id -> unwrapped vault key
  sync?.useDevice(device.publicKey);

  const fileOf = (id) => path.join(dir, `${crypto.createHash("sha256").update(id).digest("hex").slice(0, 16)}.json`);

  /** @returns {Vault | null} */
  function read(id) {
    const file = fileOf(id);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  }

  function write(vault) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = fileOf(vault.id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function keyOf(vault) {
    const cached = keys.get(vault.id);
    if (cached) return cached;
    const grant = vault.grants.find((g) => g.device === device.publicKey && g.keyVersion === vault.keyVersion);
    if (!grant) throw new Error("This device has no key for this vault.");
    const key = sodium.unwrapKey(grant.wrapped, device);
    keys.set(vault.id, key);
    return key;
  }

  function create(id, label) {
    const key = sodium.newVaultKey();
    keys.set(id, key);
    return { id, label, keyVersion: 1, grants: [{ device: device.publicKey, keyVersion: 1, wrapped: sodium.wrapKey(key, device.publicKey) }], secrets: [] };
  }

  /** @returns {string} */
  function valueOf(vault, entry) {
    return sodium.decrypt(entry, keyOf(vault), sodium.aad(vault.id, entry.name, entry.environment, entry.keyVersion));
  }

  const find = (vault, name, environment) => vault?.secrets.find((s) => s.name === name && s.environment === environment);

  const isShared = (id) => Boolean(sync?.shared(id));
  const shared = sync && createSharedOps({ sync, environments: ENVIRONMENTS, device, sodium, now, read, write, keyOf, forget: (id) => keys.delete(id), onRemote });

  return {
    // A shared vault (one with a <hash>.shared.json): pull before reading, and its queued writes for the drawer's chip.
    isShared,
    pull: (id) => (isShared(id) ? shared.pull(id) : Promise.resolve(null)),
    queued: (id) => (isShared(id) ? sync.queued(id) : 0),

    exists: (id) => fs.existsSync(fileOf(id)),

    // Whether the vault knows the name in that environment, with a value or marked missing.
    has: (id, name, environment) => Boolean(find(read(id), name, environment)),

    // Names, environments and masked tails. Never values.
    list(id) {
      const vault = read(id);
      if (!vault) return [];
      return vault.secrets.map((s) => {
        const missing = !s.ciphertext;
        return { name: s.name, environment: s.environment, missing, tail: missing ? "" : tailOf(valueOf(vault, s)), updatedAt: s.updatedAt, source: s.source, hint: s.hint };
      });
    },

    // One value, or undefined when it's not in the vault (or only marked missing).
    /** @returns {string | undefined} */
    get(id, name, environment) {
      const vault = read(id);
      const entry = find(vault, name, environment);
      return entry?.ciphertext ? valueOf(vault, entry) : undefined;
    },

    // Writes several at once. A null value marks the name missing (a blank), unless it already has one; a
    // blank's hint says where to get its value, and a later hint replaces it. A value drops the hint.
    //
    // A local vault has no row_version and therefore can never conflict: it answers nothing, as it
    // always has. A shared vault answers { conflicts: [{ name, environment, current }], queued },
    // where `current` is the server's row the write lost against — a conflict, never a throw, so
    // the drawer can offer the two ways out (docs/architecture/teams-vault.md, "Push on change").
    /** @returns {void | Promise<{ conflicts: { name: string, environment: string, current: Record<string, any> | null }[], queued: number }>} */
    set(id, label, entries) {
      if (isShared(id)) return shared.set(id, label, entries);
      const vault = read(id) ?? create(id, label);
      const key = keyOf(vault);
      for (const { name, environment, value, source, hint } of entries) {
        if (!ENVIRONMENTS.includes(environment)) throw new Error(`Unknown environment: ${environment}`);
        const old = find(vault, name, environment);
        if (value === null && old) {
          if (hint && !old.ciphertext) old.hint = hint;
          continue;
        }
        const entry = { name, environment, updatedAt: new Date(now()).toISOString(), source, ...(value === null && hint && { hint }) };
        if (value !== null) Object.assign(entry, sodium.encrypt(value, key, sodium.aad(id, name, environment, vault.keyVersion)), { keyVersion: vault.keyVersion });
        if (old) vault.secrets[vault.secrets.indexOf(old)] = entry;
        else vault.secrets.push(entry);
      }
      write(vault);
    },

    remove(id, name, environment) {
      if (isShared(id)) return shared.remove(id, name, environment);
      const vault = read(id);
      const entry = find(vault, name, environment);
      if (!entry) return false;
      vault.secrets.splice(vault.secrets.indexOf(entry), 1);
      write(vault);
      return true;
    },
  };
}

module.exports = { createVaultStore, tailOf, ENVIRONMENTS };
