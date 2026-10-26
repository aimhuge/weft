// Opening a folder from the board. Reveal in Finder (the card and project menus), and "Open in Editor" and
// "Open in Terminal" on a project's right-click menu (lib/project-menu.ts): those open the folder in the first
// of these apps that's installed, and answer with the app's name, or null when none is.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");

const APPS = {
  editor: ["Cursor", "Visual Studio Code", "Zed", "Windsurf", "Sublime Text", "Nova"],
  terminal: ["Ghostty", "iTerm", "Warp", "Terminal"],
};

function appDirs(home) {
  return ["/Applications", path.join(home, "Applications"), "/Applications/Utilities", "/System/Applications/Utilities"];
}

function findApp(names, { exists = fs.existsSync, home = os.homedir() } = {}) {
  for (const name of names) {
    if (appDirs(home).some((dir) => exists(path.join(dir, `${name}.app`)))) return name;
  }
  return null;
}

// deps are for tests: exists, home, and run (spawns `open -a <app> <folder>`).
async function openIn(folder, target, deps = {}) {
  const { exists = fs.existsSync, run = runOpen } = deps;
  const names = APPS[target];
  if (!names || !path.isAbsolute(folder) || !exists(folder)) return null;
  const app = findApp(names, deps);
  if (!app) return null;
  await run(app, folder);
  return app;
}

function runOpen(app, folder) {
  return new Promise((resolve, reject) => execFile("open", ["-a", app, folder], (err) => (err ? reject(err) : resolve())));
}

// deps.shell is Electron's; the rest are openIn's test seams.
function registerOpenIn(ipcMain, deps) {
  const { shell, exists = fs.existsSync } = deps;
  ipcMain.on("shell:reveal", (_e, folder) => path.isAbsolute(String(folder)) && exists(String(folder)) && shell.openPath(String(folder)));
  ipcMain.handle("shell:openIn", (_e, folder, target) => openIn(String(folder), String(target), deps));
}

module.exports = { APPS, findApp, openIn, registerOpenIn };
