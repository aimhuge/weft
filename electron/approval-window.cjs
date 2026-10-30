// The question before a command or dev server runs with vault values (electron/secret-run.cjs): Weft's own
// small window over the board, in place of macOS's plain alert. It sits above the browser pane (a native view
// the board's own dialogs can't cover), and answers "once", "always" or null. Everything shown comes from a
// thread, so every string is escaped and the page runs only its own script (a nonce'd CSP); it has no preload
// and no bridge, and main reads the answer by awaiting a promise on the page.
const crypto = require("node:crypto");
const os = require("node:os");

const WIDTH = 480;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 640;

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function tilde(dir, home = os.homedir()) {
  const d = String(dir ?? "");
  return home && (d === home || d.startsWith(`${home}/`)) ? `~${d.slice(home.length)}` : d;
}

// "name: body" lines from lib/secret-command.ts packageScript.
function scriptLines(script) {
  if (!script) return [];
  return String(script)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = /^([^\s:]+): (.*)$/s.exec(line);
      return m ? { name: m[1], body: m[2] } : { name: "", body: line };
    });
}

const ICONS = {
  lock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16.5 10.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 5 9 7a8 8 0 0 1-2.2 3.3M6.3 6.3C4.2 7.8 3 10.4 3 12c0 2 4 7 9 7a9 9 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  finger: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 8.5a6.5 6.5 0 0 1 11.6 2.2M5 12.5c0-1 .1-1.9.4-2.7M18.9 14c0 2-.3 3.9-.9 5.6"/><path d="M8.6 18.6c.6-1.8.9-3.7.9-5.8a2.5 2.5 0 0 1 5 0c0 2.7-.4 5.2-1.2 7.4"/><path d="M12 12.8c0 3.3-.6 6.2-1.9 8.4M6.4 16.4c.4-1 .6-2.3.7-3.6"/></svg>',
};

/**
 * @param {{ kind?: string, command: string, cwd: string, script?: string, names: string[], environment: string, label: string, thread?: string, why?: string }} view
 * @param {{ touchId?: boolean, nonce?: string, home?: string }} [opts]
 */
function approvalHtml(view, { touchId = false, nonce = "n", home } = {}) {
  const dev = view.kind === "dev";
  const title = dev ? "Start the dev server with secrets?" : "Run a command with secrets?";
  const who = view.thread ? `<b class="thread">${escape(view.thread)}</b>` : "";
  const lead = dev
    ? `${who ? `${who}'s` : "This card's"} dev server gets <b>${escape(view.label)}</b>'s ${escape(view.environment)} values in its env.`
    : `${who || "A thread"} wants to run this with values from the <b>${escape(view.label)}</b> vault.`;
  const why = view.why ? `<div class="why"><div class="label">Why</div><p>${escape(view.why)}</p></div>` : "";
  const env = ["production", "preview", "development"].includes(view.environment) ? view.environment : "other";
  const runs = scriptLines(view.script)
    .map((s) => `<div class="row"><span class="tag">${s.name ? escape(s.name) : "runs"}</span><code>${escape(s.body)}</code></div>`)
    .join("");
  const chips = view.names.map((n) => `<span class="chip">${ICONS.key}${escape(n)}</span>`).join("");
  const sample = view.names[0] ? `‹${escape(view.names[0])}›` : "‹NAME›";
  const allow = `${touchId ? ICONS.finger : ""}Allow for 1 hour`;
  const hint = touchId ? `<span class="hint" id="hint">${ICONS.finger}Touch ID to allow for 1 hour</span>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escape(nonce)}'">
<title>${escape(title)}</title>
<style>
:root { --panel:#ffffff; --sunken:#f1efe9; --line:rgb(20 20 15 / .1); --ink:#1c1b18; --muted:#6a6862; --accent:#2c6bd6; --accent-ink:#fff;
  --prod:#c2410c; --prod-soft:rgb(234 88 12 / .12); --prev:#a16207; --prev-soft:rgb(202 138 4 / .14); --dev:#15803d; --dev-soft:rgb(22 163 74 / .12); }
@media (prefers-color-scheme: dark) { :root { --panel:#1d1d1b; --sunken:#151513; --line:rgb(255 255 245 / .09); --ink:#ecebe6; --muted:#a3a19a; --accent:#6ea0f5; --accent-ink:#0d1626;
  --prod:#fb923c; --prod-soft:rgb(251 146 60 / .14); --prev:#facc15; --prev-soft:rgb(250 204 21 / .12); --dev:#4ade80; --dev-soft:rgb(74 222 128 / .12); } }
* { box-sizing:border-box; margin:0; }
html, body { background:transparent; }
body { font:13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; color:var(--ink); padding:10px; -webkit-user-select:none; user-select:none; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:14px; box-shadow:0 18px 50px rgb(0 0 0 / .35), 0 2px 8px rgb(0 0 0 / .15); overflow:hidden; }
header { display:flex; gap:12px; padding:18px 20px 14px; -webkit-app-region:drag; }
.badge { flex:none; width:38px; height:38px; border-radius:10px; display:grid; place-items:center; color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
h1 { font-size:15px; font-weight:600; letter-spacing:-.01em; }
.lead { color:var(--muted); margin-top:2px; }
.lead b { color:var(--ink); font-weight:600; }
.lead .thread { overflow-wrap:anywhere; }
.hint { display:inline-flex; align-items:center; gap:5px; font-size:12px; color:var(--muted); }
.hint.waiting { color:var(--accent); font-weight:500; }
.why p { border-left:3px solid color-mix(in srgb, var(--accent) 55%, transparent); padding:2px 0 2px 10px; -webkit-user-select:text; user-select:text; overflow-wrap:anywhere; }
.why .label { margin-bottom:4px; }
main { padding:0 20px 16px; display:grid; gap:12px; }
.cmd { background:var(--sunken); border:1px solid var(--line); border-radius:10px; padding:10px 12px; display:grid; gap:6px; -webkit-user-select:text; user-select:text; }
.cmd .main { font:12.5px/1.45 ui-monospace, "SF Mono", Menlo, monospace; word-break:break-all; }
.cmd .main::before { content:"$ "; color:var(--muted); }
.row { display:flex; gap:8px; align-items:baseline; min-width:0; }
.tag { flex:none; font-size:11px; color:var(--muted); min-width:44px; }
code { font:11.5px/1.45 ui-monospace, "SF Mono", Menlo, monospace; color:var(--muted); word-break:break-all; }
.label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.env { text-transform:none; letter-spacing:0; font-weight:600; padding:1px 7px; border-radius:99px; }
.env.production { color:var(--prod); background:var(--prod-soft); } .env.preview { color:var(--prev); background:var(--prev-soft); }
.env.development { color:var(--dev); background:var(--dev-soft); } .env.other { color:var(--muted); background:var(--sunken); }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { display:inline-flex; align-items:center; gap:5px; font:12px ui-monospace, "SF Mono", Menlo, monospace; padding:3px 8px; border-radius:7px; border:1px solid var(--line); background:var(--sunken); }
.chip svg { color:var(--muted); }
.note { display:flex; gap:7px; align-items:flex-start; color:var(--muted); font-size:12px; }
.note svg { flex:none; margin-top:2px; }
footer { display:flex; align-items:center; gap:8px; padding:12px 16px; border-top:1px solid var(--line); background:color-mix(in srgb, var(--sunken) 55%, transparent); }
button { font:inherit; font-weight:500; border-radius:8px; padding:6px 13px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:default; display:inline-flex; align-items:center; gap:6px; }
button:hover { background:var(--sunken); }
button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.ghost { border-color:transparent; background:transparent; color:var(--muted); }
.ghost:hover { color:var(--ink); }
.primary { background:var(--accent); border-color:transparent; color:var(--accent-ink); }
.primary:hover { background:color-mix(in srgb, var(--accent) 88%, black); }
.spacer { flex:1; }
</style></head>
<body><div class="card" role="alertdialog" aria-labelledby="t">
<header><div class="badge">${ICONS.lock}</div><div><h1 id="t">${escape(title)}</h1><p class="lead">${lead}</p></div></header>
<main>
${why}<div class="cmd"><div class="main">${escape(view.command)}</div>${runs}<div class="row"><span class="tag">in</span><code>${escape(tilde(view.cwd, home))}</code></div></div>
<div><div class="label">Secrets <span class="env ${env}">${escape(view.environment)}</span></div><div class="chips">${chips}</div></div>
<p class="note">${ICONS.eye}<span>The thread never sees these values; its output shows ${sample} in their place.</span></p>
</main>
<footer>
<button class="ghost" data-answer="always" title="Run this exact command with these secrets from now on without asking">Always allow</button>
<span class="spacer"></span>${hint}
<button data-answer="" id="cancel">Cancel</button>
<button class="primary" data-answer="once">${allow}</button>
</footer>
</div>
<script nonce="${escape(nonce)}">
window.__answer = new Promise((resolve) => {
  document.querySelectorAll("button[data-answer]").forEach((b) => b.addEventListener("click", () => {
    const hint = document.getElementById("hint");
    if (b.dataset.answer && hint) { hint.className = "hint waiting"; hint.lastChild.textContent = "Touch ID to confirm"; }
    resolve(b.dataset.answer || null);
  }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") resolve(null); });
});
window.__touchEnded = () => document.getElementById("hint")?.remove();
document.getElementById("cancel").focus();
</script>
</body></html>`;
}

// Touch ID is asked the moment the window shows, so a touch on the sensor alone is "Allow for 1 hour". A click while
// it's up waits for that same touch (Always allow, or Allow for 1 hour). Cancelling the macOS prompt leaves the buttons,
// and a click after that asks Touch ID again. With touch, nothing is allowed without Touch ID passing.
/**
 * @param {Promise<string | null>} answer the page's click, Escape or the window closing (null)
 * @param {Promise<boolean> | null} touched the Touch ID prompt started with the window, true when it passed
 * @param {() => Promise<boolean>} [touch] asks Touch ID again
 * @param {() => void} [onTouchEnded]
 * @returns {Promise<"once" | "always" | null>}
 */
async function settle(answer, touched, touch = async () => false, onTouchEnded = () => {}) {
  const pick = (c) => (c === "once" || c === "always" ? c : null);
  if (!touched) return pick(await answer);
  const first = await Promise.race([answer.then((c) => ({ clicked: pick(c) })), touched.then((ok) => ({ ok }))]);
  if ("ok" in first) {
    if (first.ok) return "once";
    onTouchEnded();
    const choice = pick(await answer);
    return choice && (await touch()) ? choice : null;
  }
  if (!first.clicked) return null;
  return (await touched) ? first.clicked : null;
}

/**
 * Shows the question over `parent` and resolves "once", "always" or null (Cancel, Escape, closing it, or Touch ID failing).
 * `touch` (only where the Mac has Touch ID) starts as the window shows, so a touch alone allows once.
 * @param {{ BrowserWindow: any, parent?: any, view: Parameters<typeof approvalHtml>[0], touchId?: boolean, touch?: () => Promise<boolean> }} options
 */
async function askInWindow({ BrowserWindow, parent, view, touchId = false, touch = undefined }) {
  const nonce = crypto.randomBytes(16).toString("base64");
  const win = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    parent: parent ?? undefined,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Run with secrets",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, partition: "approval" },
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const closed = new Promise((resolve) => win.once("closed", () => resolve(null)));
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(approvalHtml(view, { touchId, nonce }))}`);
    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Number(await win.webContents.executeJavaScript("document.body.scrollHeight")) || MIN_HEIGHT));
    const area = parent && !parent.isDestroyed?.() ? parent.getBounds() : null;
    if (area) win.setBounds({ x: Math.round(area.x + (area.width - WIDTH) / 2), y: Math.round(area.y + Math.max(40, (area.height - height) / 3)), width: WIDTH, height });
    else {
      win.setSize(WIDTH, height);
      win.center();
    }
    win.show();
    win.focus();
    const answer = Promise.race([win.webContents.executeJavaScript("window.__answer"), closed]).catch(() => null);
    const touched = touch ? touch() : null;
    const ended = () => {
      if (!win.isDestroyed()) win.webContents.executeJavaScript("window.__touchEnded()").catch(() => {});
    };
    return await settle(answer, touched, touch, ended);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { approvalHtml, askInWindow, settle, scriptLines, tilde, escape };
