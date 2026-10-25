// A link-preview capture's page bridge (electron/page-snapshot.cjs): the pane's window.weft (electron/pane-preload.cjs)
// with only what reads, so a data mini app draws its numbers in the hidden window. Asking for access or for a secret
// would put a Touch ID prompt behind a window nobody sees, so those answer as the current state or refuse.
const { contextBridge, ipcRenderer } = require("electron");

if (typeof location !== "undefined" && location.protocol === "file:") {
  contextBridge.exposeInMainWorld("weft", {
    access: () => ipcRenderer.invoke("app-data:access"),
    requestAccess: () => ipcRenderer.invoke("app-data:access"),
    revoke: () => Promise.reject(new Error("Not while Weft captures the link preview.")),
    read: (name, args) => ipcRenderer.invoke("app-data:read", String(name ?? ""), args ?? null),
    fetch: (url, init = {}) => {
      const headers = init.headers && typeof init.headers === "object" && !Array.isArray(init.headers) ? init.headers : {};
      return ipcRenderer.invoke("app-data:fetch", {
        url: String(url ?? ""),
        method: String(init.method ?? "GET"),
        headers,
        ...(typeof init.body === "string" ? { body: init.body } : {}),
      });
    },
    env: () => ipcRenderer.invoke("app-data:env"),
    requestSecret: () => Promise.reject(new Error("Not while Weft captures the link preview.")),
  });
}
