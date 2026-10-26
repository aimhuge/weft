const { contextBridge, ipcRenderer, webFrame } = require("electron");

function listen(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

// The UI's only door into the shell: the side browser pane, the copilot window, native dialogs,
// and menu, dock, tray, and shortcut actions.
contextBridge.exposeInMainWorld("weft", {
  desktop: true,
  platform: process.platform,
  // The page's zoom (View > Zoom In/Out); the traffic lights don't zoom, so the title bar scales back.
  zoomFactor: () => webFrame.getZoomFactor(),
  browser: {
    open: (url, key) => ipcRenderer.invoke("browser:open", url, key),
    setActive: (key) => ipcRenderer.send("browser:active", key),
    prune: (keys) => ipcRenderer.send("browser:prune", keys),
    getState: () => ipcRenderer.invoke("browser:state"),
    setVisible: (visible) => ipcRenderer.send("browser:visible", visible),
    setBounds: (rect) => ipcRenderer.send("browser:bounds", rect),
    back: () => ipcRenderer.send("browser:back"),
    forward: () => ipcRenderer.send("browser:forward"),
    reload: () => ipcRenderer.send("browser:reload"),
    zoom: (action) => ipcRenderer.send("browser:zoom", action),
    onState: (callback) => listen("browser:state", callback),
  },
  dialog: {
    openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  },
  openExternal: (url) => ipcRenderer.send("shell:openExternal", url),
  // The printers macOS has, and printing a page of HTML through the system print dialog (electron/print.cjs).
  print: {
    printers: () => ipcRenderer.invoke("print:printers"),
    html: (html) => ipcRenderer.invoke("print:html", html),
  },
  revealFolder: (folder) => ipcRenderer.send("shell:reveal", folder),
  openIn: (folder, target) => ipcRenderer.invoke("shell:openIn", folder, target),
  popupMenu: (items) => ipcRenderer.invoke("menu:popup", items),
  setBadge: (count) => ipcRenderer.send("badge:set", count),
  copilot: {
    toggle: () => ipcRenderer.send("copilot:toggle"),
    onState: (callback) => listen("copilot:state", callback),
  },
  // The terminal drawer's shells (electron/terminal.cjs).
  terminal: {
    open: (id, cwd, cols, rows) => ipcRenderer.invoke("terminal:open", id, cwd, cols, rows),
    write: (id, data) => ipcRenderer.send("terminal:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", id, cols, rows),
    kill: (id) => ipcRenderer.send("terminal:kill", id),
    onData: (callback) => listen("terminal:data", callback),
    onExit: (callback) => listen("terminal:exit", callback),
  },
  // Keep Working (electron/keep-working.cjs): Settings → Laptop mode uses this; main pushes
  // "keep-working:changed" on every state change (chip flipped, deadline ticked, watchdog restored sleep).
  keepWorking: {
    state: () => ipcRenderer.invoke("keep-working:state"),
    start: (mode, hours) => ipcRenderer.invoke("keep-working:start", mode, hours),
    stop: () => ipcRenderer.invoke("keep-working:stop"),
    setPrefs: (patch) => ipcRenderer.invoke("keep-working:prefs", patch),
    onChange: (callback) => listen("keep-working:changed", callback),
  },
  // The secrets vault (electron/vault.cjs). Main answers only the board window, so the copilot's copy of
  // this bridge gets errors; browser-pane pages have no preload at all.
  vault: {
    overview: (folders) => ipcRenderer.invoke("vault:overview", folders),
    scan: (folder) => ipcRenderer.invoke("vault:scan", folder),
    import: (folder, picks) => ipcRenderer.invoke("vault:import", folder, picks),
    reveal: (id, name, environment) => ipcRenderer.invoke("vault:reveal", id, name, environment),
    copy: (id, name, environment) => ipcRenderer.invoke("vault:copy", id, name, environment),
    set: (folder, name, environment, value) => ipcRenderer.invoke("vault:set", folder, name, environment, value),
    addBlank: (folder, name, environment) => ipcRenderer.invoke("vault:add-blank", folder, name, environment),
    copyTo: (id, name, environment, folder) => ipcRenderer.invoke("vault:copy-to", id, name, environment, folder),
    remove: (id, name, environment) => ipcRenderer.invoke("vault:remove", id, name, environment),
    lock: () => ipcRenderer.invoke("vault:lock"),
    writeBack: (folder) => ipcRenderer.invoke("vault:write-back", folder),
    // Threads' standing access (electron/vault-grants.cjs) and the audit log (electron/keychain-audit.cjs).
    grants: () => ipcRenderer.invoke("vault:grants"),
    grant: (folder, card, thread) => ipcRenderer.invoke("vault:grant", folder, card, thread),
    revoke: (card, id) => ipcRenderer.invoke("vault:revoke", card, id),
    activity: (limit) => ipcRenderer.invoke("vault:activity", limit),
    // A managed .env.local was edited by hand: load the vaults again.
    onChange: (callback) => listen("vault:changed", callback),
  },
  // Vercel (electron/vercel.cjs): the token stays in main; links are .vercel/project.json. Board window only.
  vercel: {
    status: (folders) => ipcRenderer.invoke("vercel:status", folders),
    setToken: (token) => ipcRenderer.invoke("vercel:set-token", token),
    forgetToken: () => ipcRenderer.invoke("vercel:forget-token"),
    projects: () => ipcRenderer.invoke("vercel:projects"),
    scopes: () => ipcRenderer.invoke("vercel:scopes"),
    link: (folder, projectId, orgId) => ipcRenderer.invoke("vercel:link", folder, projectId, orgId),
    create: (folder, options) => ipcRenderer.invoke("vercel:create", folder, options),
    unlink: (folder) => ipcRenderer.invoke("vercel:unlink", folder),
    // Vault → Vercel (electron/vercel-env.cjs): names only come back; a push asks Touch ID in main.
    envStatus: (folder) => ipcRenderer.invoke("vercel:env-status", folder),
    envPush: (folder, name, environment) => ipcRenderer.invoke("vercel:env-push", folder, name, environment),
    envPushAll: (folder, only) => ipcRenderer.invoke("vercel:env-push-all", folder, only),
    // The vault ⇄ Vercel drift from main's cached lists (electron/vercel-env-cache.cjs), and when one lands.
    envDrift: (folders) => ipcRenderer.invoke("vercel:env-drift", folders),
    onDrift: (callback) => listen("vercel:drift", callback),
    envPull: (folder) => ipcRenderer.invoke("vercel:env-pull", folder),
  },
  // Supabase (electron/supabase.cjs): the token stays in main; links are supabase/.temp/project-ref. Board window only.
  supabase: {
    status: (folders) => ipcRenderer.invoke("supabase:status", folders),
    setToken: (token) => ipcRenderer.invoke("supabase:set-token", token),
    forgetToken: () => ipcRenderer.invoke("supabase:forget-token"),
    projects: () => ipcRenderer.invoke("supabase:projects"),
    orgs: () => ipcRenderer.invoke("supabase:orgs"),
    create: (folder, opts) => ipcRenderer.invoke("supabase:create", folder, opts),
    link: (folder, ref) => ipcRenderer.invoke("supabase:link", folder, ref),
    unlink: (folder) => ipcRenderer.invoke("supabase:unlink", folder),
    restore: (ref) => ipcRenderer.invoke("supabase:restore", ref),
  },
  // BlastCP (electron/blastcp.cjs): the sign-in stays in main; links live in Weft's data folder. Board window only.
  blastcp: {
    status: (folders) => ipcRenderer.invoke("blastcp:status", folders),
    connect: () => ipcRenderer.invoke("blastcp:connect"),
    forget: () => ipcRenderer.invoke("blastcp:forget"),
    workspaces: () => ipcRenderer.invoke("blastcp:workspaces"),
    link: (folder, org, property, name) => ipcRenderer.invoke("blastcp:link", folder, org, property, name),
    createProperty: (folder, org, name) => ipcRenderer.invoke("blastcp:create-property", folder, org, name),
    unlink: (folder) => ipcRenderer.invoke("blastcp:unlink", folder),
  },
  // Cloudflare (electron/cloudflare.cjs): the token stays in main; links live in Weft's data folder. Board window only.
  cloudflare: {
    status: (folders) => ipcRenderer.invoke("cloudflare:status", folders),
    setToken: (token) => ipcRenderer.invoke("cloudflare:set-token", token),
    forgetToken: () => ipcRenderer.invoke("cloudflare:forget-token"),
    projects: () => ipcRenderer.invoke("cloudflare:projects"),
    link: (folder, kind, accountId, name) => ipcRenderer.invoke("cloudflare:link", folder, kind, accountId, name),
    unlink: (folder) => ipcRenderer.invoke("cloudflare:unlink", folder),
  },
  // Slack (electron/slack.cjs): the bot and app tokens stay in main; the board only asks what's there.
  // Board window only.
  slack: {
    status: () => ipcRenderer.invoke("slack:status"),
    setTokens: (bot, app) => ipcRenderer.invoke("slack:set-tokens", bot, app),
    forgetToken: () => ipcRenderer.invoke("slack:forget-token"),
    channels: () => ipcRenderer.invoke("slack:channels"),
    createChannel: (name) => ipcRenderer.invoke("slack:create-channel", name),
  },
  // Goose (electron/goose-ipc.cjs): a provider key per provider, sealed in the Keychain. The board sends a key
  // once and never reads one back — the runner's Goose subprocess gets it in its env (electron/goose-env.cjs).
  goose: {
    listProviders: () => ipcRenderer.invoke("goose:list-providers"),
    setProviderKey: (payload) => ipcRenderer.invoke("goose:set-provider-key", payload),
    forgetProviderKey: (payload) => ipcRenderer.invoke("goose:forget-provider-key", payload),
  },
  onMenu: (callback) => listen("menu", callback),
  // The board's first cards are on screen; resolves to this launch's timing (electron/startup-timer.cjs).
  startupReady: () => ipcRenderer.invoke("startup:ready"),
  // Buttons on the startup screen when the server fails to start, and "relaunch" to restart Weft.
  splashAction: (action) => ipcRenderer.send("splash:action", action),
  // Hosted mini apps: the Share dialog's "Upload secrets" button calls this to ship the
  // manifest's author secrets and public values to weft.zip, after Touch ID in main.
  appSecrets: {
    push: (appId) => ipcRenderer.invoke("apps:push-secrets", String(appId ?? "")),
  },
  // The dev server supervisor (electron/server.cjs, electron/server-ipc.cjs). The bar that shows
  // when the budget trips (components/ServerErrorBar.tsx) calls retry/logTail/createFixCard and
  // listens to onStatus / onFatal — main pushes those when a child crashes or the budget trips.
  server: {
    retry: () => ipcRenderer.invoke("server:retry"),
    logTail: () => ipcRenderer.invoke("server:log-tail"),
    openLogs: () => ipcRenderer.invoke("server:open-logs"),
    createFixCard: () => ipcRenderer.invoke("weft:create-fix-card"),
    onStatus: (callback) => listen("server:status", callback),
    onFatal: (callback) => listen("server:fatal", callback),
  },
});
