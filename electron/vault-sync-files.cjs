// The shared vault's files beside the local one in ~/.weft/vault/ (docs/architecture/teams-vault.md, "Sync
// model" and "Offline behavior"), all named from the same hash as the vault's own <hash>.json:
//   <hash>.shared.json   { orgId, vaultId, repo, keyVersion }: this vault is shared, and as which server vault
//   <hash>.sync.json     { vaultId, orgId, serverVersion, rows: { "<env>\n<name>": { rowId, rowVersion } } }
//   <hash>.queue.jsonl   one write per line, made while offline, drained in order on reconnect
// The queue holds ciphertext, never a plaintext value, and is still written 0600. Nothing here logs.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** @typedef {{ orgId: string, vaultId: string, repo: string, keyVersion: number }} Shared */
/** @typedef {{ vaultId: string, orgId: string, serverVersion: number, rows: Record<string, { rowId: string, rowVersion: number }> }} SyncState */
/** @typedef {{ op: "set" | "remove" | "blank", name: string, environment: string, ciphertext?: string, nonce?: string, keyVersion?: number, hint?: string, expectedRowVersion: number | null, expectedServerVersion: number, chained?: boolean, queuedAt: string }} QueueEntry */

// The same 16 hex characters electron/vault-store.cjs names the vault's file with.
const hashOf = (id) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
// A row's key in the sync file's map: newlines can't appear in a name or an environment.
const rowKey = (name, environment) => `${environment}\n${name}`;

function createSyncFiles(dir) {
  const fileOf = (id, suffix) => path.join(dir, `${hashOf(id)}.${suffix}`);

  function readJson(file) {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  }

  function writeAtomic(file, text) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** @returns {Shared | null} */
  const shared = (id) => readJson(fileOf(id, "shared.json"));

  // The local vault that is shared as a given server vault.
  //
  // The shared file is named after the *local* id's hash, so the server's vault id isn't in the name:
  // the files have to be read to find it. The recovery page knows only the server's id (it comes from
  // the team's page), and main needs the local vault's key to make the words — so this is the lookup
  // that joins the two. A vault id that isn't here was never shared from this machine.
  //
  // The local id comes from the vault's own file, which carries it: the hash is only the file's name.
  //
  // @param {string} vaultId the server's vault id
  // @returns {{ id: string, shared: Shared } | null}
  function byVaultId(vaultId) {
    if (!vaultId || !fs.existsSync(dir)) return null;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".shared.json")) continue;
      let saved;
      try {
        saved = readJson(path.join(dir, name));
      } catch {
        continue; // A half-written file: the next read of it will say so.
      }
      if (!saved || saved.vaultId !== vaultId) continue;
      const hash = name.slice(0, -".shared.json".length);
      // The vault's own file is "<hash>.json", and it carries the local id.
      let localId = "";
      try {
        localId = JSON.parse(fs.readFileSync(path.join(dir, `${hash}.json`), "utf8"))?.id ?? "";
      } catch {
        localId = "";
      }
      if (!localId) continue;
      return { id: localId, shared: saved };
    }
    return null;
  }

  /** @returns {SyncState | null} The sync file, or a fresh one for a shared vault that has never synced. */
  function state(id) {
    const saved = readJson(fileOf(id, "sync.json"));
    if (saved) return saved;
    const s = shared(id);
    return s ? { vaultId: s.vaultId, orgId: s.orgId, serverVersion: 0, rows: {} } : null;
  }

  /** @returns {QueueEntry[]} */
  function queue(id) {
    const file = fileOf(id, "queue.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  /** @param {QueueEntry[]} entries */
  function setQueue(id, entries) {
    const file = fileOf(id, "queue.jsonl");
    if (!entries.length) fs.rmSync(file, { force: true });
    else writeAtomic(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  return {
    shared,
    byVaultId,
    // Marks a local vault shared (electron/vault-grant.cjs, once private.share_vault answers).
    /** @param {Shared} value */
    markShared: (id, value) => writeAtomic(fileOf(id, "shared.json"), JSON.stringify(value, null, 2)),
    state,
    /** @param {SyncState} value */
    setState: (id, value) => writeAtomic(fileOf(id, "sync.json"), JSON.stringify(value, null, 2)),
    queue,
    setQueue,
    /** @param {QueueEntry} entry */
    enqueue: (id, entry) => setQueue(id, [...queue(id), entry]),
  };
}

module.exports = { createSyncFiles, hashOf, rowKey };
