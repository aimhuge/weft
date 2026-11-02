// What the browser pane accepts as an address, and how it reports a tab. Pure, so it's tested without Electron.
const { failedUrl } = require("./pane-error.cjs");

const OPENS_AS_IS = /^(https?|file|about):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_AND_PORT = /^[^\s/:]+:\d+([/?#]|$)/;
const HOST = /^(localhost|\[::1\]|[^\s/?#]+\.[^\s/?#.]+)([:/?#]|$)/i;

function normalizeUrl(raw) {
  const url = String(raw || "").trim();
  if (OPENS_AS_IS.test(url)) return url;
  if (/^(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)) return `http://${url}`;
  if (HOST_AND_PORT.test(url)) return `https://${url}`;
  if (HAS_SCHEME.test(url)) throw new Error(`Can't open ${url} in the browser pane`);
  return `https://${url}`;
}

// What the user typed in the address bar: an address, or else a Google search. Threads keep to
// normalizeUrl, so a thread's bad address fails out loud rather than landing on a results page.
function addressBarUrl(raw) {
  const text = String(raw || "").trim();
  if (OPENS_AS_IS.test(text)) return text;
  if (!/\s/.test(text) && (HAS_SCHEME.test(text) || HOST.test(text))) return normalizeUrl(text);
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

// One tab for the tab strip (components/PaneTabs.tsx). On the error page it keeps the address that failed.
function tabState({ id, view }) {
  const url = view.webContents.getURL();
  return { id, url: failedUrl(url) ?? url, title: view.webContents.getTitle() };
}

module.exports = { addressBarUrl, normalizeUrl, tabState };
