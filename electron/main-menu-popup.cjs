// The board's right-click menus (lib/card-menu.ts): shown natively so the narrow board never clips
// them. Resolves to the picked item's id, or null when dismissed. click fires before callback on
// macOS, but not on every platform; the setTimeout in the callback waits a tick for it to land.
// Menu and BrowserWindow are injected so tests can pass mocks without a real Electron.
function createMenuPopup({ ipcMain, Menu, BrowserWindow }) {
  ipcMain.handle("menu:popup", (e, items) =>
    new Promise((resolve) => {
      let picked = null;
      const template = (Array.isArray(items) ? items : []).map((item) =>
        item.type === "separator"
          ? { type: "separator" }
          : {
              label: String(item.label),
              enabled: item.enabled !== false,
              ...(typeof item.checked === "boolean" ? { type: "checkbox", checked: item.checked } : {}),
              // A dimmer second line on the item (Electron's sublabel), for the status it carries.
              ...(item.detail ? { sublabel: String(item.detail) } : {}),
              // Drawn beside the item, and live while the menu is open (a popup's keys go away with it).
              ...(item.accelerator ? { accelerator: String(item.accelerator) } : {}),
              click: () => (picked = String(item.id)),
            },
      );
      Menu.buildFromTemplate(template).popup({
        window: BrowserWindow.fromWebContents(e.sender) ?? undefined,
        callback: () => setTimeout(() => resolve(picked), 0),
      });
    }),
  );
}

module.exports = { createMenuPopup };
