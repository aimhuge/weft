// The Weft account's session (lib/account.ts), refresh token included, kept by Electron main behind safeStorage
// (docs/architecture/secrets.md, "Already exposed today"). The Next server reads and writes it through the
// token-guarded control server, so the token is never on disk in the clear and no thread can cat it. An old
// plaintext ~/.weft/account.json moves in here on first read and is deleted.
const fs = require("node:fs");
const path = require("node:path");

const PLAIN = "account.json";
const SEALED = "account.sealed";

function createAccountStore({ dataDir, safeStorage }) {
  const plain = path.join(dataDir, PLAIN);
  const sealed = path.join(dataDir, SEALED);
  // Without the Keychain there's nowhere better, so it stays the file it always was (mode 0600).
  const canSeal = () => safeStorage.isEncryptionAvailable();

  function readPlain() {
    try {
      return JSON.parse(fs.readFileSync(plain, "utf8"));
    } catch {
      return {};
    }
  }

  function writeFile(file, data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function write(data) {
    if (!canSeal()) return writeFile(plain, JSON.stringify(data, null, 2));
    writeFile(sealed, safeStorage.encryptString(JSON.stringify(data)));
    fs.rmSync(plain, { force: true });
  }

  /** @returns {Record<string, string>} */
  function read() {
    if (!canSeal()) return readPlain();
    if (fs.existsSync(sealed)) return JSON.parse(safeStorage.decryptString(fs.readFileSync(sealed)));
    if (!fs.existsSync(plain)) return {};
    const data = readPlain();
    write(data);
    return data;
  }

  return { read, write, sealed: canSeal };
}

// The control server's routes for it (electron/browser-pane.cjs).
function accountRoutes(store) {
  return {
    "POST /account/read": () => ({ data: store().read() }),
    "POST /account/write": (body) => {
      const data = body.data && typeof body.data === "object" ? Object.fromEntries(Object.entries(body.data).filter(([, v]) => typeof v === "string")) : {};
      store().write(data);
      return { ok: true };
    },
  };
}

// The routes over Electron's safeStorage, made on the first request (safeStorage needs the app ready).
function accountRoutesFor(dataDir, safeStorage = () => require("./keychain-audit.cjs").keychainFor("Weft sign-in")) {
  let store;
  return accountRoutes(() => (store ??= createAccountStore({ dataDir, safeStorage: safeStorage() })));
}

module.exports = { createAccountStore, accountRoutes, accountRoutesFor, ACCOUNT_SEALED: SEALED };
