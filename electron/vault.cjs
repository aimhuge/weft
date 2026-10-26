// The secrets vault's side of Electron main (docs/architecture/secrets.md): which vault a project folder
// opens, the .env import with its preview, the rail's nudge, and Touch ID before a value is revealed or
// copied. It answers the board window only; pane pages are agent-driven and can be any site.
const fs = require("node:fs");
const path = require("node:path");
const { findEnvFiles, envFileKind, isVercelPull, parseEnv, shortLived } = require("./dotenv.cjs");
const { loadDeviceKey } = require("./device-key.cjs");
const { createVaultStore, tailOf } = require("./vault-store.cjs");
const { MANAGED_FILE, createEnvWatcher, ignoreLocalEnv, isManaged, planWrite, readOrNull, renderEnv, writeFileAtomic } = require("./env-writeback.cjs");
const { touchIdPrompt } = require("./touch-id.cjs");
const { git, parseRemote, vaultIdFor } = require("./vault-id.cjs");
const { createGrants, grantMethods } = require("./vault-grants.cjs");
const { decideAccess } = require("./vault-access.cjs");
const { audit, configureAudit, keychainFor } = require("./keychain-audit.cjs");
const { createUnlock, UNLOCK_MS } = require("./vault-unlock.cjs");
const { registerVault } = require("./vault-ipc.cjs");

// A copied value leaves the clipboard after this, if it's still what's there.
const CLIPBOARD_MS = 60_000;
// What a .env file (and Vercel) takes as a variable's name.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Files whose values the rail nudges you to import.
const NUDGE_FILES = new Set([".env.local", ".env.development.local"]);

// audit records one line per use of a value or write (electron/keychain-audit.cjs); grants are threads' standing
// access (electron/vault-grants.cjs).
function createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run = git, now = Date.now, setTimer = setTimeout, onChange = (folder) => void folder, watch = fs.watch, audit = /** @type {(entry: Record<string, unknown>) => unknown} */ ((entry) => entry), grants = createGrants({ now }) }) {
  // .env.local files Weft writes from the vault; a hand edit tells the board to look again (onChange).
  const watcher = createEnvWatcher({ onEdit: onChange, watch });
  let store;
  const ids = new Map(); // folder -> { id, label }
  const unlock = createUnlock({ prompt, now });
  // Threads get their own approvals, one per card, site and vault: the drawer being unlocked never lets a
  // thread in, and a yes for one site never covers another.
  const threadUnlocks = new Map();

  async function storeReady() {
    if (!store) {
      await sodium.ready();
      const device = loadDeviceKey({ dir: dataDir, safeStorage, crypto: sodium });
      store = createVaultStore({ dir: path.join(dataDir, "vault"), device, sodium, now });
    }
    return store;
  }

  // The store, or null before the first import (no vault, so no key to make yet).
  const existing = async () => (store || fs.existsSync(path.join(dataDir, "vault")) ? storeReady() : null);

  async function idOf(folder) {
    if (!ids.has(folder)) ids.set(folder, await vaultIdFor(folder, run));
    return ids.get(folder);
  }

  // A vault's label from its id, for the audit line of a call that only has the id.
  const labelOf = (id) => [...ids.values()].find((known) => known.id === id)?.label ?? id;
  // Always true, so a refusal can log and answer in one line.
  const log = (entry) => {
    audit({ kind: "vault", outcome: "ok", ...entry });
    return true;
  };

  // The project's .env files, parsed. Only files findEnvFiles lists, so a request can't name another path.
  function readFiles(folder) {
    return findEnvFiles(folder).map((file) => {
      const text = fs.readFileSync(path.join(folder, file), "utf8");
      return { file, kind: envFileKind(file), vercel: isVercelPull(text), entries: parseEnv(text) };
    });
  }

  function status(have, value) {
    if (have === undefined) return "new";
    return have === value ? "same" : "differs";
  }

  // Values in the nudge files that the vault doesn't hold yet, or holds differently. s is null with no vault yet.
  function nudge(folder, id, s) {
    const pending = new Set();
    let file;
    for (const f of readFiles(folder)) {
      if (!NUDGE_FILES.has(path.basename(f.file))) continue;
      for (const e of f.entries) {
        if ((f.vercel && shortLived(e.name)) || pending.has(e.name)) continue;
        if (s?.exists(id) && s.get(id, e.name, f.kind.environment) === e.value) continue;
        pending.add(e.name);
        file ??= f.file;
      }
    }
    return pending.size ? { count: pending.size, file, managed: isManaged(readOrNull(path.join(folder, file))) } : null;
  }

  // Whether the folder's .env.local is Weft's, watching it if so (a restart picks the watch up again here).
  function watchManaged(folder) {
    const text = readOrNull(path.join(folder, MANAGED_FILE));
    if (!isManaged(text)) return false;
    if (!watcher.watching(folder)) watcher.wrote(folder, text);
    return true;
  }

  // The development values as .env.local's text. Only called with the store open.
  function managedText(id) {
    const entries = store.exists(id) ? store.list(id).filter((e) => e.environment === "development") : [];
    return renderEnv(entries.map((e) => ({ name: e.name, value: e.missing ? null : store.get(id, e.name, "development") })));
  }

  function writeManaged(folder, id) {
    const text = managedText(id);
    writeFileAtomic(path.join(folder, MANAGED_FILE), text);
    watcher.wrote(folder, text);
  }

  // After the vault changes, rewrites every managed .env.local of that vault's folders.
  function refreshManaged(id) {
    for (const [folder, known] of ids) {
      if (known.id === id && isManaged(readOrNull(path.join(folder, MANAGED_FILE)))) writeManaged(folder, id);
    }
  }

  return {
    unlock,

    // Takes over the folder's .env.local: writes it from the vault's development values, adds .env*.local to
    // .gitignore when git doesn't ignore it yet, and watches it for hand edits. Refuses a file git tracks or one
    // holding values the vault doesn't have.
    async writeBack(folder) {
      const { id } = await idOf(folder);
      const s = await storeReady();
      const values = new Map(s.exists(id) ? s.list(id).filter((e) => e.environment === "development" && !e.missing).map((e) => [e.name, s.get(id, e.name, "development")]) : []);
      const inRepo = (await run(folder, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
      const tracked = inRepo && Boolean((await run(folder, ["ls-files", "--", MANAGED_FILE]))?.trim());
      const plan = planWrite({ current: readOrNull(path.join(folder, MANAGED_FILE)), values, tracked });
      if (!plan.ok) return { refused: plan.reason };
      const ignored = !inRepo || Boolean((await run(folder, ["check-ignore", "-q", "--no-index", MANAGED_FILE])) !== null);
      if (!ignored) ignoreLocalEnv(folder);
      writeManaged(folder, id);
      log({ action: "write .env.local", by: "you", vault: labelOf(id), names: [...values.keys()], environment: "development", detail: folder });
      return { written: true, file: MANAGED_FILE, gitignoreAdded: !ignored };
    },

    close: () => watcher.close(),

    // One vault per project folder (folders of the same repo share one), with the rail's nudge.
    /** @returns {Promise<import("../lib/vault-view").VaultOverview>} */
    async overview(folders) {
      const seen = new Map();
      for (const folder of folders) {
        const { id, label } = await idOf(folder);
        const found = seen.get(id);
        if (found) {
          found.folders.push(folder);
          continue;
        }
        const s = await existing();
        const secrets = s?.exists(id) ? s.list(id) : [];
        seen.set(id, { id, label, folder, folders: [folder], secrets, nudge: nudge(folder, id, s), managed: watchManaged(folder) });
      }
      return { vaults: [...seen.values()], unlocked: unlock.unlocked() };
    },

    // The import preview: every name in the project's .env files against the vault. Tails only.
    /** @returns {Promise<import("../lib/vault-view").ImportScan>} */
    async scan(folder) {
      const { id, label } = await idOf(folder);
      const s = await storeReady();
      const has = s.exists(id);
      const files = readFiles(folder);
      // git ls-files with no paths lists every file, so only ask when there are some.
      const listed = files.length ? await run(folder, ["ls-files", "--", ...files.map((f) => f.file)]) : null;
      const tracked = new Set((listed ?? "").split("\n").filter(Boolean));
      const valued = new Set(files.filter((f) => !f.kind.namesOnly).flatMap((f) => f.entries.map((e) => `${f.kind.environment}\n${e.name}`)));
      const rows = [];
      for (const f of files) {
        for (const e of f.entries) {
          const environment = f.kind.environment;
          if (f.kind.namesOnly) {
            if (!(has && s.has(id, e.name, environment)) && !valued.has(`${environment}\n${e.name}`)) rows.push({ file: f.file, name: e.name, environment, status: "missing", tail: "", public: e.name.startsWith("NEXT_PUBLIC_"), ticked: true, skipped: false });
            continue;
          }
          const st = status(has ? s.get(id, e.name, environment) : undefined, e.value);
          const skipped = f.vercel && shortLived(e.name);
          rows.push({ file: f.file, name: e.name, environment, status: st, tail: tailOf(e.value), public: e.name.startsWith("NEXT_PUBLIC_"), ticked: f.kind.ticked && st !== "same" && !skipped, skipped });
        }
      }
      return {
        id,
        label,
        files: files.map((f) => ({ file: f.file, environment: f.kind.environment, namesOnly: f.kind.namesOnly, tracked: tracked.has(f.file), vercel: f.vercel })),
        rows,
      };
    },

    // Imports the picked names, reading the files again here: values never travel through the board.
    /** @param {{ by?: string }} [opts] */
    async importPicks(folder, picks, opts = {}) {
      const { by = "weft" } = opts;
      const { id, label } = await idOf(folder);
      const s = await storeReady();
      const wanted = new Set(picks.map((p) => `${p.file}\n${p.name}`));
      const entries = [];
      for (const f of readFiles(folder)) {
        for (const e of f.entries) {
          if (!wanted.has(`${f.file}\n${e.name}`)) continue;
          entries.push({ name: e.name, environment: f.kind.environment, value: f.kind.namesOnly ? null : e.value, source: f.file });
        }
      }
      if (entries.length) s.set(id, label, entries);
      refreshManaged(id);
      if (entries.length) log({ action: "import", by, vault: label, names: [...new Set(entries.map((e) => e.name))], detail: [...new Set(entries.map((e) => e.source))].join(", ") });
      return { imported: entries.length };
    },

    async reveal(id, name, environment) {
      const line = { action: "reveal", by: "you", vault: labelOf(id), names: [name], environment };
      if (!(await unlock.ensure(`reveal ${name}`))) return log({ ...line, outcome: "denied" }) && { denied: true };
      const value = (await storeReady()).get(id, name, environment);
      log({ ...line, outcome: value === undefined ? "missing" : "ok" });
      return value === undefined ? { missing: true } : { value };
    },

    async copy(id, name, environment) {
      const line = { action: "copy", by: "you", vault: labelOf(id), names: [name], environment };
      if (!(await unlock.ensure(`copy ${name}`))) return log({ ...line, outcome: "denied" }) && { denied: true };
      const value = (await storeReady()).get(id, name, environment);
      log({ ...line, outcome: value === undefined ? "missing" : "ok" });
      if (value === undefined) return { missing: true };
      clipboard.writeText(value);
      setTimer(() => {
        if (clipboard.readText() === value) clipboard.writeText("");
      }, CLIPBOARD_MS);
      return { copied: true };
    },

    // Adds a secret by hand, or replaces its value: works for a project with no .env file at all. With a source (a
    // pull from Vercel, electron/vercel-env.cjs, which only fills names with no value) the board hears it like a hand edit.
    /** @param {{ source?: string, by?: string }} [opts] */
    async setValue(folder, name, environment, value, opts = {}) {
      const { source, by = source === "a thread" ? "thread" : source ? "weft" : "you" } = opts;
      if (!NAME.test(name)) throw new Error(`${name || "A blank name"} isn't a variable name: use letters, digits and _, not starting with a digit.`);
      if (!value) throw new Error(`Type a value for ${name}.`);
      const { id, label } = await idOf(folder);
      (await storeReady()).set(id, label, [{ name, environment, value, source }]);
      log({ action: "set", by, vault: label, names: [name], environment, detail: source });
      refreshManaged(id);
      if (source) onChange(folder);
      return { saved: true };
    },

    // Puts names in the vault with no value yet (blanks), for the user to fill in later: a thread's
    // mcp__secrets__add_blank, or the Add form with no value. A name that has a value keeps it.
    /** @param {{ source?: string, hint?: string, by?: string }} [opts] */
    async addBlanks(folder, names, environments, opts = {}) {
      const { source, hint, by = source === "a thread" ? "thread" : "weft" } = opts;
      const bad = names.find((n) => !NAME.test(n));
      if (bad !== undefined) throw new Error(`${bad || "A blank name"} isn't a variable name: use letters, digits and _, not starting with a digit.`);
      if (!names.length) throw new Error("Name at least one secret.");
      const { id, label } = await idOf(folder);
      const s = await storeReady();
      // Names that already have a value in one of those environments.
      const filled = names.filter((name) => s.exists(id) && environments.some((env) => s.get(id, name, env) !== undefined));
      s.set(id, label, names.flatMap((name) => environments.map((environment) => ({ name, environment, value: null, source, hint }))));
      log({ action: "add blank", by, vault: label, names, environment: environments.join(", "), detail: source });
      refreshManaged(id);
      onChange(folder);
      return { label, filled };
    },

    // Copies one secret into another project's vault, value and all, without it leaving main. A name
    // still missing its value goes over as missing too.
    async copyTo(id, name, environment, folder) {
      const s = await storeReady();
      if (!s.has(id, name, environment)) return { missing: true };
      const target = await idOf(folder);
      if (target.id === id) throw new Error(`${name} is already in ${target.label}.`);
      const value = s.get(id, name, environment) ?? null;
      const replaced = value !== null && s.exists(target.id) && s.get(target.id, name, environment) !== undefined;
      s.set(target.id, target.label, [{ name, environment, value }]);
      log({ action: "copy to", by: "you", vault: labelOf(id), names: [name], environment, detail: `into ${target.label}` });
      refreshManaged(target.id);
      return { copied: true, label: target.label, replaced };
    },

    async remove(id, name, environment) {
      const removed = (await storeReady()).remove(id, name, environment);
      log({ action: "remove", by: "you", vault: labelOf(id), names: [name], environment });
      refreshManaged(id);
      return { removed };
    },

    // What a thread may know about a project's vault: names, environments and whether each is missing.
    // Never values, not even tails.
    async names(folder) {
      const { id, label } = await idOf(folder);
      const s = await existing();
      const secrets = s?.exists(id) ? s.list(id).map(({ name, environment, missing }) => ({ name, environment, missing })) : [];
      return { label, secrets };
    },

    // A value for a thread to use without seeing it: main puts it in (electron/browser-pane.cjs) and only says
    // what happened. Touch ID names the secret, the vault and the site, then that card may use this vault on
    // that site for UNLOCK_MS from its last use.
    // A card with a grant (electron/vault-grants.cjs) isn't asked at all.
    /** @param {{ card: string, site: string, thread?: string }} who */
    async useFor(folder, name, environment, who) {
      const { card, site, thread } = who;
      const { id, label } = await idOf(folder);
      const s = await storeReady();
      const value = s.exists(id) ? s.get(id, name, environment) : undefined;
      const line = { action: "fill", by: "thread", card, thread, vault: label, names: [name], environment, site };
      if (value === undefined) return log({ ...line, outcome: "missing" }) && { missing: true, label };
      // Whether this card may use this vault on this site, and how it was allowed (electron/vault-access.cjs).
      const key = `${card}\n${site}\n${id}`;
      const access = await decideAccess({
        grants,
        card,
        vaultId: id,
        unlockFor: () => {
          if (!threadUnlocks.has(key)) threadUnlocks.set(key, createUnlock({ prompt, now }));
          return threadUnlocks.get(key);
        },
        reason: `let a thread type ${name} (${label}) into ${site}`,
      });
      if (!access.allowed) return log({ ...line, via: access.via, outcome: "denied" }) && { denied: true, label };
      log({ ...line, via: access.via });
      return { value, label };
    },

    // Hands one value to send() in main after a Touch ID every time, even while unlocked: a push to a service
    // (electron/vercel-env.cjs) is a write somewhere else. What send returns comes back; the value doesn't.
    async sendValue(folder, name, environment, reason, send) {
      const { label, values } = await this.valuesFor(folder, [name], environment, false);
      const line = { action: "send", by: "weft", vault: label, names: [name], environment, detail: reason(label) };
      if (!(name in values)) return log({ ...line, outcome: "missing" }) && { missing: true, label };
      if (!(await prompt(reason(label)))) return log({ ...line, outcome: "denied" }) && { denied: true, label };
      log(line);
      return { ...(await send(values[name])), label };
    },

    // A Touch ID with no unlock cache, for a write a thread asks for (electron/vault-routes.cjs).
    // A no is a line in the audit log; a yes is the write's own line.
    async confirm(reason) {
      const ok = await prompt(reason);
      if (!ok) log({ action: "ask", by: "weft", detail: reason, outcome: "denied" });
      return ok;
    },

    // Tells the board a folder's vault changed, for a write that doesn't itself (the intake's import).
    notify: (folder) => onChange(folder),

    // Values for a command main runs (electron/secret-run.cjs), never sent over IPC. names null means every
    // name with a value in that environment, for a dev server. The caller asks the user first. use says who read
    // them for the audit line (default: Weft itself), or is false when the caller writes its own line.
    async valuesFor(folder, names, environment, use = {}) {
      const { id, label } = await idOf(folder);
      // s is null when there's no vault for this project yet.
      const s = (await existing())?.exists(id) ? store : null;
      const all = s ? s.list(id).filter((e) => e.environment === environment && !e.missing).map((e) => e.name) : [];
      const found = (names ?? all).map((name) => [name, s?.get(id, name, environment)]);
      const read = found.filter(([, v]) => v !== undefined).map(([n]) => n);
      if (use && read.length) log({ action: "read", by: "weft", ...use, vault: label, names: read, environment });
      return { id, label, values: Object.fromEntries(found.filter(([, v]) => v !== undefined)), missing: found.filter(([, v]) => v === undefined).map(([n]) => n) };
    },

    // Grants (vault-grants.cjs) outlive a lock: the drawer locks itself when idle, and a grant is a separate yes.
    lock() {
      unlock.lock();
      threadUnlocks.clear();
      return { unlocked: false };
    },

    ...grantMethods({ grants, prompt, idOf, log }),
  };
}

// Wires the vault into Electron main for the board window (board() is its webContents).
function setupVault({ ipcMain, dataDir, window, board }) {
  const { clipboard, dialog, systemPreferences } = require("electron");
  // Every Keychain open and vault use is a line in ~/.weft/vault/audit.jsonl from here on.
  configureAudit({ dataDir });
  // A hand edit to a managed .env.local: the board loads the vaults again and its nudge offers the import.
  const onChange = (folder) => {
    const contents = board();
    if (contents && !contents.isDestroyed()) contents.send("vault:changed", folder);
  };
  const vault = createVault({ dataDir, safeStorage: keychainFor("vault key"), sodium: require("./vault-crypto.cjs"), clipboard, prompt: touchIdPrompt({ systemPreferences, dialog, window }), onChange, audit });
  registerVault(ipcMain, { vault, isBoard: (sender) => Boolean(sender) && sender === board() });
  return vault;
}

module.exports = { setupVault, createVault, registerVault, touchIdPrompt, createUnlock, parseRemote, vaultIdFor, UNLOCK_MS, CLIPBOARD_MS };
