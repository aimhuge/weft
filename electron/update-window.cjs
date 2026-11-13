// Weft ▸ Check for Updates…: the Software Update window. Same shape as About (about.cjs): a bundled
// file:// page with its own preload, so it opens whether or not the board's server is up. It shows what
// the updater (updater.cjs) knows, worded by update-view.cjs, and its buttons are fixed actions, never a URL.
const { BrowserWindow, ipcMain, nativeTheme, shell } = require("electron");
const path = require("node:path");
const { updateView } = require("./update-view.cjs");

const RELEASES = "https://github.com/aimhuge/weft/releases";
let updateWin = null;
let updater = null;

function view() {
  return updateView(updater.info());
}

function showUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) {
    updateWin.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 420,
    minHeight: 300,
    title: "Software Update",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#131312" : "#f4f3ef",
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "update-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      partition: "update",
    },
  });
  updateWin = win;
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (updateWin === win) updateWin = null;
  });
  win.loadFile(path.join(__dirname, "update.html"));
}

// The updater's onChange: redraw the window when it's open.
function pushUpdateState() {
  if (updateWin && !updateWin.isDestroyed() && updater) updateWin.webContents.send("weft-update:changed", view());
}

function fromUpdate(event) {
  return Boolean(updateWin && !updateWin.isDestroyed() && event.sender === updateWin.webContents);
}

function registerUpdateBridge(appUpdater) {
  updater = appUpdater;
  ipcMain.handle("weft-update:view", (event) => {
    if (!fromUpdate(event)) throw new Error("not available here");
    return view();
  });
  const actions = {
    check: () => updater.check(),
    install: () => updater.install(),
    download: () => updater.download(),
    pull: () => updater.pull?.(), // dev mode's Update Now (dev-update.cjs)
    releases: () => shell.openExternal(RELEASES),
    close: () => updateWin?.close(),
  };
  ipcMain.handle("weft-update:act", async (event, action) => {
    if (!fromUpdate(event) || !Object.hasOwn(actions, action)) return;
    await actions[action]();
  });
}

module.exports = { showUpdateWindow, pushUpdateState, registerUpdateBridge };
