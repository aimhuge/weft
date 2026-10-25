// What each shared mini app's keys were when they last went up to weft.zip, so Share… can send them again on its
// own only when they changed (electron/app-secrets-push.cjs, docs/architecture/mini-app-hosting.md). Each entry is
// a salted SHA-256 of the link id and the values, never the values; the salt is random per Mac and sits in the same
// file. A Touch ID you declined is remembered for this run only, so the dialog's polls don't ask again for the same
// values; pressing Upload secrets always asks.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FILE = "app-secrets-pushed.json";

function readLedger(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed?.salt === "string" && parsed.apps && typeof parsed.apps === "object") return parsed;
  } catch {
    // No file yet, or one we can't read: start over, which at worst sends the keys once more.
  }
  return { salt: crypto.randomBytes(32).toString("hex"), apps: {} };
}

function createPushedLedger(dataDir) {
  const file = path.join(dataDir, FILE);
  const declined = new Map();
  let ledger = null;
  const load = () => (ledger ??= readLedger(file));

  return {
    // One fingerprint for these values on this link; the names are sorted so the manifest's order doesn't matter.
    digest(shareId, values) {
      const entries = Object.keys(values).sort().map((name) => [name, values[name]]);
      return crypto.createHmac("sha256", load().salt).update(JSON.stringify([shareId, entries])).digest("hex");
    },
    // Whether there's nothing to ask about: these values already went up, or you declined them this run.
    settled(appId, digest) {
      return load().apps[appId] === digest || declined.get(appId) === digest;
    },
    sent(appId, digest) {
      declined.delete(appId);
      load().apps[appId] = digest;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(ledger), { mode: 0o600 });
    },
    declined(appId, digest) {
      declined.set(appId, digest);
    },
  };
}

module.exports = { createPushedLedger, LEDGER_FILE: FILE };
