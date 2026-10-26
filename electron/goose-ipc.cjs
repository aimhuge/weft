// Goose's provider keys on Electron main's side: the IPC the board calls, and the control-server route the
// server's Goose runner calls (docs/architecture/goose.md).
//
// Two doors, two disciplines:
// - The board (electron/preload.cjs) may list providers, set a key and forget one. It never receives a plaintext
//   key: listProviders answers with hasKey and the non-secret metadata (baseUrl, model, savedAt).
// - The server (lib/goose-provider.ts) runs the Goose subprocess, so it needs the key in the subprocess's env. It
//   doesn't get the plaintext either: it asks for a one-time grant, and electron/goose-env.cjs claims that grant
//   and starts Goose with the key in its env. The grant is spent on use and expires.
//
// This file holds the wiring so electron/main.cjs (already over its line budget) doesn't grow.

const path = require("node:path");
const { GOOSE_PROVIDERS, envForProvider, modelFor, providerById } = require("./goose-provider.cjs");
const { forgetGooseProvider, gooseTokenFile, listGooseProviders, readGooseProvider, writeGooseProvider } = require("./goose-token.cjs");

// How long a grant waits to be claimed.
const GRANT_MS = 60_000;

/**
 * The store the board and the runner share: the provider catalog, the file the keys live in, and the grants.
 * @param {{ dataDir: string, safeStorage: any, randomId?: () => string, now?: () => number }} options
 */
function createGoose({ dataDir, safeStorage, randomId = () => require("node:crypto").randomBytes(32).toString("hex"), now = Date.now }) {
  const file = gooseTokenFile(dataDir);
  const grants = new Map(); // grant -> { env, until }

  return {
    file,

    /** What the board sees: the catalog, and for each provider whether a key is saved and its metadata. */
    listProviders() {
      const saved = listGooseProviders(safeStorage, file);
      return {
        providers: GOOSE_PROVIDERS.map((p) => {
          const record = saved[p.id];
          return {
            id: p.id,
            label: p.label,
            envKey: p.envKey,
            models: p.models,
            note: p.note ?? null,
            freeModel: Boolean(p.freeModel),
            hasKey: Boolean(record),
            baseUrl: record?.baseUrl,
            model: record?.model,
            savedAt: record?.savedAt,
          };
        }),
      };
    },

    /**
     * Saves a provider's key. The board sends the plaintext once, and main seals it.
     *
     * baseUrl and model are the provider's own metadata, and only the providers that need one send them: a key
     * saved without them is the same as a key saved with empty ones (they're written only when they're truthy).
     *
     * @param {{ providerId: string, token: string, baseUrl?: string, model?: string }} payload
     */
    setProviderKey({ providerId, token, baseUrl, model }) {
      const id = String(providerId ?? "").trim();
      const provider = providerById(id);
      if (!provider) throw new Error(`Goose doesn't know a provider called "${id}".`);
      const record = writeGooseProvider(safeStorage, file, id, String(token ?? ""), {
        ...(baseUrl ? { baseUrl: String(baseUrl) } : {}),
        ...(model ? { model: String(model) } : {}),
      });
      // The same answer as listProviders, for one provider: the board never sees the key it just sent.
      return { id, label: provider.label, envKey: provider.envKey, hasKey: true, savedAt: record.savedAt, baseUrl: record.baseUrl, model: record.model };
    },

    /** Removes a provider's key. */
    forgetProviderKey({ providerId }) {
      const id = String(providerId ?? "").trim();
      providerById(id);
      const { removed } = forgetGooseProvider(safeStorage, file, id);
      return { id, removed };
    },

    /**
     * A one-time grant of the env a Goose subprocess needs for this provider. The plaintext doesn't come back here:
     * the runner hands the grant to electron/goose-env.cjs, which claims it and starts Goose with the key in its
     * env. So the key never crosses the control server, and the Next server never holds it.
     *
     * baseUrl is the endpoint the runner's setting names. It wins over the copy kept beside the key, because the
     * setting is what the user chose, explicitly.
     *
     * @param {{ providerId: string, baseUrl?: string }} request
     */
    grantEnv({ providerId, baseUrl }) {
      const id = String(providerId ?? "").trim();
      const provider = providerById(id);
      if (!provider) throw new Error(`Goose doesn't know a provider called "${id}".`);
      const record = readGooseProvider(safeStorage, file, id);
      if (!record) throw new Error(`There's no ${provider.label} key saved. Add one first.`);
      const endpoint = String(baseUrl ?? "").trim() || record.baseUrl;
      const env = envForProvider(id, record.token, { baseUrl: endpoint, model: record.model });
      const model = modelFor(id, record);
      const grant = randomId();
      grants.set(grant, { env, until: now() + GRANT_MS });
      return { grant, node: process.execPath, runner: path.join(__dirname, "goose-env.cjs"), model, names: Object.keys(env) };
    },

    /** Used once, by electron/goose-env.cjs. */
    claim(grant) {
      const found = grants.get(String(grant));
      grants.delete(String(grant));
      if (!found || now() > found.until) throw new Error("That grant was already used or has expired.");
      return { env: found.env };
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerGoose(ipcMain, { goose, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Goose only answers the board window.");
      return fn(...args);
    });
  handle("goose:list-providers", () => goose.listProviders());
  handle("goose:set-provider-key", (payload) => goose.setProviderKey(payload && typeof payload === "object" ? payload : {}));
  handle("goose:forget-provider-key", (payload) => goose.forgetProviderKey(payload && typeof payload === "object" ? payload : {}));
}

// The control-server routes: the server's Goose runner asks for a grant and claims it.
function gooseRoutes(goose) {
  return {
    "POST /goose/env-grant": (body) => goose.grantEnv(body && typeof body === "object" ? body : {}),
    "POST /goose/env-claim": (body) => goose.claim(body?.grant),
  };
}

// Wires Goose into Electron main for the board window (board() is its webContents).
function setupGoose({ ipcMain, dataDir, board }) {
  const safeStorage = require("./keychain-audit.cjs").keychainFor("Goose provider keys");
  const goose = createGoose({ dataDir, safeStorage });
  registerGoose(ipcMain, { goose, isBoard: (sender) => Boolean(sender) && sender === board() });
  return { goose };
}

module.exports = { createGoose, registerGoose, gooseRoutes, setupGoose, GRANT_MS };
