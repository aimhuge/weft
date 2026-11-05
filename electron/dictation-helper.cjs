// Dictate anywhere (docs/architecture/dictation.md#anywhere): the dictation key is a system-wide hotkey, and the
// recording runs in a small floating pill (app/dictate) above every app, Space and full-screen window. The pill never
// takes focus, so the field you were typing in keeps its caret; the text goes there through ./dictation-insert.cjs.
//
// main ⇄ pill: main sends "toggle" or "cancel"; the pill reports its state ({ state, seconds, level }), hands over the
// text (main answers how it arrived) and asks to hide once its last word ("Pasted", an error) has been on screen.
const path = require("node:path");

const DEFAULT_SHORTCUT = "Alt+'";
const PILL = { width: 240, height: 64 };
// Below the menu bar, at the top centre of the screen the mouse is on.
const TOP_GAP = 8;

function pillBounds(screen) {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return {
    x: Math.round(workArea.x + (workArea.width - PILL.width) / 2),
    y: workArea.y + TOP_GAP,
    ...PILL,
  };
}

function createDictationHelper({ BrowserWindow, globalShortcut, screen, ipcMain, getServer, deliver, broadcast, mac = process.platform === "darwin" }) {
  let pill;
  let ready = false;
  // Commands sent before the pill's page finished loading (the first press after launch).
  let queued = [];
  let shortcut = null;
  let escapeHeld = false;
  let state = "idle";
  // The server the pill's page came from; a restarted server can come back on another port.
  let loadedFrom = null;

  function create() {
    const server = getServer();
    if (!server) return null;
    ready = false;
    queued = [];
    pill = new BrowserWindow({
      ...PILL,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      // An NSPanel: it takes clicks (the stop square) without making Weft the active app.
      ...(mac ? { type: "panel" } : {}),
      backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "dictation-preload.cjs"), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    const made = pill;
    pill.setAlwaysOnTop(true, "screen-saver");
    pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    pill.webContents.on("did-finish-load", () => {
      if (pill !== made) return;
      ready = true;
      for (const command of queued) made.webContents.send("dictation:command", command);
      queued = [];
    });
    made.on("closed", () => {
      // A pill replaced after a server restart closes after its successor exists.
      if (pill !== made) return;
      pill = undefined;
      ready = false;
      queued = [];
      setState("idle");
    });
    loadedFrom = server.url;
    void pill.loadURL(`${server.url}/dictate`);
    return pill;
  }

  function send(command) {
    if (!pill || pill.isDestroyed()) return;
    if (ready) pill.webContents.send("dictation:command", command);
    else queued.push(command);
  }

  function holdEscape(hold) {
    if (hold === escapeHeld) return;
    escapeHeld = hold;
    // Esc is only taken while the mic is open, so every other app keeps it the rest of the time.
    if (hold) globalShortcut.register("Escape", () => send("cancel"));
    else globalShortcut.unregister("Escape");
  }

  function setState(next) {
    state = next;
    holdEscape(next === "recording");
  }

  function toggle() {
    const server = getServer();
    if (server && pill && !pill.isDestroyed() && server.url !== loadedFrom && state === "idle") pill.destroy();
    if (!pill || pill.isDestroyed()) {
      if (!create()) return;
    }
    if (!pill.isVisible()) {
      pill.setBounds(pillBounds(screen));
      pill.showInactive();
    }
    send("toggle");
  }

  // The board's dictation key, as an Electron accelerator; it may change any time in Settings → Shortcuts.
  function setShortcut(accelerator) {
    const next = accelerator || DEFAULT_SHORTCUT;
    if (next === shortcut) return true;
    if (shortcut) globalShortcut.unregister(shortcut);
    shortcut = null;
    try {
      if (!globalShortcut.register(next, toggle)) {
        console.warn(`Couldn't register ${next} for dictation; another app may be using it.`);
        return false;
      }
    } catch (err) {
      console.warn(`${next} isn't a key Weft can register for dictation: ${err.message}`);
      return false;
    }
    shortcut = next;
    return true;
  }

  const fromPill = (event) => Boolean(pill && !pill.isDestroyed() && event.sender === pill.webContents);

  ipcMain.on("dictation:state", (event, update) => {
    if (!fromPill(event)) return;
    setState(update?.state ?? "idle");
    broadcast("dictation:state", update);
  });
  ipcMain.handle("dictation:text", (event, text) => (fromPill(event) && typeof text === "string" && text ? deliver(text) : "copied"));
  ipcMain.on("dictation:hide", (event) => {
    if (fromPill(event) && state === "idle") pill.hide();
  });
  ipcMain.on("dictation:toggle", () => toggle());
  ipcMain.on("dictation:cancel", () => send("cancel"));
  ipcMain.on("dictation:shortcut", (_event, accelerator) => setShortcut(typeof accelerator === "string" ? accelerator : ""));

  return {
    toggle,
    setShortcut,
    // Once the server is up: the default key until the board sends its own, and the pill loaded ahead of the first
    // press so it doesn't wait on the page.
    start: () => {
      // The board may have sent its own key while its page loaded; that one stays.
      if (!shortcut) setShortcut();
      if (!pill) create();
    },
    state: () => state,
  };
}

module.exports = { createDictationHelper, pillBounds, DEFAULT_SHORTCUT, PILL };
