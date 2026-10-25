// Puts the launch's token on the board window's own requests to the local server (lib/guard.ts `sensitive`
// reads it), so a process that merely reaches the port can't read account, settings or services. The browser
// pane has its own session partition and never gets it, so a page a thread opens can't borrow it.
const { PANE_PARTITION } = require("./browser-pane.cjs");

const API_TOKEN_HEADER = "x-weft-token";

function attachApiToken(session, serverUrl, token) {
  const origin = new URL(serverUrl).origin;
  session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: token } });
  });
}

// The pane's pages (a thread's walk-through, a commit page) show card pictures by their /api/attachments URL,
// and an <img> can't send a header, so those GETs 403'd. The pane gets the plain read value "1" there and
// nowhere else: never the launch token, never a write, never another route. The server listens on 127.0.0.1,
// but Next reports its own origin as localhost, so the pile prompt (lib/commit-pile.ts) and most thread pages
// name pictures http://localhost:<port>/…: the filter covers both names for the same port.
function attachPaneAttachments(session, serverUrl) {
  const { protocol, port } = new URL(serverUrl);
  const urls = ["127.0.0.1", "localhost"].map((host) => `${protocol}//${host}:${port}/api/attachments/*`);
  session.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    if (details.method !== "GET" && details.method !== "HEAD") return callback({});
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: "1" } });
  });
}

// Both, once the server is up: the board window's session and the pane's.
function attachTokens(electronSession, serverUrl, token) {
  attachApiToken(electronSession.defaultSession, serverUrl, token);
  attachPaneAttachments(electronSession.fromPartition(PANE_PARTITION), serverUrl);
}

module.exports = { attachApiToken, attachPaneAttachments, attachTokens, API_TOKEN_HEADER };
