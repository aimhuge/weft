// One Chrome DevTools Protocol session per pane page (webContents.debugger), shared by everything that needs
// CDP: the agent tools' trusted input and accessibility snapshot (electron/pane-input.cjs), and the console and
// network buffers below. Electron allows one debugger client per webContents, so nothing else may attach;
// anything new (a screencast, say) asks this module for send() and on().
//
// Attached when the pane creates a page's view, so messages from the first load are caught. The enables are
// sent without waiting: a view that hasn't navigated yet doesn't answer them until it does. Opening DevTools on
// the page detaches us; the next call attaches again (docs/architecture/agent-browser.md).

const PROTOCOL = "1.3";
// Ring buffers per page: enough for a dev server's noisy start, small enough to keep in memory for every card.
const MAX_ENTRIES = 200;
const MAX_TEXT = 1000;

// A console argument as text: strings and numbers as-is, objects by their preview's description.
function argText(arg) {
  if (!arg) return "";
  if (arg.type === "string") return String(arg.value);
  if ("value" in arg) return JSON.stringify(arg.value);
  if (arg.unserializableValue) return arg.unserializableValue;
  return arg.description || arg.className || arg.type || "";
}

function where(frame) {
  if (!frame?.url) return "";
  return `${frame.url}:${(frame.lineNumber ?? 0) + 1}`;
}

const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

function consoleCall(params) {
  // Format strings ("%cbold") keep their first argument; the styles that follow aren't worth the tokens.
  const styled = /%c/.test(String(params.args?.[0]?.value ?? ""));
  const args = (params.args ?? []).filter((a, i) => !(i > 0 && styled && a.type === "string"));
  const at = where(params.stackTrace?.callFrames?.[0]);
  // Electron's own dev-mode warnings (insecure CSP and the like) land in every page; they aren't the page's.
  if (at.startsWith("node:electron/")) return undefined;
  const level = params.type === "warning" ? "warn" : params.type;
  return { level, text: clip(args.map(argText).join(" ").replace(/%c/g, "")), at };
}

function exceptionThrown(params) {
  const d = params.exceptionDetails ?? {};
  const text = d.exception?.description || d.text || "Uncaught exception";
  return { level: "error", text: clip(`Uncaught ${text}`), at: where({ url: d.url, lineNumber: d.lineNumber }) };
}

// Browser-side messages (CSP, deprecations, interventions). Failed requests are in the network buffer instead.
function logEntry(params) {
  const e = params.entry;
  if (!e || e.source === "network") return undefined;
  return { level: e.level === "warning" ? "warn" : e.level, text: clip(String(e.text ?? "")), at: where(e) };
}

const CONSOLE_EVENTS = { "Runtime.consoleAPICalled": consoleCall, "Runtime.exceptionThrown": exceptionThrown, "Log.entryAdded": logEntry };

// What a CDP event adds to the page's console buffer, or undefined.
function consoleEntry(method, params) {
  return CONSOLE_EVENTS[method]?.(params);
}

function createPaneCdp({ now = Date.now } = {}) {
  const pages = new WeakMap();

  function push(list, entry) {
    list.push({ ...entry, time: now() });
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
  }

  function onMessage(page, method, params) {
    const entry = consoleEntry(method, params);
    if (entry) return push(page.console, entry);
    if (method === "Network.requestWillBeSent") {
      page.requests.set(params.requestId, { url: params.request.url, method: params.request.method, type: params.type });
    } else if (method === "Network.responseReceived") {
      const req = page.requests.get(params.requestId);
      if (params.response.status >= 400) {
        push(page.network, { status: params.response.status, method: req?.method ?? "GET", url: params.response.url, type: params.type });
      }
    } else if (method === "Network.loadingFailed") {
      const req = page.requests.get(params.requestId);
      page.requests.delete(params.requestId);
      // A request the page cancelled (a navigation away, an aborted fetch) isn't a failure worth reporting.
      if (!params.canceled && req) push(page.network, { status: 0, method: req.method, url: req.url, type: params.type, error: params.errorText });
    } else if (method === "Network.loadingFinished") {
      page.requests.delete(params.requestId);
    }
  }

  function enable(wc) {
    for (const [method, params] of [["Runtime.enable"], ["Log.enable"], ["Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }]]) {
      wc.debugger.sendCommand(method, params).catch(() => {});
    }
  }

  // Attaches to a page (idempotent). Throws when something else holds the debugger, i.e. DevTools is open.
  function attach(wc) {
    let page = pages.get(wc);
    if (!page) {
      page = { console: [], network: [], requests: new Map(), attached: false };
      pages.set(wc, page);
      wc.debugger.on("message", (_e, method, params) => onMessage(page, method, params));
      wc.debugger.on("detach", () => (page.attached = false));
      // A new document starts clean: what the agent reads is about the page it's on.
      wc.on("did-navigate", () => {
        page.console.length = 0;
        page.network.length = 0;
        page.requests.clear();
      });
    }
    if (!page.attached && !wc.isDestroyed()) {
      if (!wc.debugger.isAttached()) wc.debugger.attach(PROTOCOL);
      page.attached = true;
      enable(wc);
    }
    return page;
  }

  // At view creation: when it can't (DevTools already open), the first tool call attaches and says why not.
  function tryAttach(wc) {
    try {
      attach(wc);
    } catch {}
  }

  // Same as attach, but as the reason a tool can't run.
  function ready(wc) {
    try {
      return attach(wc);
    } catch {
      throw new Error("The pane page's DevTools are open, so I can't drive it; close DevTools and try again.");
    }
  }

  async function send(wc, method, params) {
    ready(wc);
    return wc.debugger.sendCommand(method, params);
  }

  // level: "error" (errors only), "warn" (errors and warnings, the default), or "all".
  function consoleLogs(wc, level = "warn") {
    const keep = level === "all" ? () => true : level === "error" ? (e) => e.level === "error" : (e) => e.level === "error" || e.level === "warn";
    return ready(wc).console.filter(keep);
  }

  function networkErrors(wc) {
    return ready(wc).network.slice();
  }

  return { attach, tryAttach, send, consoleLogs, networkErrors };
}

module.exports = { createPaneCdp, consoleEntry, MAX_ENTRIES };
