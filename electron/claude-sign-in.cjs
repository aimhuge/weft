// One click to sign a Weft Worker's Claude Code in (docs/architecture/weft-worker.md#signing-claude-in). A worker
// runs as a background service, which can't answer a keychain prompt, so it needs a long-lived token from
// `claude setup-token`. Main runs that command on a hidden pty and points $BROWSER at a tiny script, so the CLI hands
// its approval URL to Weft instead of opening your default browser. Main opens the URL in a small Weft window beside
// the click, in the browser pane's own session (so claude.ai already knows you), and reads the token off the CLI's
// output once you approve. The token goes back to the board only, which seals it to the worker (lib/worker-seal.ts).
//
// When Claude's page shows a code instead of handing it back (no localhost callback), the window's URL carries it
// (?code=…&state=…) and main types it into the CLI's "Paste code here" prompt, so no step asks you to copy anything.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIMEOUT_MS = 5 * 60_000;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const TOKEN = /sk-ant-oat\d\d-[A-Za-z0-9_-]{20,}/;
// Claude Code 2.1.29x sends you to claude.com/cai/oauth/authorize; older builds to claude.ai or the console.
const AUTH_URL = /https:\/\/(?:claude\.ai|claude\.com|console\.anthropic\.com|platform\.claude\.com)\/(?:cai\/)?oauth\/authorize\?\S+/;

const plain = (text) => String(text).replace(ANSI, "");
// The token in what the CLI printed so far, or null. The pty is wide enough that it never wraps.
const tokenIn = (text) => plain(text).match(TOKEN)?.[0] ?? null;
const urlIn = (text) => plain(text).match(AUTH_URL)?.[0] ?? null;

// The code Claude's callback page carries when it shows one to paste, as the CLI wants it ("code#state").
function pastedCode(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return null;
    if (!/\/oauth\/code\/callback|\/callback/.test(u.pathname)) return null;
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    return code && state ? `${code}#${state}` : null;
  } catch {
    return null;
  }
}

// What setup-token runs with: your own env, without what a Claude session Weft was started from would lend it.
function signInEnv(env, browser, urlFile) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|ANTHROPIC_BASE_URL$)/.test(k)) out[k] = v;
  return { ...out, BROWSER: browser, WEFT_SIGN_IN_URL_FILE: urlFile, TERM: "xterm-256color" };
}

// Where the popup sits: beside the click, inside the screen the click was on.
function besideClick(click, workArea, size) {
  const x = Math.round(click.x + 16 + size.width > workArea.x + workArea.width ? click.x - 16 - size.width : click.x + 16);
  const y = Math.round(Math.min(Math.max(click.y - 80, workArea.y), workArea.y + workArea.height - size.height));
  return { x: Math.max(workArea.x, x), y };
}

function claudeBinary() {
  const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
  return path.join(path.dirname(pkg), "claude").replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function registerClaudeSignIn(ipcMain, { isBoard, loadPty, partition }) {
  let running = null;

  ipcMain.handle("claude-sign-in:start", async (e, click) => {
    if (!isBoard(e.sender)) return { error: "Sign-in only answers the board window." };
    if (running) running.finish({ error: "Started again." });
    const { BrowserWindow, screen } = require("electron");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-claude-sign-in-"));
    const urlFile = path.join(dir, "url");
    const browser = path.join(dir, "open-url");
    fs.writeFileSync(browser, '#!/bin/sh\nprintf "%s" "$1" > "$WEFT_SIGN_IN_URL_FILE"\n', { mode: 0o700 });

    return new Promise((resolve) => {
      let output = "";
      let popup = null;
      let done = false;
      const proc = loadPty().spawn(claudeBinary(), ["setup-token"], {
        name: "xterm-256color",
        cols: 400,
        rows: 50,
        cwd: os.homedir(),
        env: signInEnv(process.env, browser, urlFile),
      });
      const timer = setTimeout(() => finish({ error: "Sign-in timed out. Try again." }), TIMEOUT_MS);
      const watch = setInterval(() => {
        if (popup || !fs.existsSync(urlFile)) return;
        const url = fs.readFileSync(urlFile, "utf8").trim();
        // A sign-in page Weft doesn't know would otherwise leave the button waiting for five minutes.
        if (!AUTH_URL.test(url)) return finish({ error: `Claude asked to open a page Weft doesn't expect: ${url.split("?")[0]}` });
        openPopup(url);
      }, 250);

      function finish(result) {
        if (done) return;
        done = true;
        running = null;
        clearTimeout(timer);
        clearInterval(watch);
        try {
          proc.onData(() => {});
          proc.kill();
        } catch {}
        if (popup && !popup.isDestroyed()) popup.destroy();
        fs.rmSync(dir, { recursive: true, force: true });
        resolve(result);
      }
      running = { finish };

      function openPopup(url) {
        if (popup || !AUTH_URL.test(url)) return;
        const size = { width: 480, height: 720 };
        const point = click && Number.isFinite(click.x) && Number.isFinite(click.y) ? click : screen.getCursorScreenPoint();
        const { x, y } = besideClick(point, screen.getDisplayNearestPoint(point).workArea, size);
        popup = new BrowserWindow({
          ...size,
          x,
          y,
          title: "Sign in to Claude",
          alwaysOnTop: true,
          webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        popup.setMenuBarVisibility(false);
        // No pop-ups of its own, and nothing but Anthropic's pages and the CLI's own localhost callback.
        popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        const onNav = (_ev, next) => {
          const code = pastedCode(next);
          if (code) proc.write(`${code}\r`);
        };
        popup.webContents.on("did-navigate", onNav);
        popup.webContents.on("did-redirect-navigation", onNav);
        popup.on("closed", () => {
          popup = null;
          // Closed by hand before the token came: give the CLI a moment, in case approving was the last click.
          setTimeout(() => finish({ error: "The sign-in window closed before Claude sent a token." }), 3_000);
        });
        void popup.loadURL(url);
      }

      proc.onData((data) => {
        output = (output + data).slice(-50_000);
        const token = tokenIn(output);
        if (token) return finish({ token });
        const url = urlIn(output);
        if (url) openPopup(url);
      });
      proc.onExit(() => {
        const token = tokenIn(output);
        finish(token ? { token } : { error: "claude setup-token stopped without a token. Is this Mac's Claude subscription signed in?" });
      });
    });
  });

  ipcMain.on("claude-sign-in:cancel", (e) => {
    if (isBoard(e.sender) && running) running.finish({ error: "Cancelled." });
  });

  return () => running?.finish({ error: "Weft is quitting." });
}

// What main.cjs calls: the pty is the terminal drawer's, the session the browser pane's, and a sign-in still
// running when Weft quits is ended with it.
function setupClaudeSignIn(ipcMain, { isBoard }) {
  const end = registerClaudeSignIn(ipcMain, { isBoard, loadPty: require("./terminal.cjs").loadPty, partition: require("./browser-pane.cjs").PANE_PARTITION });
  require("electron").app.on("will-quit", end);
}

module.exports = { setupClaudeSignIn, registerClaudeSignIn, tokenIn, urlIn, pastedCode, signInEnv, besideClick };
