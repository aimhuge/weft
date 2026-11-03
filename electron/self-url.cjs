// Is `url` Weft's own server, given the URL its app view shows (`own`)? localhost and 127.0.0.1 count as
// one host. Only http(s) can be Weft: file:// pages (splash, error page, a thread's ~/.weft/show page)
// have no host or port, so comparing them would make every file:// URL look like Weft.

// A worker card's page, framed through this Mac's server (app/api/worker-board/page/[sha]): the one API route the
// pane loads, for a worker card (components/WorkerPane.tsx). It's the worker's page under its own sandbox CSP, not Weft.
const WORKER_PAGE = /^\/api\/worker-board\/page\/[0-9a-f]{64}$/;

function sameServer(url, own) {
  try {
    if (!own) return null;
    const a = new URL(url);
    const b = new URL(own);
    const web = (u) => u.protocol === "http:" || u.protocol === "https:";
    if (!web(a) || !web(b)) return null;
    const key = (u) => `${u.protocol}//${u.hostname === "localhost" ? "127.0.0.1" : u.hostname}:${u.port}`;
    return key(a) === key(b) ? a : null;
  } catch {
    return null;
  }
}

// A worker card's page on Weft's own server: weft:// links from it are dropped (electron/browser-pane.cjs), as its
// sandboxed frame on the board could never follow one.
function isWorkerPageUrl(url, own) {
  const a = sameServer(url, own);
  return Boolean(a && WORKER_PAGE.test(a.pathname));
}

function isSelfUrl(url, own) {
  const a = sameServer(url, own);
  if (!a) return false;
  // A feature intro (public/intros/<id>.html) is a self-contained video, not Weft's board: the New thread dialog
  // plays its intro in the pane (lib/pane-intro.ts).
  if (/^\/intros\/[\w-]+\.html$/.test(a.pathname)) return false;
  return !WORKER_PAGE.test(a.pathname);
}

module.exports = { isSelfUrl, isWorkerPageUrl, WORKER_PAGE };
