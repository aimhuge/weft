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
const { captureShot, captureThumb } = require("./pane-capture.cjs");
const { zoomContents } = require("./pane-zoom.cjs");
const { controlHandler } = require("./control-server.cjs");
const { cardFinder } = require("./card-token.cjs");
const { failedUrl, watchLoadFailures } = require("./pane-error.cjs");
const { replayEscapeToBoard } = require("./pane-escape.cjs");
const { authorizeThreadOpen, originOf, rememberBoardOrigin } = require("./pane-origins.cjs");
const { BOARD, activeKey, paneVisibleFor, needsRestore, switchKey } = require("./pane-visibility.cjs");
const { touchIdPrompt } = require("./touch-id.cjs");
const { appsDir, attachWebContentsView, createAppReload } = require("./app-reload.cjs");
const { createPaneTabs } = require("./pane-tabs.cjs");

// Its own session, apart from the board window's, so pages never carry the launch token (electron/api-token.cjs).
const PANE_PARTITION = "persist:threadboard-browser";

function createBrowserPane({ getWindow, getAppView, token, onContents, pages, onLink, secrets, secretRun = () => undefined, routes: moreRoutes = {}, askUser }) {
  // Each card (keyed by card id) has its own tabs, so each review keeps its own browser; "board" is the
  // one shown with no card open. Only the active card's current tab is on screen (electron/pane-tabs.cjs).
  const tabs = createPaneTabs();
  const viewOf = (key) => tabs.current(key)?.view;
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
    const wc = viewOf(active)?.webContents;
    const url = wc ? wc.getURL() : "";
    return {
      // The card's tabs for the tab strip (components/PaneTabs.tsx), and which one is on screen.
      tabs: tabs.list(active).map(tabState),
      tab: tabs.current(active)?.id ?? null,
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

  function tabState({ id, view }) {
    const url = view.webContents.getURL();
    return { id, url: failedUrl(url) ?? url, title: view.webContents.getTitle() };
  }

  function sendState() {
    const appView = getAppView();
    if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("browser:state", state());
  }

  function layout() {
    for (const { key, view } of tabs.all()) {
      view.setBounds(bounds);
      // Until a page loads, the board shows its own placeholder instead of a blank view.
      const hasPage = Boolean(view.webContents.getURL());
      const current = key === active && view === viewOf(key);
      const onScreen = current && visible && hasPage && bounds.width > 0 && bounds.height > 0;
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

  // A card's current tab, made (as its first tab) when it has none.
  function ensure(key = active) {
    return viewOf(key) ?? addTab(key);
  }

  // A new tab for a card, after its current one, and on screen if the card is.
  function addTab(key) {
    const view = createView(key);
    tabs.add(key, view);
    layout();
    return view;
  }

  function createView(key) {
    const view = new WebContentsView({
      webPreferences: { partition: PANE_PARTITION, sandbox: true, contextIsolation: true, preload: path.join(__dirname, "pane-preload.cjs") },
    });
    view.setBackgroundColor("#ffffff");
    getWindow().contentView.addChildView(view);
    const wc = view.webContents;
    onContents?.(wc);
    // Before the first load, so the console and network buffers catch it from the start.
    cdp.tryAttach(wc);
    // A focused page swallows keys the board never sees, so Escape is replayed into the board too,
    // where it closes the newest layer as usual. A fullscreen video keeps it to leave fullscreen.
    replayEscapeToBoard(wc, boardContents);
    // Trackpad pinch magnifies like Safari; Cmd+scroll changes the page zoom.
    wc.setVisualZoomLevelLimits(1, 4).catch(() => {});
    wc.on("zoom-changed", (_e, direction) => zoom(wc, direction));
    // Pop-ups and target=_blank links open in a new tab of the same card instead of new windows.
    // Links get where they came from: the card whose pane holds the page, and the page's own URL.
    const from = () => ({ card: key === BOARD ? null : key, page: wc.getURL() });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^weft:/i.test(url)) onLink?.(url, from());
      else {
        const tab = addTab(key);
        if (key === active) sendState();
        loadInView(tab, url).catch(() => {});
      }
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
    // Only the current tab's: the page on screen is the one the thread and the show rail mean.
    if (key !== BOARD) {
      wc.on("did-navigate", () => {
        if (viewOf(key) === view && failedUrl(wc.getURL()) === undefined) pages?.record(key, wc.getURL(), wc.getTitle());
      });
    }
    return view;
  }

  function destroy(view) {
    try {
      getWindow().contentView.removeChildView(view);
      view.webContents.close();
    } catch {}
  }

  // Tabs act on the open card's browser, the one on screen.
  function selectTab(id) {
    if (!tabs.select(active, Number(id))) return;
    const wc = viewOf(active).webContents;
    if (active !== BOARD && wc.getURL() && failedUrl(wc.getURL()) === undefined) pages?.record(active, wc.getURL(), wc.getTitle());
    layout();
    sendState();
  }

  function closeTab(id) {
    const tab = tabs.close(active, Number(id));
    if (!tab) return;
    destroy(tab.view);
    selectTab(tabs.current(active).id);
  }

  // A blank tab for the open card; the board's placeholder shows until the user types an address.
  // A card whose current tab is still blank reuses it.
  function newTab() {
    visible = true;
    const view = viewOf(active);
    if (!view || view.webContents.getURL()) addTab(active);
    layout();
    sendState();
  }

  // The page's zoom; the toolbar shows it for the page on screen.
  function zoom(wc, action) {
    if (zoomContents(wc, action) && wc === viewOf(active)?.webContents) sendState();
  }

  function setVisible(next, key) {
    // The key the pane is for, when the board knows it: the card being opened. The board asks for
    // the pane and then activates the card, and without this the view would be made for the card
    // that was active a moment ago — so the old card's page (or the board's own) flashed over the
    // new one for a frame. Activating the key here makes the card and its pane switch together.
    const nextKey = switchKey(key, active);
    if (nextKey !== active) {
      active = nextKey;
      if (needsRestore(active, Boolean(viewOf(active)?.webContents.getURL()))) restore(active);
    }
    visible = next;
    if (visible) ensure(active);
    layout();
    sendState();
  }

  // Shows a card's browser, or the board's own with no card open. A card and its browser go together:
  // opening a card shows the pane, whether it has a page yet or not, and closing the card hides it.
  // The pane's own placeholder shows while the page loads, so the slot is never empty (and the user
  // never has to reopen a pane they closed earlier).
  function setActive(key) {
    if (key === active) return;
    active = activeKey(key);
    visible = paneVisibleFor(active);
    layout();
    sendState();
    if (needsRestore(active, Boolean(viewOf(active)?.webContents.getURL()))) restore(active);
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
    for (const key of tabs.keys()) {
      if (keepKeys.has(key)) continue;
      for (const tab of tabs.remove(key)) destroy(tab.view);
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
    const prior = viewOf(targetKey)?.webContents.getURL();
    const priorOrigin = prior ? originOf(prior) : null;
    if (!opts.fromBoard && !(await authorizeThreadOpen({ authorized: authorizedOrigins, pending: pendingOrigins, targetKey, origin, priorOrigin, ask }))) {
      throw new Error(`You didn't allow this thread to open ${origin} in the browser pane. Ask the user to open it there, or to approve it next time.`);
    }
    if (activate) active = targetKey;
    if (opts.fromBoard) rememberBoardOrigin(authorizedOrigins, targetKey, origin);
    // opts.newTab (an agent's open_url new_tab) keeps the card's current page in its own tab.
    const v = opts.newTab && prior ? addTab(targetKey) : ensure(targetKey);
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
    const view = viewOf(key);
    if (!view || !view.webContents.getURL()) throw new Error("The browser pane has no page open yet. Use open_url first.");
    return view.webContents;
  }

  // read_page never hands back a vault value a thread had typed in (electron/pane-secrets.cjs).
  async function pageText(key = active) {
    const wc = requirePage(key);
    const text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
    return { url: wc.getURL(), title: paneSecrets.redact(key, wc.getTitle()), text: paneSecrets.redact(key, text).slice(0, 30_000) };
  }

  // An agent's screenshot of a card's page (electron/pane-capture.cjs); it shows the pane first.
  async function screenshot(key = active, highlight) {
    const wc = requirePage(key);
    if (key === active && !visible) setVisible(true);
    return captureShot(wc, highlight);
  }

  const paneSecrets = createPaneSecrets({ secrets, requirePage, typeText, cdp });

  // Which card a request is for. The server signs the card id with the launch token; main checks
  // the signature and believes only what it proves (electron/card-token.cjs). A request with no
  // valid signature has no card, so it acts for nobody: a body that names a card can't borrow
  // another card's grant, unlocks or audit line.
  const cardFor = cardFinder(token);

  // Resolves to the control server's base URL.
  function startControlServer() {
    const routes = {
      "POST /browser/open": (body) => open(body.url, body.key, false, { newTab: Boolean(body.newTab) }),
      "POST /browser/text": (body) => pageText(body.key),
      // What a card's browser shows, "" when it has no page yet (see lib/show.ts).
      "POST /browser/url": (body) => ({ url: viewOf(body.key)?.webContents.getURL() || "" }),
      "POST /browser/screenshot": (body) => screenshot(body.key, body.highlight),
      "POST /browser/thumb": (body) => captureThumb(viewOf(body.key)?.webContents),
      // click, type, keys, scroll, snapshot, console, network and the rest (electron/pane-input.cjs).
      ...agentRoutes({ input, cdp, page: (body) => ({ wc: requirePage(body.key), key: body.key ?? active }), redact: paneSecrets.redact }),
      "POST /secrets/list": (body) => paneSecrets.list(body.folder),
      // The card is the signed one, never the body's key: a fill acts for the card the server proved.
      "POST /secrets/fill": (body, route) => paneSecrets.fill({ ...body, key: cardFor(body, route) }),
      // Commands and dev servers with vault values in their env (electron/secret-run.cjs).
      ...secretRunRoutes(secretRun, cardFor),
      // A card's stored tool results, with every value it typed or ran with swapped for ‹NAME› (lib/secret-run.ts).
      "POST /secrets/redact": (body, route) => {
        const key = cardFor(body, route);
        const typed = paneSecrets.redact(key, body.text);
        return { text: secretRun()?.redact(key, typed) ?? typed };
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
    contentsFor: (key) => viewOf(key)?.webContents,
    webContents: () => viewOf(active)?.webContents,
    back: () => viewOf(active)?.webContents.navigationHistory.goBack(),
    forward: () => viewOf(active)?.webContents.navigationHistory.goForward(),
    reload: () => viewOf(active)?.webContents.reload(),
    zoom: (action) => zoom(viewOf(active)?.webContents, action),
    // True for any card's page, so the app menu's zoom keys reach the pane's toolbar too.
    owns: (wc) => [...tabs.all()].some((t) => t.view.webContents === wc),
    newTab,
    selectTab,
    closeTab,
    startControlServer,
  };
}

module.exports = { createBrowserPane, PANE_PARTITION };
