// Updates: Weft checks GitHub Releases for a newer version at launch and every few hours.
//
// Each release carries update.json (scripts/release-feed.mjs writes it), in the static JSON format macOS's
// own updater (Squirrel.Mac, Electron's built-in autoUpdater) reads. A signed build hands the feed to
// Squirrel, which downloads the zip in the background; the app menu then offers "Restart to Update", and
// the update also lands on the next quit. An unsigned build, or any Squirrel failure, falls back to
// "Download Weft X…", which opens the release page. A ready update installs on its own only when nobody would
// notice: no thread running and nobody at the Mac for AWAY_SECONDS. A click asks first when threads are running.
// Dev mode never checks on its own (`npm run desktop` updates with git pull).
const FEED = process.env.WEFT_UPDATE_FEED || "https://github.com/aimhuge/weft/releases/latest/download/update.json";
const RELEASES = "https://github.com/aimhuge/weft/releases";
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 30_000; // after launch, out of the board's way
const BUSY = new Set(["checking", "downloading", "ready"]); // phases a new check would only disturb
const AWAY_SECONDS = 10 * 60; // no keyboard or mouse for this long, and a ready update installs itself
const QUIET_CHECK_MS = 60_000;

// -1, 0 or 1 for semver-ish "1.2.3" strings; a prerelease ("1.2.3-beta.1") sorts before its release.
function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ""] = String(v).replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// The release a feed offers over `current`, or null when there's nothing newer (or the feed is malformed).
function newerRelease(feed, current) {
  const version = feed?.currentRelease;
  if (typeof version !== "string" || compareVersions(version, current) <= 0) return null;
  const entry = (feed.releases || []).find((r) => r?.version === version);
  return {
    version,
    notes: entry?.updateTo?.notes || "",
    page: typeof feed.page === "string" ? feed.page : `${RELEASES}/tag/v${version}`,
  };
}

// The app menu item for an update state, or null when there's nothing to say.
function menuItem(state, { install, download, check }) {
  switch (state.phase) {
    case "ready":
      return { label: `Restart to Update to ${state.version}`, click: install };
    case "downloading":
      return { label: `Downloading Weft ${state.version}…`, enabled: false };
    case "available":
      return { label: `Download Weft ${state.version}…`, click: download };
    case "checking":
      return { label: "Checking for Updates…", enabled: false };
    default:
      return { label: "Check for Updates…", click: check };
  }
}

function createUpdater({
  currentVersion,
  packaged,
  autoUpdater,
  fetchJson = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`update feed: HTTP ${res.status}`);
    return res.json();
  },
  countRunning = async () => null,
  // With threads running: "idle" restarts once they finish, "now" cuts them off, anything else waits.
  ask = async () => "now",
  // Arms the server's restart when idle to install the update (lib/restart-when-idle.ts).
  restartWhenIdle = async () => {},
  tell = () => {},
  notify = () => {},
  openExternal = () => {},
  onBeforeInstall = () => {},
  onChange = () => {},
  // Seconds since the last keyboard or mouse input on this Mac (Electron's powerMonitor).
  idleSeconds = () => 0,
  // The Software Update window (update-window.cjs): when given, the menu item opens it instead of acting.
  openWindow = null,
  feed = FEED,
  log = console,
}) {
  let state = { phase: "idle" };
  let timer = null;
  let squirrelReady = false;
  let quietTimer = null;

  function set(next) {
    state = next;
    onChange(state);
  }

  function fallBack(release, err) {
    if (err) log.warn?.(`Weft updater: ${err.message || err}; offering the download instead`);
    set({ ...found(release), phase: "available" });
  }

  // What a check found, carried through every phase after it so the update window can show it.
  function found(release) {
    return { version: release.version, page: release.page, notes: release.notes || "", checkedAt: Date.now() };
  }

  // Hands the feed to Squirrel once; its events move the state from here on.
  function startSquirrel(release) {
    if (!squirrelReady) {
      squirrelReady = true;
      autoUpdater.on("update-downloaded", () => {
        set({ ...state, phase: "ready" });
        const body = "Weft restarts into it once no threads are running and you've stepped away. Or restart now.";
        notify(`Weft ${state.version} is ready`, body, { install: () => install(), open: openWindow });
        watchForQuiet();
      });
      autoUpdater.on("error", (err) => {
        if (state.phase === "downloading") fallBack(state, err);
      });
      autoUpdater.on("before-quit-for-update", onBeforeInstall);
      autoUpdater.setFeedURL({ url: feed, serverType: "json" });
    }
    set({ ...found(release), phase: "downloading" });
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      fallBack(release, err);
    }
  }

  // `manual` is the menu's "Check for Updates…": it says what it found, even "you're up to date".
  async function check({ manual = false } = {}) {
    if (BUSY.has(state.phase)) return state;
    const say = manual ? tell : () => {};
    const before = state;
    set({ phase: "checking" });
    let release;
    try {
      release = newerRelease(await fetchJson(feed), currentVersion);
    } catch (err) {
      const error = String(err.message || err);
      set(before.phase === "available" ? before : { phase: "idle", error, checkedAt: Date.now() });
      say("Couldn't check for updates", error);
      return state;
    }
    if (!release) {
      set({ phase: "idle", upToDate: true, checkedAt: Date.now() });
      say("You're up to date", `Weft ${currentVersion} is the newest version.`);
      return state;
    }
    if (packaged && autoUpdater) startSquirrel(release);
    else fallBack(release);
    if (state.phase === "available") say(`Weft ${release.version} is out`, "Choose Download in the Weft menu to get it.");
    return state;
  }

  async function install() {
    if (state.phase !== "ready") return false;
    const running = await countRunning().catch(() => null);
    if (running > 0) {
      const what = running === 1 ? "1 thread is" : `${running} threads are`;
      const choice = await ask(`${what} still running`, "Restarting now stops them mid-turn. Restart when they finish, and nothing new starts until then.");
      if (choice === "idle") {
        await restartWhenIdle();
        return false;
      }
      if (choice !== "now") return false;
    }
    return installNow();
  }

  // Once an update is ready, installs it the first time nothing runs and nobody's at the Mac: a restart no one sees.
  function watchForQuiet() {
    if (quietTimer) return;
    quietTimer = setInterval(() => installWhenQuiet().catch(() => {}), QUIET_CHECK_MS);
  }

  async function installWhenQuiet() {
    if (state.phase !== "ready" || idleSeconds() < AWAY_SECONDS) return false;
    const running = await countRunning().catch(() => null);
    if (running !== 0) return false; // a count the server couldn't give is busy, never idle
    return installNow();
  }

  // Restarts into the downloaded update without asking: the server's restart when idle calls this once nothing runs.
  function installNow() {
    if (state.phase !== "ready") return false;
    onBeforeInstall();
    autoUpdater.quitAndInstall();
    return true;
  }

  function download() {
    if (state.page) openExternal(state.page);
  }

  function start() {
    if (!packaged || timer) return;
    timer = setTimeout(function tick() {
      check().catch(() => {});
      timer = setTimeout(tick, CHECK_EVERY_MS);
    }, FIRST_CHECK_MS);
  }

  function stop() {
    clearTimeout(timer);
    clearInterval(quietTimer);
    timer = null;
    quietTimer = null;
  }

  return {
    check,
    install,
    installNow,
    installWhenQuiet,
    download,
    start,
    stop,
    state: () => state,
    // Everything the update window draws (electron/update-view.cjs turns it into words and buttons).
    info: () => ({ state, currentVersion, packaged, feed }),
    menuItem: () => {
      const item = menuItem(state, { install: () => install(), download, check: () => check({ manual: true }) });
      if (!openWindow) return item;
      const click = () => {
        openWindow();
        if (state.phase === "idle") check().catch(() => {});
      };
      return { ...item, enabled: true, click };
    },
  };
}

// The updater with Electron's own pieces: Squirrel, dialogs, a notification, and the board's running count.
function createAppUpdater({ getServer, onChange, openWindow }) {
  const { armRestart } = require("./restart-when-idle.cjs");
  const { BaseWindow, Notification, app, autoUpdater, dialog, powerMonitor, shell } = require("electron");
  let shown = null; // the last notification, held so its click handlers outlive garbage collection
  return createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    autoUpdater,
    countRunning: async () => {
      const server = getServer();
      if (!server) return null;
      const { cards } = await (await fetch(`${server.url}/api/cards`)).json();
      return cards.filter((card) => card.column === "running").length;
    },
    ask: async (message, detail) => {
      const buttons = ["Restart When Idle", "Restart Now", "Not Now"];
      const { response } = await dialog.showMessageBox({ type: "question", message, detail, buttons, defaultId: 0, cancelId: 2 });
      return ["idle", "now", null][response];
    },
    restartWhenIdle: async () => {
      const error = await armRestart(getServer(), "update");
      if (error) dialog.showMessageBox({ type: "warning", message: "Couldn't wait for the threads to finish", detail: error });
    },
    tell: (message, detail) => dialog.showMessageBox({ type: "info", message, detail }),
    notify: (title, body, on = {}) => {
      if (!Notification.isSupported()) return;
      shown = new Notification({ title, body, actions: on.install ? [{ type: "button", text: "Restart Now" }] : [] });
      if (on.open) shown.on("click", on.open);
      if (on.install) shown.on("action", on.install);
      shown.show();
    },
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    openExternal: (url) => shell.openExternal(url),
    // quitAndInstall closes every window first, and the board's close handler only hides it; destroying skips that.
    onBeforeInstall: () => BaseWindow.getAllWindows().forEach((w) => w.destroy()),
    onChange,
    openWindow,
  });
}

module.exports = {
  createAppUpdater, createUpdater, compareVersions, newerRelease, menuItem, FEED, CHECK_EVERY_MS, FIRST_CHECK_MS, AWAY_SECONDS, QUIET_CHECK_MS,
};
