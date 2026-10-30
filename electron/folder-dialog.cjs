// The board's "choose a folder" dialog (Add project, a worker's folder): the native picker over the main window,
// resolving to the folder or null when cancelled. Moved out of main.cjs to keep it under its size cap.
function registerFolderDialog(ipcMain, { dialog, window }) {
  ipcMain.handle("dialog:openFolder", async () => {
    const result = await dialog.showOpenDialog(window(), { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
}

module.exports = { registerFolderDialog };
