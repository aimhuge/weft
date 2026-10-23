// A mini app's link-preview screenshot (lib/app-preview-capture.ts): the app's page in a hidden, sandboxed window at
// 1200×630, captured once it has painted. Its own in-memory session, so it carries none of the pane's sign-ins, no
// popups, no navigation to another site, muted. One at a time: a share that starts while one runs waits its turn.
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

function createPageSnapshot({ BrowserWindow }) {
  let queue = Promise.resolve();

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
      },
    });
    try {
      const wc = win.webContents;
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
      await sleep(clamp(settleMs, 0, 10000, 1200));
      let image = await wc.capturePage();
      if (image.isEmpty()) return { png: null };
      const size = image.getSize();
      if (size.width !== w || size.height !== h) image = image.resize({ width: w, height: h, quality: "good" });
      return { png: image.toPNG().toString("base64") };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  function snapshot(body = {}) {
    const run = queue.then(() => capture(body));
    queue = run.catch(() => {});
    return run;
  }

  return { snapshot };
}

// The control server's route; the snapper is made on first use, so Electron is only required inside main.
function snapshotRoutes(getSnapper) {
  let snapper;
  return {
    "POST /page/snapshot": (body) => (snapper ??= getSnapper()).snapshot(body),
  };
}

module.exports = { createPageSnapshot, snapshotRoutes };
