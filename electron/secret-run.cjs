// Commands that run with vault values in their env, for threads that never see them
// (docs/architecture/secrets.md). lib/secret-run.ts checks and splits the command; here main asks the user
// (the exact command, its package.json script, the names), spawns it with no shell and the values in its
// env only, and hands back its output with every value swapped for ‹NAME›. A dev server gets its values
// through a one-time grant that electron/secret-env.cjs claims. Either way main remembers the values a
// card used, so the runner can redact them from what it stores (redact).
const crypto = require("node:crypto");
const path = require("node:path");
const { redactor } = require("./secret-redact.cjs");
const { decideAccess } = require("./vault-access.cjs");

// Output kept while a command runs, and what goes back to the thread.
const KEEP_CHARS = 1_000_000;
const REPLY_CHARS = 20_000;
// After SIGTERM on a timeout, how long before SIGKILL.
const KILL_GRACE_MS = 3000;
// How long a dev server's grant waits to be claimed.
const GRANT_MS = 60_000;
// Weft's own variables don't go to the commands it runs.
const INTERNAL = /^(WEFT_SHELL_|ELECTRON_RUN_AS_NODE$)/;

function baseEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !INTERNAL.test(k)));
}

// thread is the asking card's title and why the thread's own reason, both shown so the user knows who asks and for what.
/** @param {{ kind: string, command: string, cwd: string, script?: string, names: string[], environment: string, label: string, thread?: string, why?: string }} request */
function describe({ kind, command, cwd, script, names, environment, label, thread, why }) {
  const message =
    kind === "dev"
      ? `Start ${thread ? `"${thread}"'s` : "this card's"} dev server with ${label}'s ${environment} secrets?`
      : `${thread ? `"${thread}"` : "A thread"} wants to run a command with secrets from ${label}.`;
  const detail = [why ? `Why: ${why}` : null, `Command: ${command}`, `In: ${cwd}`, script ? `Runs:\n${script}` : null, `Secrets (${environment}): ${names.join(", ")}`, "The thread won't see the values; they're shown as ‹NAME› in its output.", kind === "dev" ? null : "Always lasts until the code in this folder changes; then Weft asks again."].filter(Boolean).join("\n\n");
  const reason = `run "${command}" with ${names.join(", ")} (${label})${thread ? ` for "${thread}"` : ""}`;
  return { message, detail, reason, view: { kind, command, cwd, script, names, environment, label, thread, why } };
}

/**
 * @typedef {{ missing?: string[], denied?: boolean, label?: string, exitCode?: number | null, signal?: string | null,
 *   timedOut?: boolean, output?: string, truncated?: boolean, ms?: number }} RunReply
 * @typedef {{ names: string[], grant?: string, denied?: boolean, label?: string, node?: string, runner?: string }} DevGrant
 */

// audit writes the run's line in the audit log (electron/keychain-audit.cjs); the vault's own read line is skipped.
function createSecretRun({ vault, ask, rules, spawn, audit = /** @type {(entry: Record<string, unknown>) => unknown} */ ((entry) => entry), env = process.env, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, randomId = () => crypto.randomBytes(32).toString("hex"), killGraceMs = KILL_GRACE_MS, node = process.execPath, runner = path.join(__dirname, "secret-env.cjs") }) {
  const used = new Map(); // card key -> Map(name -> value)
  const grants = new Map(); // grant -> { values, until }

  function remember(key, values) {
    if (!key) return;
    if (!used.has(key)) used.set(key, new Map());
    for (const [name, value] of Object.entries(values)) used.get(key).set(name, value);
  }

  function redact(key, text) {
    const values = used.get(key);
    if (!values) return String(text ?? "");
    return redactor([...values].map(([name, value]) => ({ name, value })))(text);
  }

  // How it was allowed ("grant", "rule", "once", "always"), or null for a no: the card's standing grant
  // (electron/vault-grants.cjs), a remembered rule, or the user's yes ("always" adds a rule).
  // asker ({ key, thread, why }) is only shown, never part of the rule.
  async function approve(request, names, label, asker = {}) {
    // Whether this card may run this command with these secrets, and how it was allowed
    // (electron/vault-access.cjs).
    const access = await decideAccess({
      // A command run has no site, so any of the card's grants for the vault covers it; a grant's
      // site only limits where a value may be typed (electron/vault-grants.cjs).
      grants: { allows: (card, id) => Boolean(vault.granted?.(card, id)) },
      card: asker.key,
      vaultId: request.id,
      rule: { allows: () => rules.allows(request, names) },
      ask: () => ask(describe({ ...request, thread: asker.thread, why: asker.why, names, label })),
      remember: () => rules.remember(request, names),
    });
    // A yes from the user covers this card for the hour (electron/vault-grants.cjs), so a thread that runs
    // a few commands or restarts its dev server asks once, not every time.
    if (access.via === "once" || access.via === "always") vault.grantAfterApproval?.({ card: asker.key, thread: asker.thread, id: request.id, label });
    return access.allowed ? access.via : null;
  }

  // The audit line for a run or a dev server's secrets, allowed or not.
  function log({ action, key, thread, why, command, names, environment, label, via }) {
    audit({ kind: "vault", action, by: "thread", card: key, thread, detail: why, command, names, environment, vault: label, via: via ?? undefined, outcome: via ? "ok" : "denied" });
  }

  function execute({ argv, cwd, env: extra, values, timeoutMs }) {
    return new Promise((resolve) => {
      const started = now();
      let out = "";
      let cut = false;
      let timedOut = false;
      let child;
      const add = (chunk) => {
        out += chunk.toString();
        if (out.length > KEEP_CHARS) {
          out = out.slice(-KEEP_CHARS);
          cut = true;
        }
      };
      const signal = (sig) => {
        try {
          process.kill(-child.pid, sig);
        } catch {
          child.kill(sig);
        }
      };
      let killTimer;
      const timer = setTimer(() => {
        timedOut = true;
        signal("SIGTERM");
        killTimer = setTimer(() => signal("SIGKILL"), killGraceMs);
      }, timeoutMs);
      const finish = (exitCode, sig) => {
        clearTimer(timer);
        clearTimer(killTimer);
        resolve({ exitCode, signal: sig, timedOut, output: out, cut, ms: now() - started });
      };
      try {
        child = spawn(argv[0], argv.slice(1), { cwd, env: { ...baseEnv(env), ...extra, ...values }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        out = err.message;
        finish(null, null);
        return;
      }
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      child.on("error", (err) => {
        add(`${err.message}\n`);
        finish(null, null);
      });
      child.on("close", (code, sig) => finish(code, sig));
    });
  }

  // Redacted first, then cut to the reply's size; a cut start drops its first line, which could hold part of a value.
  function reply(result, entries, label) {
    let output = redactor(entries)(result.output);
    let truncated = result.cut;
    if (output.length > REPLY_CHARS) {
      output = output.slice(-REPLY_CHARS);
      truncated = true;
    }
    if (truncated) output = output.slice(output.indexOf("\n") + 1);
    return { label, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, output, truncated, ms: result.ms };
  }

  return {
    redact,

    /**
     * @param {{ key?: string, thread?: string, why?: string, folder: string, cwd: string, command: string, argv: string[],
     *   env?: Record<string, string>, names: string[], environment?: string, script?: string, timeoutMs?: number }} request
     * @returns {Promise<RunReply>}
     */
    async run({ key, thread = undefined, why = undefined, folder, cwd, command, argv, env: extra = {}, names, environment = "development", script, timeoutMs = 120_000 }) {
      const { id, label, values, missing } = await vault.valuesFor(folder, names, environment, false);
      if (missing.length) return { missing, label };
      const via = await approve({ id, environment, cwd, command, script, kind: "run" }, names, label, { key, thread, why });
      log({ action: "run", key, thread, why, command, names, environment, label, via });
      if (!via) return { denied: true, label };
      remember(key, values);
      const result = await execute({ argv, cwd, env: extra, values, timeoutMs });
      return reply(result, Object.entries(values).map(([name, value]) => ({ name, value })), label);
    },

    // A one-time grant of the folder's development values for a dev server's command, or no names when the
    // vault has none (the server starts the plain way).
    /**
     * @param {{ key?: string, thread?: string, folder: string, cwd: string, command: string, script?: string }} request
     * @returns {Promise<DevGrant>}
     */
    async devGrant({ key, thread, folder, cwd, command, script }) {
      const environment = "development";
      const { id, label, values } = await vault.valuesFor(folder, null, environment, false);
      const names = Object.keys(values);
      if (!names.length) return { names };
      const via = await approve({ id, environment, cwd, command, script, kind: "dev" }, names, label, { key, thread });
      log({ action: "dev server", key, thread, command, names, environment, label, via });
      if (!via) return { denied: true, names, label };
      remember(key, values);
      const grant = randomId();
      grants.set(grant, { values, until: now() + GRANT_MS });
      return { grant, names, label, node, runner };
    },

    // Used once, by electron/secret-env.cjs.
    claim(grant) {
      const found = grants.get(String(grant));
      grants.delete(String(grant));
      if (!found || now() > found.until) throw new Error("That grant was already used or has expired.");
      return { env: found.values };
    },
  };
}

// The approval: Weft's own window with the command and names (electron/approval-window.cjs), or macOS's
// alert if that can't open, then Touch ID where the Mac has it. The window starts Touch ID as it opens, so a
// touch on the sensor is Allow for 1 hour with no click; it answers only after Touch ID passed. askWindow is optional in tests.
/**
 * @param {{
 *   dialog: { showMessageBox: (win: unknown, options: { type: string, buttons: string[], defaultId?: number, cancelId?: number, message: string, detail: string }) => Promise<{ response: number }> },
 *   systemPreferences: { canPromptTouchID?: () => boolean, promptTouchID?: (reason: string) => Promise<void> },
 *   window: () => unknown,
 *   askWindow?: (opts: { parent: unknown, view: { command: string, [key: string]: unknown }, touchId: boolean, touch?: () => Promise<boolean> }) => Promise<string | null>
 * }} options
 */
function runApproval({ dialog, systemPreferences, window, askWindow = undefined }) {
  const nativeAsk = async ({ message, detail }) => {
    const { response } = await dialog.showMessageBox(window(), { type: "warning", buttons: ["Cancel", "Allow for 1 hour", "Always allow"], defaultId: 0, cancelId: 0, message, detail });
    return [null, "once", "always"][response] ?? null;
  };
  return async (request) => {
    const touchId = Boolean(systemPreferences.canPromptTouchID?.());
    const touch = () => systemPreferences.promptTouchID(request.reason).then(() => true, () => false);
    if (askWindow && request.view) {
      try {
        return await askWindow({ parent: window(), view: request.view, touchId, touch: touchId ? touch : undefined });
      } catch {
        // The window couldn't open: macOS's alert below.
      }
    }
    const choice = await nativeAsk(request);
    if (!choice) return null;
    return !touchId || (await touch()) ? choice : null;
  };
}

// The control server's routes for it (electron/browser-pane.cjs). The card is the signed one: the
// server proves which card a request is for and main believes only that (electron/card-token.cjs).
// A request that proves nothing has no card, so it runs for nobody.
/**
 * @param {() => ReturnType<typeof createSecretRun> | undefined} get
 * @param {(body: Record<string, unknown>, route: string) => string} [cardFor]
 */
function secretRunRoutes(get, cardFor = () => "") {
  const runner = () => {
    const r = get();
    if (!r) throw new Error("The secrets vault isn't ready yet.");
    return r;
  };
  return {
    "POST /secrets/run": (body, route) => runner().run({ ...body, key: cardFor(body, route) }),
    "POST /secrets/dev-grant": (body, route) => runner().devGrant({ ...body, key: cardFor(body, route) }),
    "POST /secrets/claim": (body) => runner().claim(body.grant),
  };
}

// Wires it into Electron main with the vault, the approval dialog and the sealed rules file.
function setupSecretRun({ vault, dataDir, window }) {
  const { BrowserWindow, dialog, systemPreferences } = require("electron");
  const { audit, keychainFor } = require("./keychain-audit.cjs");
  const { askInWindow } = require("./approval-window.cjs");
  const { spawn } = require("node:child_process");
  const { createRunRules } = require("./run-rules.cjs");
  const rules = createRunRules({ file: path.join(dataDir, "vault", "run-rules.json"), safeStorage: keychainFor("run rules") });
  return createSecretRun({ vault, rules, spawn, audit, ask: runApproval({ dialog, systemPreferences, window, askWindow: (opts) => askInWindow({ BrowserWindow, ...opts }) }) });
}

module.exports = { setupSecretRun, createSecretRun, runApproval, secretRunRoutes, describe, baseEnv, REPLY_CHARS, KEEP_CHARS, GRANT_MS, KILL_GRACE_MS };
