// Weft's desktop shell: starts and supervises the Next.js server, shows the board in a native
// window with a side browser pane, keeps the copilot in its own window, and adds the macOS
// pieces: menus, a menu bar icon, a dock menu and badge, a global copilot shortcut, and weft:// links.
const {
  BaseWindow,
  BrowserWindow,
  Menu,
  WebContentsView,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  session,
  shell,
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerAboutBridge } = require("./about.cjs");
const { createBrowserPane } = require("./browser-pane.cjs");
const { createMenus } = require("./menus.cjs");
const { createPageLinks } = require("./page-links.cjs");
const { createPanePages } = require("./pane-pages.cjs");
const { paneRoutes } = require("./pane-routes.cjs");
const { removeShellToken, writeShellToken } = require("./shell-token.cjs");
const { attachTokens } = require("./api-token.cjs");
const { appendToolchain, fixPath } = require("./env.cjs");
const { startServer } = require("./server.cjs");
const { createStartupScreen } = require("./startup-screen.cjs");
const { createStartupTimer } = require("./startup-timer.cjs");
const { registerTerminal } = require("./terminal.cjs");
const { followThemeChoice } = require("./theme-source.cjs");
const { loadWindowState, trackWindowState } = require("./window-state.cjs");
const { createAccountLink } = require("./account-link.cjs");
const { argvLink } = require("./argv-link.cjs");
const { createMenuPopup } = require("./main-menu-popup.cjs");
const { createNewThreadLink } = require("./new-thread-link.cjs");

const APP_NAME = "Weft";
const TAGLINE = "Engineering the future, one thread at a time";
const ASSETS = path.join(__dirname, "assets");
const PRELOAD = path.join(__dirname, "preload.cjs");
const TOKEN = crypto.randomBytes(24).toString("hex");
const PREFERRED_PORT = Number(process.env.WEFT_PORT) || 1024;
const COPILOT_SHORTCUT = "Control+Alt+Space";
const PROTOCOL = "weft";
const mac = process.platform === "darwin";

app.setName(APP_NAME);
// The board plays a chime when a card changes column, often before you've clicked anything.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win;
let appView;
let copilotWin;
let server;
let quitting = false;
// weft:// links that arrive before the board is ready.
const pendingLinks = [];
const timer = createStartupTimer({
  version: app.getVersion(),
  mode: app.isPackaged ? "packaged" : process.env.WEFT_PROD ? "prod" : "dev",
});

// The secrets vault, set up further down; the pane types its values in for threads (fillSecret).
// With it, commands and dev servers run with vault values (secret-run.cjs) and the push to Vercel (vercel-env.cjs).
let vault, secretRun, vercelEnv, vercelApi, supabaseApi, blastcpApi, gooseApi, slackApi;
// Small native warning dialog; shared by pageLinks (walk-through buttons) and accountLink (OAuth callback).
const warnUser = (message, detail) => dialog.showMessageBox(win, { type: "warning", message, detail });
const pane = createBrowserPane({
  secrets: () => vault, secretRun: () => secretRun,
  getWindow: () => win, getAppView: () => appView, token: TOKEN,
  onContents: (contents) => menus.attachContextMenu(contents),
  pages: createPanePages(dataDir()),
  // weft:// links clicked inside a pane page, like a walk-through's buttons.
  onLink: (url, from) => pageLinks.handle(url, from) || handleLink(url),
  // What threads and the server ask main for, over the pane's control server (electron/pane-routes.cjs).
  routes: paneRoutes({
    dataDir: dataDir(), app, dialog, shell, sendMenu,
    window: () => win, board: () => appView?.webContents, updater: () => menus.updater,
    vault: () => vault, vercelEnv: () => vercelEnv, vercelApi: () => vercelApi, supabaseApi: () => supabaseApi, blastcpApi: () => blastcpApi, gooseApi: () => gooseApi, slackApi: () => slackApi,
  }),
});
// A walk-through page's buttons: replies, and commits that run with no turn.
const pageLinks = createPageLinks({
  getServer: () => server,
  contentsFor: (key) => pane.contentsFor(key),
  warn: warnUser,
});

// weft://account-callback links: forward to the board's /api/auth/weft-callback so the OAuth
// code can be exchanged against the PKCE verifier.
const accountLink = createAccountLink({ getServer: () => server, showMain, warn: warnUser });

// Only one Weft runs at a time; opening it again brings the existing window forward.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

app.on("second-instance", (_event, argv) => {
  showMain();
  // weft:// links may arrive as a raw arg (the wrapper passes them through) or as `--weft-link=…`
  // when the wrapper wants to be explicit. macOS's open-url event covers the running case; this
  // handler covers the second-instance path on every platform.
  const link = argvLink(argv, PROTOCOL);
  if (link) handleLink(link);
});

// macOS delivers weft:// links here, possibly before the app is ready.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleLink(url);
});

function background() {
  return nativeTheme.shouldUseDarkColors ? "#131312" : "#f4f3ef";
}

function dataDir() {
  return process.env.WEFT_DATA || path.join(os.homedir(), ".weft");
}

function sendMenu(action, payload) {
  if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("menu", action, payload);
}

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (mac) app.focus({ steal: true });
}

// ---- Startup screen ----

const startup = createStartupScreen({ view: () => appView, version: app.getVersion(), showMain, logPath: () => server?.logPath });
let controlUrl;

async function boot() {
  await startup.show("Finding your command-line tools…");
  await fixPath();
  if (app.isPackaged) appendToolchain(path.join(process.resourcesPath, "toolchain", "bin"));
  timer.mark("path");
  await startup.show("Starting the board…");
  controlUrl ??= await pane.startControlServer();
  writeShellToken(dataDir(), TOKEN);
  try {
    server = await startServer({
      preferredPort: PREFERRED_PORT,
      // The token goes in a file, not the env, where any process of yours could read it (electron/shell-token.cjs).
      env: { WEFT_SHELL_URL: controlUrl, WEFT_APP_PID: String(process.pid) },
      // A runtime fatal (board was up, then died) pushes to the renderer via onNotify so the
      // ServerErrorBar shows instead of the splash taking over the window. A startup fatal
      // (server never came up) still goes to startup.fail — the board is on the splash already.
      onFatal: (message) => {
        if (server?.wasReady) return;
        startup.fail(message);
      },
      onNotify: (event) => {
        const wc = appView?.webContents;
        if (!wc || wc.isDestroyed()) return;
        if (event.kind === "fatal") wc.send("server:fatal", event.text);
        else if (event.kind === "status") wc.send("server:status", event.text);
      },
      onMark: timer.mark,
    });
  } catch (err) {
    await startup.fail(err.message);
    return;
  }
  timer.mark("server");
  attachTokens(session, server.url, TOKEN);
  await startup.loadBoard(server.url);
  timer.mark("page");
  for (const link of pendingLinks.splice(0)) handleLink(link);
}

// ---- Windows ----

function createMainWindow() {
  const state = loadWindowState("main", { width: 1480, height: 920 });
  win = new BaseWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    backgroundColor: background(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 15 },
  });
  if (state.maximized) win.maximize();
  trackWindowState("main", win);

  appView = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  appView.setBackgroundColor(background());
  win.contentView.addChildView(appView);
  const fit = () => {
    const { width, height } = win.getContentBounds();
    appView.setBounds({ x: 0, y: 0, width, height });
  };
  win.on("resize", fit);
  fit();

  // On macOS, closing the window keeps Weft (and your threads) running; ⌘Q quits.
  win.on("close", (event) => {
    if (!quitting && mac) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    win = undefined;
    if (!mac) app.quit();
  });

  // Links in the board open in the browser pane, not a new window.
  appView.webContents.setWindowOpenHandler(({ url }) => {
    pane.open(url, undefined, false, { fromBoard: true }).catch(() => {});
    return { action: "deny" };
  });
  menus.attachContextMenu(appView.webContents);
  appView.webContents.once("did-finish-load", () => win?.show());
  startup.watch(appView.webContents);
}

function sendCopilotState() {
  const open = Boolean(copilotWin && !copilotWin.isDestroyed() && copilotWin.isVisible());
  if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("copilot:state", { open });
}

function createCopilot() {
  const main = win?.getBounds() ?? { x: 80, y: 80, width: 1400, height: 900 };
  const state = loadWindowState("copilot", {
    width: 420,
    height: 680,
    x: Math.max(0, main.x + main.width - 444),
    y: Math.max(0, main.y + main.height - 704),
  });
  copilotWin = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 340,
    minHeight: 420,
    title: "Copilot",
    show: false,
    backgroundColor: background(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  trackWindowState("copilot", copilotWin);
  copilotWin.webContents.setWindowOpenHandler(({ url }) => {
    pane.open(url, undefined, false, { fromBoard: true }).catch(() => {});
    return { action: "deny" };
  });
  menus.attachContextMenu(copilotWin.webContents);
  // Closing hides it, so it reopens instantly with the conversation in place.
  copilotWin.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      copilotWin.hide();
    }
  });
  copilotWin.on("show", sendCopilotState);
  copilotWin.on("hide", sendCopilotState);
  copilotWin.on("closed", () => {
    copilotWin = undefined;
    sendCopilotState();
  });
  copilotWin.loadURL(`${server.url}/copilot`);
}

function showCopilot() {
  if (!server) return;
  if (!copilotWin || copilotWin.isDestroyed()) createCopilot();
  copilotWin.show();
  copilotWin.focus();
  if (mac) app.focus({ steal: true });
  sendCopilotState();
}

function toggleCopilot() {
  if (copilotWin && !copilotWin.isDestroyed() && copilotWin.isVisible() && copilotWin.isFocused()) {
    copilotWin.hide();
    sendCopilotState();
  } else {
    showCopilot();
  }
}

// ---- weft:// links ----
// weft://new?prompt=…&folder=…&title=…&cli=puku           create a card (L-3: dialog pre-filled, Start required)
// weft://card/<id>                                        open a card
// weft://copilot                                          open the copilot
// weft://reply and weft://commit come from a card's own page in the pane (page-links.cjs)

async function handleLink(raw) {
  if (accountLink.isAccountCallback(raw)) return accountLink.handle(raw);
  if (!server) {
    pendingLinks.push(raw);
    return;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  const action = url.hostname;
  if (action === "copilot") return showCopilot();
  showMain();
  if (action === "card") return sendMenu("open-card", url.pathname.replace(/^\/+/, ""));
  if (action !== "new") return;
  return handleNewThreadLink(url);
}

// weft://new — L-3: the dialog is pre-filled but the user has to click Start; start=1 is ignored.
const handleNewThreadLink = createNewThreadLink({ getServer: () => server, getWin: () => win, sendMenu });

// ---- Menus, tray, dock (menus.cjs) ----

const menus = createMenus({
  APP_NAME,
  ASSETS,
  COPILOT_SHORTCUT,
  mac,
  pane,
  getWin: () => win,
  getAppView: () => appView,
  getServer: () => server,
  showMain,
  sendMenu,
  showCopilot,
  toggleCopilot,
  dataDir,
});

// ---- IPC from the board and copilot ----

// A page that won't load (a dev server that isn't running) is shown in the pane; it isn't an error for the board.
// (L-5) Only the board may open URLs in the pane; a compromised renderer can't pivot it to a fresh host.
ipcMain.handle("browser:open", (e, url, key) => e.sender && e.sender === appView?.webContents
  ? pane.open(url, key || undefined, true, { fromBoard: true }).catch((err) => ({ error: String(err.message || err) }))
  : { error: "Browser pane only answers the board window." });
ipcMain.handle("browser:state", () => pane.state());
ipcMain.on("browser:visible", (_e, visible) => pane.setVisible(Boolean(visible)));
ipcMain.on("browser:active", (_e, key) => pane.setActive(key));
ipcMain.on("browser:prune", (_e, keys) => pane.prune(Array.isArray(keys) ? keys : []));
// The board measures in its own CSS pixels; once it's zoomed (View > Zoom In/Out) those no longer
// match window pixels, so scale by its zoom factor or the native view lands off its placeholder.
ipcMain.on("browser:bounds", (e, rect) => {
  const z = e.sender.getZoomFactor();
  pane.setBounds({ x: rect.x * z, y: rect.y * z, width: rect.width * z, height: rect.height * z });
});
ipcMain.on("browser:back", () => pane.back());
ipcMain.on("browser:forward", () => pane.forward());
ipcMain.on("browser:reload", () => pane.reload());
ipcMain.on("browser:zoom", (_e, action) => pane.zoom(action));
ipcMain.on("copilot:toggle", () => toggleCopilot());
const killTerminals = registerTerminal(ipcMain, { isBoard: (sender) => Boolean(sender) && sender === appView?.webContents });
ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.on("shell:openExternal", (_e, url) => /^https?:\/\//i.test(String(url)) && shell.openExternal(String(url)));
createMenuPopup({ ipcMain, Menu, BrowserWindow });
ipcMain.on("shell:reveal", (_e, folder) => path.isAbsolute(String(folder)) && fs.existsSync(String(folder)) && shell.openPath(String(folder)));
// The secrets vault answers the board window only; threads reach values only through the pane typing them in, behind Touch ID.
vault = require("./vault.cjs").setupVault({ ipcMain, dataDir: dataDir(), window: () => win, board: () => appView?.webContents });
secretRun = require("./secret-run.cjs").setupSecretRun({ vault, dataDir: dataDir(), window: () => win });
// So does Vercel: its token is in the Keychain and its links are .vercel/project.json.
({ vercel: vercelApi, env: vercelEnv } = require("./vercel.cjs").setupVercel({ ipcMain, dataDir: dataDir(), board: () => appView?.webContents, vault }));
// And Supabase: its token is in the Keychain and its links are supabase/.temp/project-ref.
supabaseApi = require("./supabase.cjs").setupSupabase({ ipcMain, dataDir: dataDir(), board: () => appView?.webContents, vault });
// Mini apps: data reads + the hosted fetch/env/requestSecret + the Share dialog's "Upload
// secrets" push, plus the sealed account store the push reads from (electron/app-setup.cjs).
require("./app-setup.cjs").setupApps({
  ipcMain, vault, dataDir: dataDir(),
  ownsPane: (wc) => pane.owns(wc) || require("./page-snapshot.cjs").ownsSnapshot(wc),
  isBoard: (sender) => Boolean(sender) && sender === appView?.webContents,
  supabaseReadLink: require("./supabase.cjs").readLink,
  getSafeStorage: () => require("./keychain-audit.cjs").keychainFor("Weft sign-in"),
});
// And BlastCP, Cloudflare, Slack and Goose, each with its secret in the Keychain (electron/providers.cjs).
({ blastcpApi, slackApi, gooseApi } = require("./providers.cjs").setupProviders({
  ipcMain, dataDir: dataDir(), board: () => appView?.webContents, server: () => (server ? { url: server.url, token: TOKEN } : null),
}));
// Keep Working (electron/keep-working.cjs): the board's Settings → General → Laptop mode card; the
// wiring lives in electron/keep-working-ipc.cjs to keep main.cjs under the size budget.
require("./keep-working-ipc.cjs")({ ipcMain, keepWorking: menus.keepWorking, getBoardContents: () => appView?.webContents });
// Server supervisor IPC (electron/server-ipc.cjs): the board's ServerErrorBar calls server:retry
// to relaunch, server:open-logs to reveal the log, and weft:create-fix-card to queue a New
// thread dialog with the fatal + log tail pre-filled (lib/server-status.ts).
require("./server-ipc.cjs")({
  ipcMain,
  shell,
  getServer: () => server,
  getBoardContents: () => appView?.webContents,
  getHandleLink: () => handleLink,
  logPath: () => server?.logPath,
});
// Splash IPC: the start screen's button row, the launch timing handshake and the dock badge count
// (electron/startup-ipc.cjs). server and menus are getters: they're set later, at boot.
require("./startup-ipc.cjs")({
  ipcMain, app, shell, timer, boot, startup,
  getServer: () => server,
  getMenus: () => menus,
});

// ---- Lifecycle ----

app.whenReady().then(async () => {
  if (!primary) return;
  timer.mark("ready");
  await followThemeChoice(session.defaultSession.cookies, nativeTheme);
  registerAboutBridge({ tagline: TAGLINE, dataDir, getServer: () => server });
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  menus.buildMenu();
  menus.setupDock();
  createMainWindow();
  menus.createTray();
  menus.updater.start();
  if (!globalShortcut.register(COPILOT_SHORTCUT, toggleCopilot)) {
    console.warn(`Couldn't register ${COPILOT_SHORTCUT}; another app may be using it.`);
  }
  nativeTheme.on("updated", () => {
    const color = background();
    win?.setBackgroundColor(color);
    appView?.setBackgroundColor(color);
    if (copilotWin && !copilotWin.isDestroyed()) copilotWin.setBackgroundColor(color);
  });
  await boot();
});

// Clicking the dock icon (or a notification) brings the board back.
app.on("activate", showMain);

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  menus.keepWorking?.stopSync();
  globalShortcut.unregisterAll();
  killTerminals();
  server?.stop();
  removeShellToken(dataDir());
});

app.on("window-all-closed", () => {
  if (!mac) app.quit();
});
