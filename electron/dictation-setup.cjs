// Wires dictate-anywhere into the shell (docs/architecture/dictation.md#anywhere): the helper (hotkey, Esc, the floating
// pill) and where its text goes (./dictation-insert.cjs). The pill's state is relayed to the board and the copilot, so
// their mic buttons show the recording too.
const { BaseWindow, BrowserWindow, clipboard, globalShortcut, screen, systemPreferences, webContents } = require("electron");
const { execFile } = require("node:child_process");
const { createDictationHelper } = require("./dictation-helper.cjs");
const { createDictationInsert } = require("./dictation-insert.cjs");

function setupDictation({ ipcMain, getServer, listeners }) {
  const deliver = createDictationInsert({ clipboard, systemPreferences, BaseWindow, webContents, execFile });
  const broadcast = (channel, payload) => {
    for (const contents of listeners()) if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  };
  return createDictationHelper({ BrowserWindow, globalShortcut, screen, ipcMain, getServer, deliver, broadcast });
}

module.exports = { setupDictation };
