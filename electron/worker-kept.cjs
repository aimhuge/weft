// "Keep on this worker", main's record (docs/architecture/secrets.md#kept-on-a-worker). The user picks a project's
// development or preview secrets for a paired Weft Worker in Settings → Devices; after a warning and Touch ID, main seals
// each value to the worker's pinned box key for its own slot and version (electron/worker-seal.cjs, keptPurpose), signs
// the whole `vault_keep` with this Mac's device key (electron/desktop-signer.cjs) and queues it for that worker
// (electron/worker-keep.cjs). The worker takes only a command signed by the Mac its pairing code named, and opens a
// kept value only when a later secret_use from this Mac, sealed and signed after its own Touch ID, names that name and
// version (splitKept, below).
//
// Main keeps what it sent where (vault/worker-kept.json, sealed with safeStorage): each value's version and sha256. A use
// takes the worker's copy only when the worker claims that version and the vault's value still has that sha256, so a
// copy that missed a change is never used: the value travels per use, as before. A file that won't open keeps nothing,
// so every use sends its values again. Taking values away (Stop, a removed or changed secret, Wipe before a revoke) is a
// narrowing: signed without Touch ID. Adding them always asks.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const sha = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * What this Mac sent to which worker: { [worker]: { seq, keeps: { [repo]: { label, envs: { [env]: { [name]: { version, sha } } } } } } }.
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string } }} deps
 */
function createKeptRecord({ dir, safeStorage }) {
  const file = path.join(dir, "vault", "worker-kept.json");
  /** @returns {Record<string, any>} */
  function read() {
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  /** @param {Record<string, any>} all */
  function write(all) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(all)).toString("base64"), { mode: 0o600 });
  }
  /** @param {string} worker @param {(w: { seq?: number, keeps: Record<string, any> }) => void} change */
  function update(worker, change) {
    const all = read();
    const w = isObject(all[worker]) ? all[worker] : {};
    w.keeps = isObject(w.keeps) ? w.keeps : {};
    change(w);
    all[worker] = w;
    write(all);
  }
  return { read, write, update, file };
}

/**
 * Which of a use's values the worker can take from its own copy: those whose version the worker claims and whose value
 * this Mac sent unchanged. The rest travel sealed, as before. Never more than the values the use approved.
 * @param {ReturnType<typeof createKeptRecord>} record @param {string} worker @param {string} repo @param {string} environment
 * @param {Record<string, string>} values @param {unknown} claim the ask's `kept`, the worker's word
 * @returns {{ values: Record<string, string>, kept: Record<string, number> }}
 */
function splitKept(record, worker, repo, environment, values, claim) {
  const slots = record.read()[worker]?.keeps?.[repo]?.envs?.[environment];
  const claimed = isObject(claim) ? claim : {};
  const out = { values: {}, kept: {} };
  for (const [name, value] of Object.entries(values)) {
    const slot = isObject(slots) ? slots[name] : null;
    const same = isObject(slot) && Number.isSafeInteger(slot.version) && claimed[name] === slot.version && slot.sha === sha(value);
    if (same) out.kept[name] = slot.version;
    else out.values[name] = value;
  }
  return out;
}

/** The plaintext a use seals, with `kept` only when the worker takes some values from its own copy. */
function withKept(plain, split) {
  return { ...plain, values: split.values, ...(Object.keys(split.kept).length ? { kept: split.kept } : {}) };
}

module.exports = { createKeptRecord, splitKept, withKept, sha };
