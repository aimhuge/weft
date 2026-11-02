// Commands that run with vault values in their env, for threads that never see them
// (docs/architecture/secrets.md). lib/secret-run.ts checks and splits the command; here main asks the user
// (the exact command, its package.json script, the names), spawns it with no shell and the values in its
// env only, and hands back its output with every value swapped for ‹NAME›. A dev server gets its values
// through a one-time grant that electron/secret-env.cjs claims. Either way main remembers the values a
// card used, so the runner can redact them from what it stores (redact).
const crypto = require("node:crypto");
const path = require("node:path");
const { createExec, reply, baseEnv, KEEP_CHARS, REPLY_CHARS, KILL_GRACE_MS } = require("./secret-exec.cjs");
const { redactor } = require("./secret-redact.cjs");
const { decideAccess } = require("./vault-access.cjs");
const { DEV_GRANT_HOURS } = require("./worker-vault-wire.cjs");

// How long a dev server's grant waits to be claimed.
const GRANT_MS = 60_000;


// thread is the asking card's title and why the thread's own reason, both shown so the user knows who asks and for what.
// worker names the Weft Worker the command runs on, when it isn't this Mac (describeWorker).
/** @param {{ kind: string, command: string, cwd: string, script?: string, names: string[], environment: string, label: string, thread?: string, why?: string, worker?: string, remote?: string, fingerprint?: string, firstUse?: boolean }} request */
function describe(request) {
  if (request.worker) return describeWorker(request);
  const { kind, command, cwd, script, names, environment, label, thread, why } = request;
  const message = kind === "dev" ? `Start ${thread ? `"${thread}"'s` : "this card's"} dev server with ${label}'s ${environment} secrets?` : `${thread ? `"${thread}"` : "A thread"} wants to run a command with secrets from ${label}.`;
  const detail = [why ? `Why: ${why}` : null, `Command: ${command}`, `In: ${cwd}`, script ? `Runs:\n${script}` : null, `Secrets (${environment}): ${names.join(", ")}`, "The thread won't see the values; they're shown as ‹NAME› in its output.", kind === "dev" ? null : "Always lasts until the code in this folder changes; then Weft asks again."].filter(Boolean).join("\n\n");
  const reason = `run "${command}" with ${names.join(", ")} (${label})${thread ? ` for "${thread}"` : ""}`;
  return { message, detail, reason, view: { kind, command, cwd, script, names, environment, label, thread, why } };
}

// A Weft Worker's run (electron/worker-secret.cjs): the exact command and script first, then where it runs, the
// worker's pinned key and the plain truth that the worker's code gets the values; the thread's own words come last.
/** @param {Parameters<typeof describe>[0] & { worker: string }} request */
function describeWorker({ kind, command, cwd, script, names, environment, label, thread, why, worker, remote, fingerprint, firstUse }) {
  const key = fingerprint ? `${worker}'s key: ${fingerprint}${firstUse ? " (first seen now: this Mac pins it)" : " (pinned)"}` : null;
  const dev = kind === "dev";
  // A dev server's approval stands for its restarts (electron/worker-dev-env.cjs), so the window says how long.
  const sealedFor = dev
    ? `They're sealed to that worker for this server. Allow covers its restarts with the same command for up to ${DEV_GRANT_HOURS} hours, until the card gets a new message, and that includes any change to the code in this project in between: whatever the server runs gets the values. Any process on ${worker} can read a running server's env. Its log shows ‹NAME› in their place.`
    : "They're sealed to that worker for this one run, and the thread's output shows ‹NAME› in their place.";
  const detail = [`Command: ${command}`, script ? `Runs:\n${script}` : null, `In: ${cwd} on the Weft Worker ${worker}, not this Mac`, remote ? `Repo: ${remote}` : null, `Secrets (${environment}) from ${label}: ${names.join(", ")}`, key, `The command and any code it runs on ${worker} get these values. ${sealedFor}`, thread ? `Card: ${thread}` : null, why ? `The thread says why: ${why}` : null].filter(Boolean).join("\n\n");
  return {
    message: dev ? `Start a dev server on the worker ${worker} with ${label}'s ${environment} secrets?` : `A card on the worker ${worker} wants to run a command with secrets from ${label}.`,
    detail,
    reason: `${dev ? "start" : "run"} "${command}" with ${names.join(", ")} (${label})${thread ? ` for "${thread}"` : ""} on the worker ${worker}`,
    view: { kind, command, cwd, script, names, environment, label, thread, why, worker, remote, fingerprint, firstUse: Boolean(firstUse) },
  };
}

/**
 * @typedef {{ missing?: string[], denied?: boolean, label?: string, exitCode?: number | null, signal?: string | null,
 *   timedOut?: boolean, output?: string, truncated?: boolean, ms?: number }} RunReply
 * @typedef {{ names: string[], grant?: string, denied?: boolean, label?: string, node?: string, runner?: string }} DevGrant
 */

// audit writes the run's line in the audit log (electron/keychain-audit.cjs); the vault's own read line is skipped.
function createSecretRun({ vault, ask, rules, spawn, audit = /** @type {(entry: Record<string, unknown>) => unknown} */ ((entry) => entry), env = process.env, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, randomId = () => crypto.randomBytes(32).toString("hex"), killGraceMs = KILL_GRACE_MS, node = process.execPath, runner = path.join(__dirname, "secret-env.cjs") }) {
  const { execute } = createExec({ spawn, env, now, setTimer, clearTimer, killGraceMs });
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
 * @param {() => (ReturnType<typeof createSecretRun> & { workerAsk?: (call: string) => Promise<unknown>, workerVault?: (call: string) => Promise<unknown> }) | undefined} get
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
    // A worker card's ask, by its device_calls id only: main reads the rest itself (electron/worker-secret.cjs).
    "POST /secrets/worker-ask": (body) => {
      const r = runner();
      if (!r.workerAsk) throw new Error("This Mac can't answer a worker's secrets yet.");
      return r.workerAsk(String(body.call ?? ""));
    },
    // A worker card's vault call (list, blanks, set_value, push_to_vercel, a dev server's env), by id only too
    // (electron/worker-vault.cjs): main reads the tool and everything else off the row itself.
    "POST /secrets/worker-vault": (body) => {
      const r = runner();
      if (!r.workerVault) throw new Error("This Mac can't answer a worker's vault calls yet.");
      return r.workerVault(String(body.call ?? ""));
    },
  };
}

// Wires it into Electron main with the vault, the approval dialog and the sealed rules file, and a Weft Worker's runs
// (electron/worker-secret.cjs), which ask through the same window and read their requests with the account's session.
function setupSecretRun({ vault, dataDir, window, accountClient = () => null, vercelEnv = () => null }) {
  const { BrowserWindow, dialog, systemPreferences } = require("electron");
  const { audit, keychainFor } = require("./keychain-audit.cjs");
  const { askInWindow } = require("./approval-window.cjs");
  const { spawn } = require("node:child_process");
  const { createRunRules } = require("./run-rules.cjs");
  const { createWorkerSecrets } = require("./worker-secret.cjs");
  const { createWorkerPins } = require("./worker-pins.cjs");
  const rules = createRunRules({ file: path.join(dataDir, "vault", "run-rules.json"), safeStorage: keychainFor("run rules") });
  const ask = runApproval({ dialog, systemPreferences, window, askWindow: (opts) => askInWindow({ BrowserWindow, ...opts }) });
  const pins = createWorkerPins({ dir: dataDir, safeStorage: () => keychainFor("worker pins") });
  // This Mac's device key (electron/desktop-signer.cjs, the same file and keychain item pairing uses) signs each secret_use.
  const signer = async () => {
    await require("./vault-crypto.cjs").ready();
    const sodium = require("libsodium-wrappers");
    return require("./desktop-signer.cjs").createDesktopSigner({ dir: dataDir, safeStorage: () => keychainFor("vault key"), sodium: () => sodium });
  };
  const projects = require("./worker-projects.cjs");
  const worker = createWorkerSecrets({ vault, ask, describe, accountClient, pins, signer, projectRepos: projects.createProjectRepos({ dataDir }), audit });
  // A worker card's list, blanks, set_value, push_to_vercel and dev server env (electron/worker-vault.cjs).
  const devEnv = require("./worker-dev-env.cjs").createWorkerDevEnv({ vault, ask, describe, pins, signer, audit });
  const workerVault = require("./worker-vault.cjs").createWorkerVault({ vault, vercelEnv, accountClient, pins, signer, projectFolders: projects.createProjectFolders({ dataDir }), devEnv, cardFolder: projects.createCardFolderPins({ dataDir }), audit });
  return { ...createSecretRun({ vault, rules, spawn, audit, ask }), workerAsk: worker.answer, workerVault: workerVault.answer, devEnv };
}

module.exports = { setupSecretRun, createSecretRun, runApproval, secretRunRoutes, describe, baseEnv, REPLY_CHARS, KEEP_CHARS, GRANT_MS, KILL_GRACE_MS };
