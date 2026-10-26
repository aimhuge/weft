// The vault's IPC handlers for the board window (electron/vault.cjs sets them up): the 🔐 drawer's calls, the card
// menu's grants (electron/vault-grants.cjs) and Settings → Security's audit log (electron/keychain-audit.cjs).
const { auditStatus, readAudit } = require("./keychain-audit.cjs");

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerVault(ipcMain, { vault, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("The vault only answers the board window.");
      return fn(...args);
    });
  handle("vault:overview", (folders) => vault.overview(Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : []));
  handle("vault:scan", (folder) => vault.scan(String(folder)));
  handle("vault:import", (folder, picks) => vault.importPicks(String(folder), Array.isArray(picks) ? picks : [], { by: "you" }));
  handle("vault:reveal", (id, name, env) => vault.reveal(String(id), String(name), String(env)));
  handle("vault:copy", (id, name, env) => vault.copy(String(id), String(name), String(env)));
  handle("vault:set", (folder, name, env, value) => vault.setValue(String(folder), String(name), String(env), String(value ?? "")));
  handle("vault:add-blank", (folder, name, env) => vault.addBlanks(String(folder), [String(name)], [String(env)], { source: "added blank", by: "you" }));
  handle("vault:copy-to", (id, name, env, folder) => vault.copyTo(String(id), String(name), String(env), String(folder)));
  handle("vault:remove", (id, name, env) => vault.remove(String(id), String(name), String(env)));
  handle("vault:write-back", (folder) => vault.writeBack(String(folder)));
  handle("vault:lock", () => vault.lock());
  // Threads' standing access (vault-grants.cjs) and the audit log (keychain-audit.cjs), for the drawer's Activity and the card menu.
  handle("vault:grants", () => vault.grantList());
  handle("vault:grant", (folder, card, thread) => vault.grant(String(folder), { card: String(card), thread: thread ? String(thread) : undefined, by: "you" }));
  handle("vault:revoke", (card, id) => vault.revoke(String(card), id === undefined || id === null ? undefined : String(id), "you"));
  handle("vault:activity", (limit) => ({ entries: readAudit(Number(limit) || undefined), ...auditStatus() }));
}

module.exports = { registerVault };
