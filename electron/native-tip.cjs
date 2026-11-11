// A hover tip drawn in its own small window, for when the board's own bubble (components/Tip.tsx) has no room:
// the browser pane is a native view no page element can rise above, so with the pane right beside the rail a
// rail icon's tip would be squeezed into the rail's 50px. This window floats over the pane instead.
const { BrowserWindow } = require("electron");

const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
const MAX_WIDTH = 260;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function tipPage(text, dark) {
  const [bg, ink, line] = dark ? ["#1c1f26", "#e8eaee", "#3a3f4a"] : ["#ffffff", "#1a1c20", "#d4d7dd"];
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}
#t{display:inline-block;max-width:${MAX_WIDTH}px;box-sizing:border-box;padding:6px 10px;border:1px solid ${line};border-radius:6px;
background:${bg};color:${ink};font:11.5px/1.35 ${FONT};white-space:pre-wrap;word-wrap:break-word}</style><span id="t">${escapeHtml(text)}</span>`;
}

function createNativeTip({ getWindow, nativeTheme }) {
  let tip = null;
  let shown = 0;

  function ensure() {
    if (tip && !tip.isDestroyed()) return tip;
    tip = new BrowserWindow({
      width: MAX_WIDTH, height: 40, show: false, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: true, backgroundColor: "#00000000",
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: { javascript: true, sandbox: true, contextIsolation: true },
    });
    tip.setIgnoreMouseEvents(true);
    tip.setAlwaysOnTop(true, "pop-up-menu");
    return tip;
  }

  // anchor: the trigger's box in the board's page coordinates (CSS px of the window's content).
  async function show(text, anchor) {
    const win = getWindow();
    if (!win || win.isDestroyed() || !text || !anchor) return;
    const ticket = ++shown;
    const view = ensure();
    await view.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(tipPage(text, nativeTheme?.shouldUseDarkColors))}`);
    if (ticket !== shown || view.isDestroyed()) return;
    const size = await view.webContents.executeJavaScript("(() => { const r = document.getElementById('t').getBoundingClientRect(); return [Math.ceil(r.width), Math.ceil(r.height)]; })()");
    if (ticket !== shown || view.isDestroyed()) return;
    const content = win.getContentBounds();
    const [width, height] = size;
    // Right of the trigger, centred on it: the side the pane is on, which is why this window exists.
    const x = Math.round(content.x + anchor.x + anchor.width + 8);
    const y = Math.round(content.y + anchor.y + anchor.height / 2 - height / 2);
    view.setBounds({ x, y, width, height });
    view.showInactive();
  }

  function hide() {
    shown++;
    if (tip && !tip.isDestroyed()) tip.hide();
  }

  return { show, hide, tipPage };
}

// tip:show and tip:hide from the board (electron/preload.cjs's window.weft.tip).
function registerNativeTip(ipcMain, { getWindow, isBoard }) {
  const tip = createNativeTip({ getWindow, nativeTheme: require("electron").nativeTheme });
  ipcMain.on("tip:show", (e, text, anchor) => {
    if (isBoard(e.sender)) void tip.show(String(text).slice(0, 500), anchor).catch(() => {});
  });
  ipcMain.on("tip:hide", () => tip.hide());
  return tip;
}

module.exports = { createNativeTip, registerNativeTip, tipPage };
