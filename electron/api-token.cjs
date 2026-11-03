// Puts the launch's token on the board window's own requests to the local server (lib/guard.ts `sensitive`
// reads it), so a process that merely reaches the port can't read account, settings or services. The browser
// pane has its own session partition and never gets it, so a page a thread opens can't borrow it.
const { PANE_PARTITION } = require("./browser-pane.cjs");
const { WORKER_PAGE } = require("./self-url.cjs");

const API_TOKEN_HEADER = "x-weft-token";

// A frame inside the board window is somebody's page, and only the board itself is the launch token's owner. So a
// frame's own load and everything it asks for go without it. A sandboxed frame's origin reads "null", which still
// holds once its frame object is gone; a frame we can't read any more counts as one.
function fromFrame({ resourceType, initiatorOrigin, frame }) {
  if (resourceType === "subFrame" || initiatorOrigin === "null") return true;
  try {
    return Boolean(frame?.parent);
  } catch {
    return true;
  }
}

// The one local route a frame loads: a worker card's page (components/web-board/WebPane.tsx). It gets the plain read
// value, as the pane gets for a picture; the intros and the welcome loop are static files and need nothing.
function frameHeaders({ method, url, requestHeaders }) {
  const { [API_TOKEN_HEADER]: _sent, ...rest } = requestHeaders;
  return method === "GET" && WORKER_PAGE.test(new URL(url).pathname) ? { ...rest, [API_TOKEN_HEADER]: "1" } : rest;
}

function attachApiToken(session, serverUrl, token) {
  const origin = new URL(serverUrl).origin;
  session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    if (fromFrame(details)) return callback({ requestHeaders: frameHeaders(details) });
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: token } });
  });
}

// The pane's pages (a thread's walk-through, a commit page) show card pictures by their /api/attachments URL,
// and an <img> can't send a header, so those GETs 403'd. The pane gets the plain read value "1" there and
// nowhere else: never the launch token, never a write, never another route. The server listens on 127.0.0.1,
// but Next reports its own origin as localhost, so the pile prompt (lib/commit-pile.ts) and most thread pages
// name pictures http://localhost:<port>/…: the filter covers both names for the same port. A worker card's page
// (components/WorkerPane.tsx) loads in the pane the same way: GET /api/worker-board/page/<sha> and nothing else
// under that route, as its frame on the board gets it above.
const PANE_READS = ["/api/attachments/*", "/api/worker-board/page/*"];

function paneRead({ method, url }) {
  if (method !== "GET" && method !== "HEAD") return false;
  const { pathname } = new URL(url);
  return pathname.startsWith("/api/attachments/") || (method === "GET" && WORKER_PAGE.test(pathname));
}

function attachPaneAttachments(session, serverUrl) {
  const { protocol, port } = new URL(serverUrl);
  const urls = PANE_READS.flatMap((route) => ["127.0.0.1", "localhost"].map((host) => `${protocol}//${host}:${port}${route}`));
  session.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    if (!paneRead(details)) return callback({});
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: "1" } });
  });
}

// Both, once the server is up: the board window's session and the pane's.
function attachTokens(electronSession, serverUrl, token) {
  attachApiToken(electronSession.defaultSession, serverUrl, token);
  attachPaneAttachments(electronSession.fromPartition(PANE_PARTITION), serverUrl);
}

module.exports = { attachApiToken, attachPaneAttachments, attachTokens, API_TOKEN_HEADER };
