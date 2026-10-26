// The mini-app wiring, as main.cjs calls it: the sealed vault, the pane's frame ownership, the
// board-window check and the local server's address, gathered into the one call
// electron/app-setup.cjs takes.
//
// Lives in its own file so main.cjs stays under its line cap: the glue is main's business (it
// knows the window, the pane and the server), but the call itself is not worth a line there.

const { setupApps } = require("./app-setup.cjs");
const { serverInfo } = require("./server-info.cjs");

/**
 * Wires the mini-app modules for main.
 *
 * @param {object} opts
 * @param {object} opts.ipcMain Electron's ipcMain
 * @param {object} opts.vault the sealed vault (electron/vault.cjs)
 * @param {string} opts.dataDir the storage folder
 * @param {(wc: unknown) => boolean} opts.ownsPane whether a webContents is the pane's own
 * @param {(sender: unknown) => boolean} opts.isBoard whether a sender is the board window
 * @param {(folder: string) => Promise<{ ref: string } | null>} opts.supabaseReadLink the linked Supabase project
 * @param {() => object} opts.getSafeStorage Electron's safeStorage, once app is ready
 * @param {() => { url: string } | null} opts.getServer the running local server
 * @param {string} opts.token the launch token
 * @returns {{ account: () => Record<string, string> }} the handle main keeps
 */
function setupMiniApps({ ipcMain, vault, dataDir, ownsPane, isBoard, supabaseReadLink, getSafeStorage, getServer, token }) {
  return setupApps({
    ipcMain,
    vault,
    dataDir,
    ownsPane,
    isBoard,
    supabaseReadLink,
    getSafeStorage,
    server: serverInfo(getServer, token),
  });
}

module.exports = { setupMiniApps };
