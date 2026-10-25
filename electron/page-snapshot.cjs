// A mini app's link-preview screenshot (lib/app-preview-capture.ts): the app's page in a hidden, sandboxed window at
// 1200×630, captured once it has painted. Its own in-memory session, so it carries none of the pane's sign-ins, no
// popups, no navigation to another site, muted. One at a time: a share that starts while one runs waits its turn.
// A saved data app gets a read-only window.weft (electron/snapshot-preload.cjs; main counts these windows as the pane's
// through ownsSnapshot), so the capture shows its numbers, not "Open this app in Weft"; the capture waits for the page
// to stop changing, since those reads land after load.
const path = require("node:path");

const ALLOWED = new Set(["http:", "https:", "file:"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, lo, hi, fallback) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : fallback);

function checkUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    url = null;
  }
  if (!url || !ALLOWED.has(url.protocol)) throw new Error("Only http, https and file pages can be captured.");
  return url;
}

// Resolves once the page's DOM has been quiet for `quietMs` (its reads have drawn), or after `maxMs` either way.
const SETTLE_SCRIPT = (quietMs, maxMs) => `new Promise((done) => {
  let quiet = setTimeout(done, ${quietMs});
  const stop = setTimeout(done, ${maxMs});
  new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(() => { clearTimeout(stop); done(); }, ${quietMs}); })
    .observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
})`;

async function settle(wc, settleMs) {
  const quiet = clamp(settleMs, 0, 10000, 1200);
  if (typeof wc.executeJavaScript !== "function") return sleep(quiet);
  await Promise.race([wc.executeJavaScript(SETTLE_SCRIPT(quiet, 10000)).catch(() => sleep(quiet)), sleep(12000)]);
}

/**
 * @param {{ BrowserWindow: any, preload?: string }} options
 */
function createPageSnapshot({ BrowserWindow, preload }) {
  let queue = Promise.resolve();
  const live = new Set();

  async function capture({ url, width, height, settleMs, timeoutMs }) {
    const page = checkUrl(url);
    const w = clamp(width, 320, 1600, 1200);
    const h = clamp(height, 200, 1200, 630);
    const win = new BrowserWindow({
      show: false,
      width: w,
      height: h,
      useContentSize: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "weft-snapshot",
        backgroundThrottling: false,
        ...(preload ? { preload } : {}),
      },
    });
    try {
      const wc = win.webContents;
      live.add(wc);
      wc.setAudioMuted(true);
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      // Redirects within the app are fine; a jump to another site (a sign-in wall) isn't the app.
      wc.on("will-navigate", (event, next) => {
        try {
          if (new URL(next).origin !== page.origin) event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
      // A page that never finishes loading is still captured once the time's up, as far as it painted.
      await Promise.race([win.loadURL(page.href).catch(() => {}), sleep(clamp(timeoutMs, 0, 60000, 15000))]);
      await settle(wc, settleMs);
      let image = await wc.capturePage();
      if (image.isEmpty()) return { png: null };
      const size = image.getSize();
      if (size.width !== w || size.height !== h) image = image.resize({ width: w, height: h, quality: "good" });
      return { png: image.toPNG().toString("base64") };
    } finally {
      live.delete(win.webContents);
      if (!win.isDestroyed()) win.destroy();
    }
  }

  function snapshot(body = {}) {
    const run = queue.then(() => capture(body));
    queue = run.catch(() => {});
    return run;
  }

  return { snapshot, owns: (wc) => live.has(wc) };
}

// The one snapper main uses, made on first use so Electron is only required inside main.
let shared = null;
function sharedSnapshot() {
  shared ??= createPageSnapshot({ BrowserWindow: require("electron").BrowserWindow, preload: path.join(__dirname, "snapshot-preload.cjs") });
  return shared;
}

// Whether a webContents is a capture window, for the data app reads' sender check (electron/app-data-frame.cjs).
function ownsSnapshot(wc) {
  return Boolean(shared?.owns(wc));
}

// The control server's route.
function snapshotRoutes(getSnapper) {
  let snapper;
  return {
    "POST /page/snapshot": (body) => (snapper ??= getSnapper()).snapshot(body),
  };
}

module.exports = { createPageSnapshot, snapshotRoutes, sharedSnapshot, ownsSnapshot };
