const { contextBridge, ipcRenderer } = require("electron");

// The dictation pill's only door into the shell (electron/dictation-helper.cjs): commands in, its state and the text out.
// It is window.weftPill, not window.weft, so nothing on the page mistakes the pill for the board.
contextBridge.exposeInMainWorld("weftPill", {
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("dictation:command", listener);
    return () => ipcRenderer.off("dictation:command", listener);
  },
  state: (update) => ipcRenderer.send("dictation:state", update),
  text: (text) => ipcRenderer.invoke("dictation:text", text),
  hide: () => ipcRenderer.send("dictation:hide"),
});
