// The server patcher (patcher.cjs) with Electron's own pieces: fetch, tar, the staged patches on disk, a
// notification, and the board's server, which it restarts into a patch and then reloads every page it serves.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPatcher } = require("./patcher.cjs");
const { PATCH_PUBLIC_KEY } = require("./patch-key.cjs");
const { badBuilds, bundledDeps, runningPatch, stagePatch, stagedPatch } = require("./server-patch.cjs");

async function fetchFeed(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null; // no patch published yet
  if (!res.ok) throw new Error(`patch feed: HTTP ${res.status}`);
  return res.json();
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`server patch: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function createAppPatcher({ getServer, countRunning, restartWhenIdle, busy, onChange }) {
  const { Notification, app, dialog, powerMonitor, webContents } = require("electron");
  let shown = null; // held so the notification's handlers outlive garbage collection
  return createPatcher({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    publicKey: PATCH_PUBLIC_KEY,
    fetchJson: fetchFeed,
    download,
    stage: (details, bytes) => {
      const tar = path.join(os.tmpdir(), `weft-patch-${process.pid}.tar.gz`);
      fs.writeFileSync(tar, bytes);
      try {
        return stagePatch(app, details, tar, (file, dir) => execFileSync("/usr/bin/tar", ["-xzf", file, "-C", dir]));
      } finally {
        fs.rmSync(tar, { force: true });
      }
    },
    readLocal: () => {
      const seqs = [stagedPatch(app)?.seq, runningPatch()?.seq].filter(Number.isFinite);
      return { deps: bundledDeps(process.resourcesPath), activeSeq: Math.max(0, ...seqs), bad: badBuilds(app) };
    },
    countRunning,
    restartWhenIdle,
    busy,
    onChange,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    // The server restarts into the staged patch (server.cjs re-reads it on every launch); the board and any other
    // page it serves reload, so the UI matches the server behind it.
    applyNow: async () => {
      const server = getServer();
      if (!server) throw new Error("Weft's server isn't running.");
      await server.restart();
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getURL().startsWith(server.url)) contents.reload();
      }
    },
    ask: async (message, detail) => {
      const buttons = ["Switch When Idle", "Switch Now", "Not Now"];
      const { response } = await dialog.showMessageBox({ type: "question", message, detail, buttons, defaultId: 0, cancelId: 2 });
      return ["idle", "now", null][response];
    },
    notify: (title, body, on = {}) => {
      if (!Notification.isSupported()) return;
      shown = new Notification({ title, body, actions: [{ type: "button", text: "Switch Now" }] });
      shown.on("action", on.apply);
      shown.show();
    },
  });
}

module.exports = { createAppPatcher, fetchFeed };
