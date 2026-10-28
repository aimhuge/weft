// The vault's IPC handlers for the board window (electron/vault.cjs sets them up): the 🔐 drawer's calls, the card
// menu's grants (electron/vault-grants.cjs) and Settings → Security's audit log (electron/keychain-audit.cjs).
const { auditStatus, readAudit } = require("./keychain-audit.cjs");
const { registerVaultEvents } = require("./vault-events-ipc.cjs");

/**
 * @param {{ handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void }} ipcMain
 * @param {{ vault: any, isBoard: (sender: unknown) => boolean, board?: () => any, dataDir?: string,
 *   accountClient?: (() => any) | null,
 *   shared?: { grantPending: (opts: any) => Promise<unknown>, shareLocal: (opts: any) => Promise<unknown>, rotate?: (opts: any) => Promise<unknown> } | null }} deps
 */
function registerVault(ipcMain, { vault, isBoard, board = null, dataDir = "", accountClient = null, shared = null }) {
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
  // The shared vault's cross-device flow (docs/architecture/teams-vault.md, "Granting a teammate's
  // devices"). These are not the thread grants above: `vault:grant` hands a card's thread access to
  // a local vault for an hour, while `vault:device-grant` seals the vault key to a teammate's
  // machine so it can open the shared vault at all.
  //
  // Both need the signed-in user's client, so they only exist on a desktop that has one.
  if (accountClient && shared) {
    handle("vault:device-grant", (pendingId) => shared.grantPending({ pendingId: String(pendingId), accountClient: accountClient() }));
    handle("vault:share", (folder, orgId, repo, label) => shared.shareLocal({ folder: String(folder), orgId: String(orgId), repo: String(repo), label: label ? String(label) : undefined, accountClient: accountClient() }));
    // A shared vault's rotate (docs/architecture/teams-vault.md, "Removal and rotation"): the new key
    // is made here, in main, because that is the only place a vault key exists. The plan — sealed
    // boxes, ciphertext, names — goes to weft.zip, which writes it. The key never leaves this process.
    if (shared.rotate) {
      handle("vault:rotate", (org, userId) => shared.rotate({ org: String(org), userId: String(userId), accountClient: accountClient() }));
    }
  }
  // The shared vault's event log, for the drawer's Event log tab: the last hundred rows of a vault
  // and the live feed that appends them (electron/vault-events-ipc.cjs). It needs the board window
  // to push the rows that land, and the signed-in user's client to read them.
  if (accountClient && board) {
    registerVaultEvents(ipcMain, { accountClient: accountClient(), dataDir, board, isBoard });
  }
  // The shared vault's recovery key (electron/vault-recovery.cjs): the 24 words the user writes
  // down. The vault key is unwrapped in main, the Touch ID gate is here, and the words go back to
  // the board once — nothing else keeps them. It needs the signed-in user's client to write the
  // recovery rows, so it only exists on a desktop that has one.
  if (accountClient && vault?.recovery) {
    handle("vault:recovery-show", (vaultId, passphrase) =>
      vault.recovery.show({ vaultId: String(vaultId), passphrase: typeof passphrase === "string" ? passphrase : "" }),
    );
    handle("vault:recovery-status", (vaultId) => vault.recovery.status({ vaultId: String(vaultId) }));
  }
}

module.exports = { registerVault };
