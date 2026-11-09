// The copilot's own window (behind the WEFT_COPILOT flag, ./features.cjs): placed at the main window's bottom
// right the first time, remembered after; closing hides it so it reopens instantly with the conversation in place.
// The board hears "copilot:state" { open } whenever it shows, hides or goes away. Moved out of main.cjs.
const { loadWindowState, trackWindowState } = require("./window-state.cjs");

/**
 * @param {{ app: any, BrowserWindow: any, mac: boolean, preload: string, background: () => string,
 *   main: () => any, board: () => any, server: () => any, pane: any, menus: () => any, quitting: () => boolean }} deps
 */
function createCopilotWindow(deps) {
  /** @type {any} */
  let copilotWin;
  const alive = () => Boolean(copilotWin && !copilotWin.isDestroyed());

  function sendState() {
    const open = alive() && copilotWin.isVisible();
    const board = deps.board();
    if (board && !board.webContents.isDestroyed()) board.webContents.send("copilot:state", { open });
  }

  function create() {
    const main = deps.main()?.getBounds() ?? { x: 80, y: 80, width: 1400, height: 900 };
    const state = loadWindowState("copilot", {
      width: 420,
      height: 680,
      x: Math.max(0, main.x + main.width - 444),
      y: Math.max(0, main.y + main.height - 704),
    });
    copilotWin = new deps.BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: 340,
      minHeight: 420,
      title: "Copilot",
      show: false,
      backgroundColor: deps.background(),
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 15 },
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true },
    });
    trackWindowState("copilot", copilotWin);
    copilotWin.webContents.setWindowOpenHandler(({ url }) => {
      deps.pane.open(url, undefined, false, { fromBoard: true }).catch(() => {});
      return { action: "deny" };
    });
    deps.menus().attachContextMenu(copilotWin.webContents);
    copilotWin.on("close", (event) => {
      if (!deps.quitting()) {
        event.preventDefault();
        copilotWin.hide();
      }
    });
    copilotWin.on("show", sendState);
    copilotWin.on("hide", sendState);
    copilotWin.on("closed", () => {
      copilotWin = undefined;
      sendState();
    });
    copilotWin.loadURL(`${deps.server().url}/copilot`);
  }

  function show() {
    if (!deps.server()) return;
    if (!alive()) create();
    copilotWin.show();
    copilotWin.focus();
    if (deps.mac) deps.app.focus({ steal: true });
    sendState();
  }

  function toggle() {
    if (alive() && copilotWin.isVisible() && copilotWin.isFocused()) {
      copilotWin.hide();
      sendState();
    } else {
      show();
    }
  }

  return {
    show,
    toggle,
    webContents: () => (alive() ? copilotWin.webContents : undefined),
    setBackgroundColor: (/** @type {string} */ color) => alive() && copilotWin.setBackgroundColor(color),
  };
}

module.exports = { createCopilotWindow };
