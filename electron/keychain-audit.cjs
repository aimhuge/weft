// The audit log of every Keychain and vault access (docs/architecture/secrets.md#audit-log). The record is the
// keychain_events table in your Weft account, not this Mac: a file on your own disk is one you can edit. What's here
// is the outbox, one JSON line per event not uploaded yet in ~/.weft/vault/audit.jsonl, 0600, which
// lib/secret-guard-files.ts keeps every thread out of (read and write). A line says when, what (a Keychain item opened or sealed, a vault value revealed, typed, run, pushed,
// written, a grant given), who (you, a thread by card and title, an app, or Weft itself), the names, where (site,
// command) and whether it happened or was denied. Never a value, not even a tail.
//
// Two layers write here. auditedKeychain() wraps Electron's safeStorage for each thing kept in the Keychain (the
// vault key, run rules, each provider's token, the sign-in), so every open or seal is a line however it was
// reached. The vault (electron/vault.cjs, secret-run.cjs) adds what the Keychain can't see: which secret, for whom.
//
// Every line has an id, so a retried upload is never a duplicate, and a seq, this Mac's 1, 2, 3… kept in audit-seq.json,
// so a line taken out of the outbox before it went up is a gap in the table. lib/keychain-audit-sync.ts uploads the
// outbox every few seconds and markSynced() deletes what went up, so a line sits on the Mac only until then (or until
// the next sign-in).
//
// CommonJS in electron/ because main can't import a .ts module. The log is one per app, so consumers set up in
// different modules share it: configureAudit() points it at the data dir once main knows it, and what's recorded
// before then waits in memory.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// The outbox keeps the newest MAX_ENTRIES lines (a long signed-out stretch); it's cut back to KEEP_ENTRIES once it
// passes that, so the cut is rare, and what's cut shows as a gap in seq.
const MAX_ENTRIES = 5000;
const KEEP_ENTRIES = 4000;
// Waiting lines Settings → Security asks for at most.
const READ_LIMIT = 500;
// Events recorded before configureAudit(), kept until then (a handful at startup).
const EARLY_LIMIT = 200;
// Weft opening the same Keychain item again within this long is one line with a count, not one line each: the
// sign-in is read on every Supabase call, which would push every other line out of the file in a day.
const REPEAT_MS = 10 * 60_000;
// Lines handed to one upload at most.
const OUTBOX_LIMIT = 200;

/**
 * One audit line. count, on a keychain line, is how many more times Weft did the same within REPEAT_MS after it. kind "keychain" is the Keychain itself (what names the item); kind "vault" a secret's use.
 * @typedef {{ id: string, seq?: number, at: string, kind: "keychain" | "vault", action: string, outcome: string, by: string, count?: number,
 *   what?: string, card?: string, thread?: string, vault?: string, names?: string[], environment?: string,
 *   site?: string, command?: string, detail?: string, via?: string }} AuditEntry
 */

// Drops empty fields and cuts free text to size, so a line stays a line.
function clean(entry) {
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) out[key] = value.map(String).slice(0, 50);
      continue;
    }
    out[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  return out;
}

function createAuditLog({ file, now = Date.now, maxEntries = MAX_ENTRIES, keepEntries = KEEP_ENTRIES, randomId = () => crypto.randomUUID() }) {
  let count = null; // lines in the file, counted on first write
  const cursorFile = path.join(path.dirname(file), "audit-synced.json");
  const seqFile = path.join(path.dirname(file), "audit-seq.json");

  function lines() {
    try {
      return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  // Keeps the newest keepEntries lines once the file has grown past maxEntries.
  function trim() {
    if (count === null) count = lines().length;
    if (count <= maxEntries) return;
    const kept = lines().slice(-keepEntries);
    fs.writeFileSync(file, `${kept.join("\n")}\n`, { mode: 0o600 });
    count = kept.length;
  }

  // The next number for this Mac: one past the last given, or past the highest in the outbox when the counter's lost.
  function nextSeq() {
    let last = 0;
    try {
      last = Number(JSON.parse(fs.readFileSync(seqFile, "utf8")).seq) || 0;
    } catch {
      for (const e of parsed(lines())) last = Math.max(last, Number(e.seq) || 0);
    }
    fs.writeFileSync(seqFile, JSON.stringify({ seq: last + 1 }), { mode: 0o600 });
    return last + 1;
  }

  return {
    /** @returns {AuditEntry} */
    record(entry) {
      const line = /** @type {AuditEntry} */ ({ id: randomId(), at: new Date(now()).toISOString(), ...clean(entry) });
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        line.seq = nextSeq();
        fs.appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
        fs.chmodSync(file, 0o600);
        if (count !== null) count += 1;
        trim();
      } catch {
        // A full disk mustn't stop a secret being used; the event is lost, not the action.
      }
      return line;
    },

    // The waiting lines, newest first, at most limit. A line that doesn't parse (a crash mid-write) is skipped.
    /** @returns {AuditEntry[]} */
    read(limit = READ_LIMIT) {
      return parsed(lines().slice(-limit)).reverse();
    },

    // The oldest lines not uploaded yet, at most limit: the file holds nothing else.
    /** @returns {AuditEntry[]} */
    outbox(limit = OUTBOX_LIMIT) {
      return parsed(lines()).slice(0, limit);
    },

    // Deletes the uploaded lines, up to and including id, and notes when. Synchronous like record(), so a line
    // recorded meanwhile can't be lost between the read and the write. An id the file doesn't have deletes nothing.
    markSynced(id) {
      const texts = lines();
      const upTo = texts.findIndex((text) => parsed([text])[0]?.id === String(id));
      if (upTo >= 0) {
        const rest = texts.slice(upTo + 1);
        fs.writeFileSync(file, rest.length ? `${rest.join("\n")}\n` : "", { mode: 0o600 });
        count = rest.length;
      }
      fs.writeFileSync(cursorFile, JSON.stringify({ at: new Date(now()).toISOString() }), { mode: 0o600 });
    },

    // What Settings → Security says about the upload: how many lines wait and when the last upload landed.
    status() {
      return { waiting: parsed(lines()).length, syncedAt: readCursor().at ?? null };
    },
  };

  function readCursor() {
    try {
      return /** @type {{ at?: string }} */ (JSON.parse(fs.readFileSync(cursorFile, "utf8")));
    } catch {
      return {};
    }
  }
}

// Lines as entries, skipping one that doesn't parse (a crash mid-write).
function parsed(texts) {
  const out = [];
  for (const text of texts) {
    try {
      out.push(JSON.parse(text));
    } catch {}
  }
  return out;
}

// The app's one log, set by configureAudit; events before that wait in early.
let shared = null;
const early = [];

function configureAudit({ dataDir, now = Date.now }) {
  shared = createAuditLog({ file: path.join(dataDir, "vault", "audit.jsonl"), now });
  for (const entry of early.splice(0)) shared.record(entry);
  return shared;
}

function audit(entry) {
  if (shared) return shared.record(entry);
  if (early.length < EARLY_LIMIT) early.push(entry);
  return null;
}

const readAudit = (limit) => (shared ? shared.read(limit) : []);
const auditOutbox = (limit) => (shared ? shared.outbox(limit) : []);
const markAuditSynced = (id) => shared?.markSynced(id);
const auditStatus = () => (shared ? shared.status() : { waiting: 0, syncedAt: null });

// Electron's safeStorage with every open (decryptString) and seal (encryptString) recorded under what, the
// thing kept in the Keychain ("vault key", "Vercel token"). A failure is recorded too, then thrown as before.
// The first open in REPEAT_MS is a line right away; the repeats after it are one more line with their count
// when that window ends.
/**
 * @param {{ isEncryptionAvailable(): boolean, encryptString(text: string): Buffer, decryptString(buf: Buffer): string }} safeStorage
 * @param {string} what
 */
function auditedKeychain(safeStorage, what, { record = audit, now = Date.now, setTimer = setTimeout, repeatMs = REPEAT_MS } = {}) {
  const windows = new Map(); // action -> { until, repeats }
  function ok(action) {
    const open = windows.get(action);
    if (open && now() < open.until) {
      open.repeats += 1;
      return;
    }
    const window = { until: now() + repeatMs, repeats: 0 };
    windows.set(action, window);
    record({ kind: "keychain", action, what, by: "weft", outcome: "ok" });
    const timer = setTimer(() => {
      if (window.repeats) record({ kind: "keychain", action, what, by: "weft", outcome: "ok", count: window.repeats });
      if (windows.get(action) === window) windows.delete(action);
    }, repeatMs);
    timer?.unref?.();
  }
  const call = (action, fn) => {
    try {
      const result = fn();
      ok(action);
      return result;
    } catch (err) {
      record({ kind: "keychain", action, what, by: "weft", outcome: "error", detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (text) => call("seal", () => safeStorage.encryptString(text)),
    decryptString: (buf) => call("open", () => safeStorage.decryptString(buf)),
  };
}

// Electron's own safeStorage, audited: what main's setups use in place of require("electron").safeStorage.
const keychainFor = (what) => auditedKeychain(require("electron").safeStorage, what);

// For tests: forget the shared log and anything waiting.
function resetAudit() {
  shared = null;
  early.length = 0;
}

module.exports = { createAuditLog, configureAudit, audit, readAudit, auditOutbox, markAuditSynced, auditStatus, auditedKeychain, keychainFor, resetAudit, MAX_ENTRIES, KEEP_ENTRIES, READ_LIMIT, REPEAT_MS, OUTBOX_LIMIT };
