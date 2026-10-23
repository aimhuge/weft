// The frame side of the bridge between a hosted mini app and the page around it (lib/app-bridge.ts,
// docs/architecture/mini-app-hosting.md). The route that serves the app's HTML inserts one inline
// <script> (this module's output) right after <head>, or at the top if there's no <head>. The script
// defines window.weft with the methods a hosted app calls (fetch, read, env, requestSecret, and the Mac's
// access / requestAccess / revoke),
// each posting a BridgeRequest to window.parent and resolving from a matching BridgeResponse.
//
// targetOrigin is the parent's exact origin, not "*": the parent page is on weft.zip (or localhost
// in dev), and only that origin may answer. The frame's origin is opaque because the route's CSP
// is `sandbox` without `allow-same-origin`; the parent postMessages back with "*" because the
// frame's origin IS opaque and postMessage requires an origin or "*".
//
// Each request times out after 30 s, so a stalled server never holds the call forever.
import { BRIDGE_TAG } from "./app-bridge";

// The script's source. Kept as a function (not a constant) so the parent origin is interpolated
// at the time the route serves the page, which is the only place that knows it. The bridge is
// only ever injected into an HTML file at the start of the body, never as a separate <script src>.
export function bridgeScript(parentOrigin: string, timeoutMs = 30_000): string {
  // Fail closed: refuse to build a script that would accept messages from anywhere. A caller that
  // passes an empty string would otherwise produce a script whose PARENT_ORIGIN is "" and
  // matches every window.parent, so any frame the app embeds (or any postMessage from a sibling
  // opener) could answer a bridge call. A noop script defines a noop window.weft with the four
  // methods that always reject — the page still loads, the bridge just doesn't work.
  const safe = safeParentOrigin(parentOrigin);
  const safeOrigin = JSON.stringify(safe);
  const noop = !safe;
  return `window.weft = (function () {
  var TAG = ${JSON.stringify(BRIDGE_TAG)};
  var PARENT_ORIGIN = ${safeOrigin};
  var TIMEOUT = ${timeoutMs};
  var NOOP = ${noop ? "true" : "false"};
  var rejectAll = function (op) { return function () { return Promise.reject(new Error("bridge disabled: no parent origin")); } };
  if (NOOP) return { fetch: rejectAll("fetch"), read: rejectAll("read"), env: rejectAll("env"), requestSecret: rejectAll("requestSecret"), access: rejectAll("access"), requestAccess: rejectAll("access"), revoke: rejectAll("access") };
  var nextId = 1;
  var pending = {};
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (event.origin !== PARENT_ORIGIN) return;
    var data = event.data;
    if (!data || data.tag !== TAG || typeof data.id !== "number") return;
    var p = pending[data.id];
    if (!p) return;
    delete pending[data.id];
    clearTimeout(p.timer);
    if (data.ok) p.resolve(data.result);
    else p.reject(new Error(data.error || "bridge request failed"));
  });
  function send(op, payload) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      var entry = { resolve: resolve, reject: reject, timer: 0 };
      entry.timer = setTimeout(function () {
        delete pending[id];
        reject(new Error(op + " timed out after " + TIMEOUT + "ms"));
      }, TIMEOUT);
      pending[id] = entry;
      var req = { tag: TAG, id: id, op: op };
      for (var k in payload) req[k] = payload[k];
      window.parent.postMessage(req, PARENT_ORIGIN);
    });
  }
  return {
    fetch: function (url, init) {
      init = init || {};
      return send("fetch", {
        url: String(url),
        method: String(init.method || "GET"),
        headers: init.headers || {},
        body: typeof init.body === "string" ? init.body : undefined,
      });
    },
    read: function (name, args) {
      return send("read", { name: String(name), args: args && typeof args === "object" ? args : undefined });
    },
    env: function () { return send("env", {}); },
    requestSecret: function (name) { return send("requestSecret", { name: String(name) }); },
    // The Mac's data-app calls (electron/pane-preload.cjs), so a page written for the Mac runs here too.
    access: function () { return send("access", {}); },
    requestAccess: function () { return send("access", {}); },
    revoke: function () { return send("access", {}); },
  };
})();`;
}

// True when the parent origin is a real origin the script can check messages against. The literal
// "null" is what new URL("about:blank").origin gives: an opaque origin, which the bridge would
// refuse every message from anyway — fail closed at the boundary, return the empty string so the
// bridge is disabled and the script becomes a noop. The literal "null" is the only opaque-origin
// shape URL gives; an empty string is also "no origin".
function safeParentOrigin(origin: string): string {
  if (typeof origin !== "string") return "";
  if (origin === "" || origin === "null") return "";
  return origin;
}

// Insert the bridge script into an HTML document. The route calls this for an HTML file before
// the response is sent. The script is placed right after <head> (or right after <!doctype html>
// when there isn't one) so it runs before the app's own scripts. Any earlier <head> is kept as is;
// the body is untouched. The function is intentionally not a full HTML parser: it does the two
// insertions the route needs and leaves the rest alone.
//
// returns the spliced HTML; returns the input unchanged when the parent origin is empty/null so a
// non-http request (about:blank in a test) can't get a bridge that would accept any origin.
export function injectBridgeScript(html: string, parentOrigin: string, timeoutMs?: number): string {
  if (typeof html !== "string") return html;
  if (!safeParentOrigin(parentOrigin)) return html;
  const script = `<script>${bridgeScript(parentOrigin, timeoutMs)}</script>`;
  // Prefer right after <head>: the <head> is the conventional home for setup scripts. A case-
  // insensitive match covers the rare <HEAD> or <head ...>.
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  // No <head>: insert right after <!doctype html> (or the first <html ...>) so the script runs
  // before any other element in the body. If neither is present, prepend the script (the route
  // is responsible for HTML-shaped content; this is the last-resort fallback).
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  const htmlOpen = /<html[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}

// The parent origin for a request: the request URL's origin (host + scheme + port) so the bridge
// script accepts only messages from the same page that served it. The route knows the host from
// the request's URL; on Vercel the Host header is the canonical one (and matches the request's
// own origin). Returns "" when the URL has no real origin (about:blank, a malformed URL, an
// unsupported scheme); the route refuses to inject the bridge in that case.
export function parentOriginFromRequest(req: Request): string {
  let origin = "";
  try {
    origin = new URL(req.url).origin;
  } catch {
    return "";
  }
  return safeParentOrigin(origin);
}
