// The browser pane's IPC from the board (window.weft.browser, electron/preload.cjs) to electron/browser-pane.cjs.
module.exports = function registerBrowserIpc({ ipcMain, pane, getBoardContents }) {
  const fromBoard = (e) => Boolean(e?.sender) && e.sender === getBoardContents();
  // A page that won't load (a dev server that isn't running) is shown in the pane; it isn't an error for the board.
  // (L-5) Only the board may open URLs in the pane; a compromised renderer can't pivot it to a fresh host.
  ipcMain.handle("browser:open", (e, url, key) => fromBoard(e)
    ? pane.open(url, key || undefined, true, { fromBoard: true }).catch((err) => ({ error: String(err.message || err) }))
    : { error: "Browser pane only answers the board window." });
  ipcMain.handle("browser:state", () => pane.state());
  ipcMain.on("browser:visible", (_e, visible) => pane.setVisible(Boolean(visible)));
  ipcMain.on("browser:active", (_e, key) => pane.setActive(key));
  ipcMain.on("browser:prune", (_e, keys) => pane.prune(Array.isArray(keys) ? keys : []));
  // The board measures in its own CSS pixels; once it's zoomed (View > Zoom In/Out) those no longer
  // match window pixels, so scale by its zoom factor or the native view lands off its placeholder.
  ipcMain.on("browser:bounds", (e, rect) => {
    const z = e.sender.getZoomFactor();
    pane.setBounds({ x: rect.x * z, y: rect.y * z, width: rect.width * z, height: rect.height * z });
  });
  ipcMain.on("browser:back", () => pane.back());
  ipcMain.on("browser:forward", () => pane.forward());
  ipcMain.on("browser:reload", () => pane.reload());
  ipcMain.on("browser:zoom", (_e, action) => pane.zoom(action));
  // Find in page (electron/pane-find.cjs): the board's find bar only.
  ipcMain.on("browser:find", (e, text, opts) => {
    if (fromBoard(e)) pane.find(String(text ?? ""), { forward: opts?.forward !== false, next: Boolean(opts?.next) });
  });
  ipcMain.on("browser:stop-find", (e) => {
    if (fromBoard(e)) pane.stopFind();
  });
};
