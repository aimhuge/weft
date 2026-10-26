// weft.liveData for a page in the browser pane (docs/architecture/repo-analysis.md): the page asks
// Weft's own server for a JSON read and gets the JSON back.
//
// Why the page can't just fetch it: a report page is a file: URL, so it has no origin to be same-origin
// with, and Weft's API needs the launch token (lib/guard.ts) that only the desktop app holds. So the
// page asks main, main fetches from the server with the token, and the page never sees the token.
//
// The door is deliberately narrow. `liveData` takes a PATH on Weft's own server, not a URL: there is no
// host to get wrong, so a page can't use it to reach anything else. Only GET, only paths under
// /api/, and only the ones this bridge is given. A page that asks for anything else gets an error, and
// the page can show that rather than a number it couldn't read.

const { senderOk } = require("./app-data-frame.cjs");

// The paths a page may ask for. Kept here, in main, so the page can't widen it.
const ALLOWED = ["/api/infra/live"];

function cleanPath(raw) {
  if (typeof raw !== "string" || !raw) throw new Error("A path is required.");
  // Only a path: no scheme, no host, no "//" that could read as one.
  if (!raw.startsWith("/") || raw.startsWith("//")) throw new Error("Only a path on Weft's own server is allowed.");
  if (raw.includes("..")) throw new Error("Only a path on Weft's own server is allowed.");
  if (!ALLOWED.includes(raw)) throw new Error(`${raw} isn't a live read this page may ask for.`);
  return raw;
}

function createLiveData({ serverUrl, token, fetch: fetchImpl = globalThis.fetch }) {
  // The server may not be up when main wires this, so both may be a callback or a plain value.
  const urlOf = () => (typeof serverUrl === "function" ? serverUrl() : serverUrl);
  const tokenOf = () => (typeof token === "function" ? token() : token);
  return async function liveData(rawPath) {
    const path = cleanPath(rawPath);
    const base = urlOf();
    if (!base) return { ok: false, error: "Weft's server isn't running." };
    const headers = {};
    const tok = tokenOf();
    if (tok) headers["x-weft-token"] = tok;
    const res = await fetchImpl(new URL(path, base), { method: "GET", headers });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: `Weft's server answered ${res.status} with something that isn't JSON.` };
    }
    if (!res.ok) return { ok: false, error: body?.error ?? `Weft's server answered ${res.status}.`, status: res.status };
    return { ok: true, data: body };
  };
}

// The IPC handler. Same sender check as the app-data bridge: only the pane's own main frame.
function registerLiveData(ipcMain, { liveData, owns }) {
  ipcMain.handle("live-data:read", async (event, path) => {
    if (!senderOk(owns, event)) throw new Error("Live data only answers the pane's main frame.");
    return liveData(path);
  });
}

function setupLiveData({ ipcMain, serverUrl, token, owns, fetch: fetchImpl }) {
  const liveData = createLiveData({ serverUrl, token, fetch: fetchImpl });
  registerLiveData(ipcMain, { liveData, owns });
  return liveData;
}

module.exports = { setupLiveData, createLiveData, registerLiveData, cleanPath, ALLOWED };
