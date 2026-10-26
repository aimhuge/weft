// Printing for the board (lib/print-sheet.ts): which printers macOS has, so the welcome offers the shortcut sheet only
// when there's one to print on, and printing that sheet from a hidden window through the system print dialog. Board
// window only. The sheet is plain HTML; its window runs no script.

/**
 * @param {{ BrowserWindow: any }} deps
 * @param {string} html
 */
async function printHtml({ BrowserWindow }, html) {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true, landscape: true }, (ok, reason) =>
        resolve(ok ? { ok: true } : { ok: false, reason: String(reason || "cancelled") }));
    });
  } finally {
    win.destroy();
  }
}

/**
 * @param {{ ipcMain: any, BrowserWindow: any, isBoard: (sender: unknown) => boolean }} deps
 */
function setupPrint({ ipcMain, BrowserWindow, isBoard }) {
  ipcMain.handle("print:printers", async (e) => {
    if (!isBoard(e.sender)) return [];
    const printers = await e.sender.getPrintersAsync().catch(() => []);
    return printers.map((p) => String(p.displayName || p.name));
  });
  ipcMain.handle("print:html", (e, html) => {
    if (!isBoard(e.sender)) return { ok: false, reason: "Printing only answers the board window." };
    if (typeof html !== "string" || !html) return { ok: false, reason: "Nothing to print." };
    return printHtml({ BrowserWindow }, html);
  });
}

module.exports = { setupPrint, printHtml };
