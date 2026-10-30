// The browser pane's IPC from the board window (electron/preload.cjs's window.weft.browser), moved out of main.cjs.
// isBoard(sender) says whether a message came from the board window.

function registerPaneIpc(ipcMain, { pane, isBoard }) {
  // A page that won't load (a dev server that isn't running) is shown in the pane; it isn't an error for the board.
  // (L-5) Only the board may open URLs in the pane; a compromised renderer can't pivot it to a fresh host.
  ipcMain.handle("browser:open", (e, url, key) => isBoard(e.sender)
    ? pane.open(url, key || undefined, true, { fromBoard: true }).catch((err) => ({ error: String(err.message || err) }))
    : { error: "Browser pane only answers the board window." });
  ipcMain.handle("browser:state", () => pane.state());
  ipcMain.on("browser:visible", (_e, visible, key) => pane.setVisible(Boolean(visible), key));
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
  // Tabs of the open card's browser (electron/pane-tabs.cjs).
  ipcMain.on("browser:newTab", () => pane.newTab());
  ipcMain.on("browser:selectTab", (_e, id) => pane.selectTab(id));
  ipcMain.on("browser:closeTab", (_e, id) => pane.closeTab(id));
}

module.exports = { registerPaneIpc };
