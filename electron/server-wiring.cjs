// The wiring that needs two things main has and the modules don't: the running server and the
// board window's webContents.
//
// Four modules want them — the provider drawers (electron/providers.cjs), the server supervisor's
// IPC (electron/server-ipc.cjs), the splash screen's IPC (electron/startup-ipc.cjs) and Keep
// Working (electron/keep-working-ipc.cjs). Each takes the same `getServer` / `getBoardContents`
// pair, so the pair is built once here and main.cjs gets one call instead of four blocks.
//
// Lives in its own file so main.cjs stays under its line cap.

const { serverInfo } = require("./server-info.cjs");

/**
 * Wires the server-dependent modules for main.
 *
 * @param {object} opts
 * @param {object} opts.ipcMain Electron's ipcMain
 * @param {string} opts.dataDir the storage folder
 * @param {object} opts.shell Electron's shell
 * @param {object} opts.app Electron's app
 * @param {object} opts.timer the startup timer
 * @param {object} opts.boot the boot record
 * @param {object} opts.startup the startup screen
 * @param {() => object} opts.getServer the running local server
 * @param {() => object} opts.getBoardContents the board window's webContents
 * @param {() => object} opts.getMenus the menus
 * @param {() => object} opts.keepWorking the Keep Working feature
 * @param {() => object} opts.getHandleLink the handle-link opener
 * @param {string} opts.token the launch token
 * @param {Function} [opts.setupProviders] the provider drawers' setup; defaults to
 *   electron/providers.cjs. The seam exists so a test can wire the rest without Electron's app.
 * @returns {{ blastcpApi: object, slackApi: object, gooseApi: object }} the provider APIs
 */
function setupServerWiring({ ipcMain, dataDir, shell, app, timer, boot, startup, getServer, getBoardContents, getMenus, keepWorking, getHandleLink, token, setupProviders }) {
  // The server's url and launch token, read fresh (the server may not be up yet).
  const server = serverInfo(getServer, token);

  // BlastCP, Cloudflare, Slack and Goose, each with its secret in the Keychain (electron/providers.cjs).
  const providers = (setupProviders ?? require("./providers.cjs").setupProviders)({
    ipcMain, dataDir, board: getBoardContents, server,
  });

  // Keep Working (electron/keep-working.cjs): the board's Settings → General → Laptop mode card.
  require("./keep-working-ipc.cjs")({ ipcMain, keepWorking, getBoardContents });

  // Server supervisor IPC (electron/server-ipc.cjs): the board's ServerErrorBar calls server:retry
  // to relaunch, server:open-logs to reveal the log, and weft:create-fix-card to queue a New
  // thread dialog with the fatal + log tail pre-filled (lib/server-status.ts).
  require("./server-ipc.cjs")({
    ipcMain,
    shell,
    getServer,
    getBoardContents,
    getHandleLink,
    logPath: () => getServer()?.logPath,
  });

  // Splash IPC: the start screen's button row, the launch timing handshake and the dock badge count
  // (electron/startup-ipc.cjs). server and menus are getters: they're set later, at boot.
  require("./startup-ipc.cjs")({ ipcMain, app, shell, timer, boot, startup, getServer, getMenus });

  return providers;
}

module.exports = { setupServerWiring };
