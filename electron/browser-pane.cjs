// The side browser pane: a native view laid over the board where the board's placeholder sits.
// The board drives it over IPC; agents drive it through a token-protected control server on
// 127.0.0.1 (see lib/browser-tools.ts).
const { WebContentsView, dialog, systemPreferences } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { isSelfUrl } = require("./self-url.cjs");
const { createPaneSecrets } = require("./pane-secrets.cjs");
const { secretRunRoutes } = require("./secret-run.cjs");
const { typeText } = require("./pane-actions.cjs");
const { createPaneCdp } = require("./pane-cdp.cjs");
const { createPaneInput, agentRoutes } = require("./pane-input.cjs");
const { controlHandler } = require("./control-server.cjs");
const { failedUrl, watchLoadFailures } = require("./pane-error.cjs");
const { authorizeThreadOpen, originOf, rememberBoardOrigin } = require("./pane-origins.cjs");
const { touchIdPrompt } = require("./touch-id.cjs");
const { appsDir, attachWebContentsView, createAppReload } = require("./app-reload.cjs");

// Chrome's zoom steps, as percentages; Zoom In/Out walk them.
const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

// The next step up (dir 1) or down (dir -1) from a zoom that may sit between steps.
function stepZoom(percent, dir) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > percent + 0.5) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < percent - 0.5) ?? ZOOM_STEPS[0];
}

// Its own session, apart from the board window's, so pages never carry the launch token (electron/api-token.cjs).
const PANE_PARTITION = "persist:threadboard-browser";

function createBrowserPane({ getWindow, getAppView, token, onContents, pages, onLink, secrets, secretRun = () => undefined, routes: moreRoutes = {}, askUser }) {
  // One page per card (keyed by card id), so each review keeps its own browser; "board" is the
  // one shown with no card open. Only the active one is on screen.
  const BOARD = "board";
  const views = new Map();
  // Origins the user has explicitly opened on each key, set by the board's IPC browser:open
  // (electron/main.cjs). A thread's control-server POST /browser/open can only navigate within
  // an origin already in the set (L-5 fix: a compromised renderer can't pivot the pane to a
  // brand new host). Same-origin nav inside a loaded page is always allowed — the set only
  // covers cross-host opens. A host outside the set asks the user with Touch ID first (pane-origins.cjs).
  const authorizedOrigins = new Map();
  const pendingOrigins = new Map();
  const ask = askUser ?? touchIdPrompt({ systemPreferences, dialog, window: getWindow });
  let active = BOARD;
  let visible = false;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  // When a view is showing a file in ~/.weft/apps/<slug>/, rebuilds of that app should reload the page
  // (electron/app-reload.cjs). One watcher per folder shared by the views currently on it.
  const appReload = createAppReload({ appsDir: appsDir(), fs, setTimeout, reloadIgnoringCache: (v) => v.webContents.reloadIgnoringCache() });
  // The agent tools' CDP session per page and what they do with it (electron/pane-cdp.cjs, pane-input.cjs).
  const cdp = createPaneCdp();
  const input = createPaneInput({ cdp });

  function state() {
    const wc = views.get(active)?.webContents;
    const url = wc ? wc.getURL() : "";
    return {
      visible,
      // On the error page the toolbar keeps the address that failed, so it can be fixed and reloaded.
      url: failedUrl(url) ?? url,
      title: wc ? wc.getTitle() : "",
      loading: wc ? wc.isLoading() : false,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
    };
  }

  function sendState() {
    const appView = getAppView();
    if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("browser:state", state());
  }

  function layout() {
    for (const [key, view] of views) {
      view.setBounds(bounds);
      // Until a page loads, the board shows its own placeholder instead of a blank view.
      const hasPage = Boolean(view.webContents.getURL());
      const onScreen = key === active && visible && hasPage && bounds.width > 0 && bounds.height > 0;
      // A hidden page keeps keyboard focus, and then no key reaches anything (Escape least of all).
      const losesFocus = !onScreen && view.webContents.isFocused();
      view.setVisible(onScreen);
      if (losesFocus) boardContents()?.focus();
      // Only the page on screen plays sound; background cards' pages keep running but stay silent.
      view.webContents.setAudioMuted(!onScreen);
    }
  }

  function boardContents() {
    const board = getAppView()?.webContents;
    return board && !board.isDestroyed() ? board : undefined;
  }

  function ensure(key = active) {
    const existing = views.get(key);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: { partition: PANE_PARTITION, sandbox: true, contextIsolation: true, preload: path.join(__dirname, "pane-preload.cjs") },
    });
    view.setBackgroundColor("#ffffff");
    getWindow().contentView.addChildView(view);
    views.set(key, view);
    const wc = view.webContents;
    onContents?.(wc);
    // Before the first load, so the console and network buffers catch it from the start.
    cdp.tryAttach(wc);
    // A focused page swallows keys the board never sees, so Escape is replayed into the board too,
    // where it closes the newest layer as usual. A fullscreen video keeps it to leave fullscreen.
    let fullscreen = false;
    wc.on("enter-html-full-screen", () => (fullscreen = true));
    wc.on("leave-html-full-screen", () => (fullscreen = false));
    wc.on("before-input-event", (_e, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape" || fullscreen) return;
      if (input.shift || input.control || input.alt || input.meta) return;
      const board = boardContents();
      if (!board) return;
      board.focus();
      board.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      board.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    });
    // Trackpad pinch magnifies like Safari; Cmd+scroll changes the page zoom.
    wc.setVisualZoomLevelLimits(1, 4).catch(() => {});
    wc.on("zoom-changed", (_e, direction) => zoomContents(wc, direction));
    // Pop-ups open in the same card's view instead of new windows.
    // Links get where they came from: the card whose pane holds the page, and the page's own URL.
    const from = () => ({ card: key === BOARD ? null : key, page: wc.getURL() });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^weft:/i.test(url)) onLink?.(url, from());
      else wc.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    // weft:// links in a page (a walk-through's buttons, a commit page's Commit) are the app's, not the page's.
    wc.on("will-navigate", (e, url) => {
      if (!/^weft:/i.test(url)) return;
      e.preventDefault();
      onLink?.(url, from());
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
      wc.on(event, () => {
        layout();
        if (key === active) sendState();
      });
    }
    // Reload the view when the app folder it shows changes (electron/app-reload.cjs).
    attachWebContentsView(view, appReload, wc);
    // A failed load shows why (electron/pane-error.cjs) instead of a blank page, with the card's last page to go back to.
    watchLoadFailures(wc, { back: (url) => (key === BOARD ? undefined : lastGoodPage(key, url)) });
    // Remembered so the card's page comes back after a restart (electron/pane-pages.cjs); never the error page.
    if (key !== BOARD) {
      wc.on("did-navigate", () => {
        if (failedUrl(wc.getURL()) === undefined) pages?.record(key, wc.getURL(), wc.getTitle());
      });
    }
    layout();
    return view;
  }

  // action is "in", "out", "reset", or a percentage. Chromium shares zoom across a host's pages.
  function zoomContents(wc, action) {
    if (!wc || wc.isDestroyed()) return;
    const now = wc.getZoomFactor() * 100;
    const next =
      action === "in" ? stepZoom(now, 1) : action === "out" ? stepZoom(now, -1) : action === "reset" ? 100 : Number(action);
    if (!Number.isFinite(next)) return;
    wc.setZoomFactor(Math.min(500, Math.max(25, next)) / 100);
    if (wc === views.get(active)?.webContents) sendState();
  }

  function setVisible(next) {
    visible = next;
    if (visible) ensure();
    layout();
    sendState();
  }

  // Shows a card's browser, or the board's own with no card open. A card and its browser go together:
  // opening a card shows its page (if it has one), and closing the card hides the pane.
  function setActive(key) {
    if (key === active) return;
    active = key || BOARD;
    visible = active !== BOARD && Boolean(views.get(active)?.webContents.getURL());
    layout();
    sendState();
    if (active !== BOARD && !visible) restore(active);
  }

  // A card opened with a blank browser (after a restart) gets its last page back, or its last update page.
  function restore(key) {
    const url = pages?.restoreUrl(key);
    if (!url) return;
    open(url, key).catch(() => {
      const fallback = pages.fallbackUrl(key);
      if (fallback && fallback !== url) open(fallback, key).catch(() => {});
    });
  }

  // Where the error page's Back goes: the card's remembered page, or its last update page when that's what failed.
  function lastGoodPage(key, failed) {
    const saved = pages?.restoreUrl(key);
    if (saved && saved !== failed) return saved;
    return pages?.fallbackUrl(key);
  }

  // Closes the browsers of cards that are gone.
  function prune(keep) {
    const keepKeys = new Set([BOARD, active, ...keep]);
    for (const [key, view] of views) {
      if (keepKeys.has(key)) continue;
      views.delete(key);
      try {
        getWindow().contentView.removeChildView(view);
        view.webContents.close();
      } catch {}
    }
  }

  function setBounds(rect) {
    bounds = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    layout();
  }

  function normalizeUrl(raw) {
    const url = String(raw || "").trim();
    if (/^(https?|file|about):/i.test(url)) return url;
    if (/^(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)) return `http://${url}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error(`Can't open ${url} in the browser pane`);
    return `https://${url}`;
  }

  // Weft's own server (see self-url.cjs for what counts).
  function isSelf(url) {
    return isSelfUrl(url, getAppView()?.webContents.getURL());
  }

  // L-5: pane origin policy lives in pane-origins.cjs so it can be unit-tested.

  // Loads a page in a card's browser. opts.fromBoard is true on the IPC browser:open path; the
  // IPC sender is checked in main.cjs and the flag is what records the origin so a thread can
  // navigate within it later.
  async function open(raw, key, activate, opts = {}) {
    const targetKey = key ?? active;
    const url = normalizeUrl(raw);
    const origin = originOf(url);
    // Weft inside its own pane is a confusing hall of mirrors; a card working on Weft should run its own dev server on another port.
    if (isSelf(url)) throw new Error(`${url} is Weft itself; open the card's own dev server instead`);
    const prior = views.get(targetKey)?.webContents.getURL();
    const priorOrigin = prior ? originOf(prior) : null;
    if (!opts.fromBoard && !(await authorizeThreadOpen({ authorized: authorizedOrigins, pending: pendingOrigins, targetKey, origin, priorOrigin, ask }))) {
      throw new Error(`You didn't allow this thread to open ${origin} in the browser pane. Ask the user to open it there, or to approve it next time.`);
    }
    if (activate) active = targetKey;
    if (opts.fromBoard) rememberBoardOrigin(authorizedOrigins, targetKey, origin);
    const v = ensure(targetKey);
    if (targetKey === active) setVisible(true);
    return loadInView(v, url);
  }

  // Loading a page takes keyboard focus; an agent's page shouldn't pull it out of the board mid-typing.
  async function loadInView(v, url) {
    const boardFocused = Boolean(boardContents()?.isFocused());
    try {
      await v.webContents.loadURL(url);
    } catch (err) {
      // Redirects reject the first load with ERR_ABORTED; the page still loads.
      if (err.code !== "ERR_ABORTED") throw err;
    } finally {
      if (boardFocused && !v.webContents.isDestroyed() && v.webContents.isFocused()) boardContents()?.focus();
    }
    return { url: v.webContents.getURL(), title: v.webContents.getTitle() };
  }

  function requirePage(key = active) {
    const view = views.get(key);
    if (!view || !view.webContents.getURL()) throw new Error("The browser pane has no page open yet. Use open_url first.");
    return view.webContents;
  }

  // read_page never hands back a vault value a thread had typed in (electron/pane-secrets.cjs).
  async function pageText(key = active) {
    const wc = requirePage(key);
    const text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
    return { url: wc.getURL(), title: paneSecrets.redact(key, wc.getTitle()), text: paneSecrets.redact(key, text).slice(0, 30_000) };
  }

  // highlight, a CSS selector, scrolls that element into view and draws an orange box around it for the shot
  // (for step-by-step instructions: "click here"), then takes the box away.
  async function screenshot(key = active, highlight) {
    const wc = requirePage(key);
    if (key === active && !visible) setVisible(true);
    let found;
    if (highlight) {
      found = await wc.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(String(highlight))});
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const box = document.createElement("div");
        box.id = "__weft_highlight";
        box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e8542f;border-radius:8px;box-shadow:0 0 0 4px rgb(232 84 47/.25);" +
          "left:" + (r.left - 6) + "px;top:" + (r.top - 6) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px";
        document.documentElement.appendChild(box);
        return true;
      })()`);
      // Let the scroll and the box paint before the capture.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    let image;
    try {
      image = await wc.capturePage();
    } finally {
      if (found) await wc.executeJavaScript(`document.getElementById("__weft_highlight")?.remove()`).catch(() => {});
    }
    if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
    return { png: image.toPNG().toString("base64"), ...(highlight ? { found: Boolean(found) } : {}) };
  }

  // A card's thumbnail (lib/card-pictures.ts): a small capture that never shows the pane. A page that
  // isn't on screen may capture empty; that's no thumbnail, not an error.
  async function thumbnail(key) {
    const view = views.get(key);
    if (!view || !view.webContents.getURL()) return { jpg: null };
    let image = await view.webContents.capturePage();
    if (image.isEmpty()) return { jpg: null };
    if (image.getSize().width > 480) image = image.resize({ width: 480, quality: "good" });
    return { jpg: image.toJPEG(78).toString("base64") };
  }

  const paneSecrets = createPaneSecrets({ secrets, requirePage, typeText, cdp });

  // Resolves to the control server's base URL.
  function startControlServer() {
    const routes = {
      "POST /browser/open": (body) => open(body.url, body.key),
      "POST /browser/text": (body) => pageText(body.key),
      // What a card's browser shows, "" when it has no page yet (see lib/show.ts).
      "POST /browser/url": (body) => ({ url: views.get(body.key)?.webContents.getURL() || "" }),
      "POST /browser/screenshot": (body) => screenshot(body.key, body.highlight),
      "POST /browser/thumb": (body) => thumbnail(body.key),
      // click, type, keys, scroll, snapshot, console, network and the rest (electron/pane-input.cjs).
      ...agentRoutes({ input, cdp, page: (body) => ({ wc: requirePage(body.key), key: body.key ?? active }), redact: paneSecrets.redact }),
      "POST /secrets/list": (body) => paneSecrets.list(body.folder),
      "POST /secrets/fill": (body) => paneSecrets.fill({ ...body, key: body.key ?? active }),
      // Commands and dev servers with vault values in their env (electron/secret-run.cjs).
      ...secretRunRoutes(secretRun, () => active),
      // A card's stored tool results, with every value it typed or ran with swapped for ‹NAME› (lib/secret-run.ts).
      "POST /secrets/redact": (body) => {
        const typed = paneSecrets.redact(body.key, body.text);
        return { text: secretRun()?.redact(body.key, typed) ?? typed };
      },
      // Other parts of main the server talks to, like the account session (electron/account-store.cjs).
      ...moreRoutes,
    };
    const server = http.createServer(controlHandler({ token, routes }));
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
  }

  return {
    state,
    open,
    setVisible,
    setBounds,
    isVisible: () => visible,
    setActive,
    prune,
    contentsFor: (key) => views.get(key)?.webContents,
    webContents: () => views.get(active)?.webContents,
    back: () => views.get(active)?.webContents.navigationHistory.goBack(),
    forward: () => views.get(active)?.webContents.navigationHistory.goForward(),
    reload: () => views.get(active)?.webContents.reload(),
    zoom: (action) => zoomContents(views.get(active)?.webContents, action),
    // True for any card's page, so the app menu's zoom keys reach the pane's toolbar too.
    owns: (wc) => [...views.values()].some((v) => v.webContents === wc),
    startControlServer,
  };
}

module.exports = { createBrowserPane, PANE_PARTITION };
