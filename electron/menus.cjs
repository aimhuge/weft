// The app menu, right-click menus, menu bar icon and dock menu. main.cjs passes in the windows and
// actions they reach for; getters stand in for windows that don't exist yet.
const { BaseWindow, Menu, Tray, app, clipboard, dialog, nativeImage, shell, webContents } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { showAboutWindow } = require("./about.cjs");
const { READ_HEADERS } = require("./server-read.cjs");
const { createKeepWorking } = require("./keep-working.cjs");
const { armRestart } = require("./restart-when-idle.cjs");
const { createAppUpdater } = require("./updater.cjs");
const { pushUpdateState, registerUpdateBridge, showUpdateWindow } = require("./update-window.cjs");

function createMenus({ APP_NAME, ASSETS, COPILOT_SHORTCUT, mac, pane, getWin, getAppView, getServer, showMain, sendMenu, showCopilot, toggleCopilot, dataDir }) {
  let tray;
  let lastWaiting = [];
  // Keep Working (keep-working.cjs): awake with the lid shut, from the menu bar icon.
  const keepWorking = mac ? createKeepWorking({ getServer, onChange: () => updateTray() }) : null;
  // Updates (updater.cjs): its state is an item in the app menu, which opens the Software Update window.
  const onUpdate = () => {
    buildMenu();
    pushUpdateState();
  };
  const updater = createAppUpdater({ getServer, onChange: onUpdate, openWindow: showUpdateWindow });
  registerUpdateBridge(updater);

  function focusedContents() {
    return webContents.getFocusedWebContents() ?? getAppView()?.webContents;
  }

  // The browser pane's pages zoom in Chrome's steps and report it to the pane's toolbar; the board
  // keeps its half-level steps.
  function zoomFocused(action) {
    const c = focusedContents();
    if (!c) return;
    if (pane.owns(c)) return pane.zoom(action);
    c.setZoomLevel(action === "reset" ? 0 : c.getZoomLevel() + (action === "in" ? 0.5 : -0.5));
  }

  function buildMenu() {
    // Not `role: "about"`: the native panel shows text and nothing else; ours is a window (about.cjs).
    const aboutItem = { label: `About ${APP_NAME}`, click: showAboutWindow };
    const template = [
      ...(mac
        ? [
            {
              label: APP_NAME,
              submenu: [
                aboutItem,
                updater.menuItem(),
                { type: "separator" },
                {
                  label: "Settings…",
                  accelerator: "CmdOrCtrl+,",
                  click: () => {
                    showMain();
                    sendMenu("settings");
                  },
                },
                {
                  label: "Open at Login",
                  type: "checkbox",
                  checked: app.getLoginItemSettings().openAtLogin,
                  click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
                },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                // Waits for the running threads to finish, starting nothing new, then restarts (restart-when-idle.cjs).
                {
                  label: "Restart When Idle",
                  click: async () => {
                    const error = await armRestart(getServer());
                    if (error) dialog.showMessageBox({ type: "warning", message: "Couldn't restart Weft", detail: error });
                  },
                },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "File",
        submenu: [
          {
            label: "New Thread",
            accelerator: "CmdOrCtrl+N",
            click: () => {
              showMain();
              sendMenu("new-thread");
            },
          },
          // The app menu's update item again, where people look for it (and the only one off a Mac).
          updater.menuItem(),
          { type: "separator" },
          { label: "Close Window", accelerator: "CmdOrCtrl+W", click: () => BaseWindow.getFocusedWindow()?.close() },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
          { type: "separator" },
          {
            label: "Find Cards",
            accelerator: "CmdOrCtrl+F",
            click: () => {
              showMain();
              sendMenu("find");
            },
          },
        ],
      },
      {
        label: "View",
        submenu: [
          { label: "Copilot", accelerator: "CmdOrCtrl+J", click: toggleCopilot },
          { label: "Browser", accelerator: "CmdOrCtrl+Shift+B", click: () => pane.setVisible(!pane.isVisible()) },
          {
            label: "Terminal",
            // VS Code's toggle; Control on macOS too.
            accelerator: "Ctrl+`",
            click: () => {
              showMain();
              sendMenu("terminal");
            },
          },
          { type: "separator" },
          { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => focusedContents()?.reload() },
          { label: "Developer Tools", accelerator: "Alt+CmdOrCtrl+I", click: () => focusedContents()?.toggleDevTools() },
          { type: "separator" },
          { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoomFocused("reset") },
          {
            label: "Zoom In",
            accelerator: "CmdOrCtrl+Plus",
            click: () => zoomFocused("in"),
          },
          {
            label: "Zoom Out",
            accelerator: "CmdOrCtrl+-",
            click: () => zoomFocused("out"),
          },
          { type: "separator" },
          { label: "Enter Full Screen", accelerator: "Ctrl+Cmd+F", click: () => getWin()?.setFullScreen(!getWin().isFullScreen()) },
        ],
      },
      {
        label: "Window",
        submenu: [
          { label: "Minimize", accelerator: "CmdOrCtrl+M", click: () => BaseWindow.getFocusedWindow()?.minimize() },
          { label: "Zoom", click: () => getWin()?.maximize() },
          { type: "separator" },
          { label: "Board", accelerator: "CmdOrCtrl+1", click: showMain },
          { label: "Copilot", accelerator: "CmdOrCtrl+2", click: showCopilot },
        ],
      },
      {
        role: "help",
        submenu: [
          { label: "Open Logs Folder", click: () => shell.openPath(app.getPath("logs")) },
          { label: "Open Data Folder", click: () => shell.openPath(dataDir()) },
          ...(mac ? [] : [{ type: "separator" }, aboutItem]),
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function attachContextMenu(contents) {
    contents.on("context-menu", (_event, params) => {
      const items = [];
      if (params.linkURL && /^https?:/i.test(params.linkURL)) {
        items.push(
          { label: "Open Link in Browser Pane", click: () => pane.open(params.linkURL, undefined, false, { fromBoard: true }).catch(() => {}) },
          { label: "Open Link in Default Browser", click: () => shell.openExternal(params.linkURL) },
          { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
          { type: "separator" },
        );
      }
      if (params.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
      else if (params.selectionText) items.push({ role: "copy" });
      if (!app.isPackaged) items.push({ type: "separator" }, { label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) });
      while (items.length && items[0].type === "separator") items.shift();
      while (items.length && items.at(-1).type === "separator") items.pop();
      if (items.length) Menu.buildFromTemplate(items).popup();
    });
  }

  // A CJS twin of lib/format.ts's clip, which main can't import. Keep the `max - 1` slice and the
  // ellipsis: the rule is "at most max characters, ellipsis counted", and a tray label that renders
  // one character over its budget is how the two copies drifted in the first place.
  function clip(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function createTray() {
    const icon = path.join(ASSETS, "trayTemplate.png");
    if (!fs.existsSync(icon)) return;
    tray = new Tray(nativeImage.createFromPath(icon));
    tray.setToolTip(APP_NAME);
    updateTray([]);
  }

  // The menu bar icon shows how many cards need you, and lists them, plus a cup while Keep Working is on.
  function updateTray(waiting = lastWaiting) {
    if (!tray) return;
    lastWaiting = waiting;
    const count = waiting.length;
    const title = [keepWorking?.title(), count > 0 ? String(count) : ""].filter(Boolean).join("  ");
    tray.setTitle(title ? ` ${title}` : "");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: count > 0 ? `${count} ${count === 1 ? "card needs" : "cards need"} you` : "Nothing needs you", enabled: false },
        ...waiting.slice(0, 8).map((card) => ({
          label: clip(card.title, 48),
          click: () => {
            showMain();
            sendMenu("open-card", card.id);
          },
        })),
        { type: "separator" },
        ...(keepWorking ? [keepWorking.menu(), { type: "separator" }] : []),
        { label: `Open ${APP_NAME}`, click: showMain },
        { label: "Copilot", accelerator: COPILOT_SHORTCUT, click: showCopilot },
        {
          label: "New Thread",
          click: () => {
            showMain();
            sendMenu("new-thread");
          },
        },
        { type: "separator" },
        { label: `Quit ${APP_NAME}`, click: () => app.quit() },
      ]),
    );
  }

  async function refreshWaiting(count) {
    if (mac) app.dock.setBadge(count > 0 ? String(count) : "");
    const server = getServer();
    if (!server) return;
    try {
      const { cards } = await (await fetch(`${server.url}/api/cards`, READ_HEADERS)).json();
      updateTray(cards.filter((card) => card.column === "needs_you"));
    } catch {}
  }

  function setupDock() {
    if (!mac) return;
    const icon = path.join(ASSETS, "icon.png");
    if (!app.isPackaged && fs.existsSync(icon)) app.dock.setIcon(icon);
    app.dock.setMenu(
      Menu.buildFromTemplate([
        {
          label: "New Thread",
          click: () => {
            showMain();
            sendMenu("new-thread");
          },
        },
        { label: "Copilot", click: showCopilot },
      ]),
    );
  }

  return { buildMenu, attachContextMenu, createTray, refreshWaiting, setupDock, keepWorking, updater };
}

module.exports = { createMenus };
