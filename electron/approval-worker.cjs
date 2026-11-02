// The approval window's layout for a Weft Worker's run (electron/approval-window.cjs, electron/worker-secret.cjs). The
// worker's command and script come off the network, so they go first and in full, with anything outside plain ASCII
// marked; the folder, the repo, the worker's pinned key and what the values reach follow; the thread's own words (its
// title and why) come last, as the thread's claim. Touch ID and Allow wait until the user has scrolled to the end.

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Escaped, with every character outside printable ASCII (and a script's line breaks) marked and named, so a lookalike can't pass for the real one. @param {string} text */
function marked(text) {
  return [...String(text ?? "")].map((c) => (/[\x20-\x7e\n]/.test(c) ? escape(c) : `<mark title="U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}">${escape(c)}</mark>`)).join("");
}

/**
 * @param {{ command: string, cwd: string, script?: string, names: string[], environment: string, label: string, thread?: string, why?: string, worker: string, remote?: string, fingerprint?: string, firstUse?: boolean }} view
 * @param {(n: string) => string} chip
 */
function workerLayout(view, chip) {
  const worker = escape(view.worker);
  const script = view.script ? `<div class="label">Runs</div><pre class="script">${marked(view.script)}</pre>` : "";
  const key = view.fingerprint ? `<div class="row"><span class="tag">key</span><code>${escape(view.fingerprint)}${view.firstUse ? " · first seen now, pinned from here on" : " · pinned"}</code></div>` : "";
  const repo = view.remote ? `<div class="row"><span class="tag">repo</span><code>${marked(view.remote)}</code></div>` : "";
  const said = [view.thread ? `<div class="row"><span class="tag">card</span><span>${escape(view.thread)}</span></div>` : "", view.why ? `<div class="row"><span class="tag">says</span><span>${escape(view.why)}</span></div>` : ""].join("");
  const main = `<div class="cmd"><div class="main">${marked(view.command)}</div></div>
${script}<div class="cmd"><div class="row"><span class="tag">in</span><code>${marked(view.cwd)}</code></div><div class="row"><span class="tag">on</span><code>the Weft Worker ${worker}, not this Mac</code></div>${repo}${key}</div>
<div><div class="label">Secrets <span class="env">${escape(view.environment)}</span> from ${escape(view.label)}</div><div class="chips">${view.names.map(chip).join("")}</div></div>
<p class="note warn">The command and any code it runs on ${worker} get these values. They're sealed to that worker for this one run; the thread's output shows ‹NAME› in their place.</p>
${said ? `<div class="said"><div class="label">From the thread</div>${said}</div>` : ""}
<p class="hint" id="seen-hint">Scroll to the end to allow.</p>`;
  return {
    title: "Run a command with secrets on a worker?",
    lead: `A card on the worker <b>${worker}</b> wants to run this with values from the <b>${escape(view.label)}</b> vault.`,
    main,
    css: "pre.script { font:11.5px/1.45 ui-monospace, monospace; white-space:pre-wrap; word-break:break-all; background:var(--sunken); border:1px solid var(--line); border-radius:10px; padding:8px 12px; } mark { background:#f59e0b; color:#000; border-radius:2px; } .warn { color:var(--prod); } .said { opacity:.85; } button[disabled] { opacity:.45; }",
    // Resolves once the end of the page has been on screen; until then Allow is off and Touch ID isn't asked.
    gate: `window.__seen = new Promise((resolve) => {
  const allow = document.querySelector("button[data-answer=once]");
  allow.disabled = true;
  const check = () => {
    if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 4) return;
    allow.disabled = false;
    document.getElementById("seen-hint")?.remove();
    window.removeEventListener("scroll", check);
    resolve(true);
  };
  window.addEventListener("scroll", check);
  window.addEventListener("resize", check);
  setTimeout(check, 0);
});`,
  };
}

module.exports = { workerLayout, marked };
