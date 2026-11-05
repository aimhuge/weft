// Tells the thread guards a pairing code is open (lib/clipboard-guard.ts): the latest expiry of the open codes goes to
// vault/pairing-open.json in the data dir, where threads can neither read nor delete it (lib/secret-guard-files.ts),
// and the file goes when no code is left. Only main knows a code is open (electron/pairing.cjs), and the server's
// guards read the file on a Bash call that reads the clipboard, with no request to main.
const fs = require("node:fs");
const path = require("node:path");

const PAIRING_OPEN_FILE = "pairing-open.json";

/** @param {string} dataDir @returns {(until: number) => void} 0 says no code is open. */
function pairingOpenMarker(dataDir) {
  const file = path.join(dataDir, "vault", PAIRING_OPEN_FILE);
  return (until) => {
    try {
      if (until > 0) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ until }), { mode: 0o600 });
      } else fs.rmSync(file, { force: true });
    } catch (err) {
      console.warn(`[pairing] couldn't mark the pairing code open: ${err?.message ?? err}`);
    }
  };
}

module.exports = { pairingOpenMarker, PAIRING_OPEN_FILE };
