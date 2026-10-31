// Weft ▸ About Weft: the shell's own window, replacing the native panel (which shows text and
// nothing else). A bundled file:// page, so it opens whether or not the board's server is up.
// Its ipc channels answer this window's page only, and the page can name a fixed target, never a path.
const { BrowserWindow, app, clipboard, ipcMain, nativeTheme, shell } = require("electron");
const path = require("node:path");

const MAX_COPY_CHARS = 20_000;

let aboutWin = null;
let options = { tagline: "", dataDir: () => "", getServer: () => undefined };

function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#131312" : "#f4f3ef";
}

function showAboutWindow() {
  if (aboutWin && !aboutWin.isDestroyed()) {
    aboutWin.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 420,
    height: 560,
    title: "About Weft",
    backgroundColor: backgroundColor(),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "about-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      // Its own jar: this page makes no requests and shares nothing with the board.
      partition: "about",
    },
  });
  aboutWin = win;
  // Nowhere to go. Links on the page ask the main process instead.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (aboutWin === win) aboutWin = null;
  });
  win.loadFile(path.join(__dirname, "about.html"));
}

function fromAbout(event) {
  return Boolean(aboutWin && !aboutWin.isDestroyed() && event.sender === aboutWin.webContents);
}

function registerAboutBridge({ tagline, dataDir, getServer }) {
  options = { tagline, dataDir, getServer };

  ipcMain.handle("weft-about:info", (event) => {
    if (!fromAbout(event)) throw new Error("not available here");
    return {
      // With its server patch when one runs, "0.6.7+abc123" (server-patch.cjs).
      version: require("./server-patch.cjs").versionLabel(app),
      tagline: options.tagline,
      arch: process.arch,
      platform: process.platform,
      packaged: app.isPackaged,
      electron: process.versions.electron ?? "",
      chrome: process.versions.chrome ?? "",
      node: process.versions.node ?? "",
      dataDir: options.dataDir(),
      pid: process.pid,
      serverPort: options.getServer()?.port ?? null,
      serverPid: options.getServer()?.pid ?? null,
    };
  });

  // Two fixed targets: the data folder or the logs folder.
  ipcMain.handle("weft-about:open", (event, which) => {
    if (!fromAbout(event)) return;
    if (which === "data") shell.openPath(options.dataDir());
    else if (which === "logs") shell.openPath(app.getPath("logs"));
  });

  ipcMain.handle("weft-about:copy", (event, text) => {
    if (!fromAbout(event) || typeof text !== "string") return;
    clipboard.writeText(text.slice(0, MAX_COPY_CHARS));
  });
}

module.exports = { showAboutWindow, registerAboutBridge };
