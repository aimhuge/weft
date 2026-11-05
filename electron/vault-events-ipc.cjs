// The shared vault's event log over IPC (docs/architecture/teams-vault.md, "What the 🔐 drawer shows"
// and Q14): the drawer's Event log tab reads the last hundred `vault_events` rows of a vault, and
// main pushes the rows that land while the tab is open.
//
// A row says who did what and never carries a value: the query names its columns one by one
// (electron/vault-events.cjs) and leaves out the writer's metadata.
//
// These handlers need the signed-in user's client, so they exist only on a desktop that has one.
const path = require("node:path");
const { createVaultEvents } = require("./vault-events.cjs");

/**
 * @param {{ handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void }} ipcMain
 * @param {{ accountClient: any, dataDir: string, board: () => any, isBoard: (sender: unknown) => boolean }} deps
 */
function registerVaultEvents(ipcMain, { accountClient, dataDir, board, isBoard }) {
  if (!accountClient) return;
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("The vault only answers the board window.");
      return fn(...args);
    });
  const events = createVaultEvents({ accountClient, dir: path.join(dataDir, "vault") });
  const watchers = new Map(); // local vault id -> stop
  // The channel the live feed comes back on: the board window, like every other vault call.
  const send = (channel, payload) => {
    const contents = board();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  };
  // The tab's read: the log, and the rows that landed since the last read (the since-filter).
  handle("vault:events", (id, query) => events.list(String(id), { since: query?.since ?? null, scope: query?.scope === "all" ? "all" : "mine" }));
  // The live feed: the board opens it while the tab is on, and main sends the rows that land.
  handle("vault:events-watch", (id, scope) => {
    const vaultId = String(id);
    const watchScope = scope === "all" ? "all" : "mine";
    watchers.get(vaultId)?.();
    watchers.set(
      vaultId,
      events.watch(vaultId, (rows) => send("vault:events-live", { vaultId, rows }), watchScope),
    );
    return { watching: true };
  });
  // The tab closing stops the feed.
  handle("vault:events-unwatch", (id) => {
    const vaultId = String(id);
    watchers.get(vaultId)?.();
    watchers.delete(vaultId);
    return { watching: false };
  });
}

module.exports = { registerVaultEvents };
