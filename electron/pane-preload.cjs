// The browser pane's page bridge for data mini apps (docs/architecture/mini-apps.md and
// docs/architecture/mini-app-hosting.md): exposes window.weft on file: pages only. The methods
// land in Electron main's app-data.cjs (access, requestAccess, revoke, read) or
// app-data-fetch.cjs (fetch, env, requestSecret), which check the sender's frame, realpath,
// manifest and grant before doing anything; this preload is just a typed door that never runs
// outside a `file:` URL. A page on https:// or about: never sees window.weft and falls back to
// its "Open this app in Weft on your Mac to load its data." message.
const { contextBridge, ipcRenderer } = require("electron");

// We only expose on a `file:` page; WebKit reports the URL through the standard location.
if (typeof location !== "undefined" && location.protocol === "file:") {
  contextBridge.exposeInMainWorld("weft", {
    access: () => ipcRenderer.invoke("app-data:access"),
    requestAccess: () => ipcRenderer.invoke("app-data:request"),
    revoke: () => ipcRenderer.invoke("app-data:revoke"),
    read: (name, args) => ipcRenderer.invoke("app-data:read", String(name ?? ""), args ?? null),
    // Hosted-app bridge: a fetched call (a request the app's policy allows), the manifest's
    // public values, and a viewer-provided secret's set-or-not answer.
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
    requestSecret: (name) => ipcRenderer.invoke("app-data:request-secret", String(name ?? "")),
    // Live read: a JSON GET on Weft's own server (electron/live-data.cjs). The page names a PATH,
    // never a URL; main holds the launch token and does the fetch, so the page never sees it.
    liveData: (path) => ipcRenderer.invoke("live-data:read", String(path ?? "")),
    // The simulator's live view (electron/sim-live.cjs): the device's window to capture, and the
    // clicks on it sent back as taps. Main answers only Weft's own viewer pages.
    simLive: {
      source: (deviceName) => ipcRenderer.invoke("sim-live:source", String(deviceName ?? "")),
      input: (body) => ipcRenderer.invoke("sim-live:input", body ?? null),
    },
  });
}
