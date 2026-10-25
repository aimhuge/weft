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

// How long one Touch ID keeps reveal and copy open, counted from the last use.
const UNLOCK_MS = 3 * 60_000;
// A copied value leaves the clipboard after this, if it's still what's there.
const CLIPBOARD_MS = 60_000;
// What a .env file (and Vercel) takes as a variable's name.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Files whose values the rail nudges you to import.
const NUDGE_FILES = new Set([".env.local", ".env.development.local"]);

// Keeps reveal and copy open for a while after one Touch ID. Without Touch ID (a Mac without it, or the
// lid shut on an external keyboard) prompt falls back to a confirmation dialog.
function createUnlock({ prompt, now = Date.now, idleMs = UNLOCK_MS }) {
  let until = 0;
  return {
    async ensure(reason) {
      if (now() < until) {
        until = now() + idleMs;
        return true;
      }
      if (!(await prompt(reason))) return false;
      until = now() + idleMs;
      return true;
    },
    unlocked: () => now() < until,
    lock() {
      until = 0;
    },
  };
}

function createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run = git, now = Date.now, setTimer = setTimeout, onChange = (folder) => void folder, watch = fs.watch }) {
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
    async importPicks(folder, picks) {
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
      return { imported: entries.length };
    },

    async reveal(id, name, environment) {
      if (!(await unlock.ensure(`reveal ${name}`))) return { denied: true };
      const value = (await storeReady()).get(id, name, environment);
      return value === undefined ? { missing: true } : { value };
    },

    async copy(id, name, environment) {
      if (!(await unlock.ensure(`copy ${name}`))) return { denied: true };
      const value = (await storeReady()).get(id, name, environment);
      if (value === undefined) return { missing: true };
      clipboard.writeText(value);
      setTimer(() => {
        if (clipboard.readText() === value) clipboard.writeText("");
      }, CLIPBOARD_MS);
      return { copied: true };
    },

    // Adds a secret by hand, or replaces its value: works for a project with no .env file at all. With a source (a
    // pull from Vercel, electron/vercel-env.cjs, which only fills names with no value) the board hears it like a hand edit.
    async setValue(folder, name, environment, value, { source } = {}) {
      if (!NAME.test(name)) throw new Error(`${name || "A blank name"} isn't a variable name: use letters, digits and _, not starting with a digit.`);
      if (!value) throw new Error(`Type a value for ${name}.`);
      const { id, label } = await idOf(folder);
      (await storeReady()).set(id, label, [{ name, environment, value, source }]);
      refreshManaged(id);
      if (source) onChange(folder);
      return { saved: true };
    },

    // Puts names in the vault with no value yet (blanks), for the user to fill in later: a thread's
    // mcp__secrets__add_blank, or the Add form with no value. A name that has a value keeps it.
    async addBlanks(folder, names, environments, { source, hint } = {}) {
      const bad = names.find((n) => !NAME.test(n));
      if (bad !== undefined) throw new Error(`${bad || "A blank name"} isn't a variable name: use letters, digits and _, not starting with a digit.`);
      if (!names.length) throw new Error("Name at least one secret.");
      const { id, label } = await idOf(folder);
      const s = await storeReady();
      // Names that already have a value in one of those environments.
      const filled = names.filter((name) => s.exists(id) && environments.some((env) => s.get(id, name, env) !== undefined));
      s.set(id, label, names.flatMap((name) => environments.map((environment) => ({ name, environment, value: null, source, hint }))));
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
      refreshManaged(target.id);
      return { copied: true, label: target.label, replaced };
    },

    async remove(id, name, environment) {
      const removed = (await storeReady()).remove(id, name, environment);
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
    async useFor(folder, name, environment, { card, site }) {
      const { id, label } = await idOf(folder);
      const s = await storeReady();
      const value = s.exists(id) ? s.get(id, name, environment) : undefined;
      if (value === undefined) return { missing: true, label };
      const key = `${card}\n${site}\n${id}`;
      if (!threadUnlocks.has(key)) threadUnlocks.set(key, createUnlock({ prompt, now }));
      if (!(await threadUnlocks.get(key).ensure(`let a thread type ${name} (${label}) into ${site}`))) return { denied: true, label };
      return { value, label };
    },

    // Hands one value to send() in main after a Touch ID every time, even while unlocked: a push to a service
    // (electron/vercel-env.cjs) is a write somewhere else. What send returns comes back; the value doesn't.
    async sendValue(folder, name, environment, reason, send) {
      const { label, values } = await this.valuesFor(folder, [name], environment);
      if (!(name in values)) return { missing: true, label };
      return (await prompt(reason(label))) ? { ...(await send(values[name])), label } : { denied: true, label };
    },

    // A Touch ID with no unlock cache, for a write a thread asks for (electron/vault-routes.cjs).
    confirm: (reason) => prompt(reason),

    // Tells the board a folder's vault changed, for a write that doesn't itself (the intake's import).
    notify: (folder) => onChange(folder),

    // Values for a command main runs (electron/secret-run.cjs), never sent over IPC. names null means every
    // name with a value in that environment, for a dev server. The caller asks the user first.
    async valuesFor(folder, names, environment) {
      const { id, label } = await idOf(folder);
      // s is null when there's no vault for this project yet.
      const s = (await existing())?.exists(id) ? store : null;
      const all = s ? s.list(id).filter((e) => e.environment === environment && !e.missing).map((e) => e.name) : [];
      const found = (names ?? all).map((name) => [name, s?.get(id, name, environment)]);
      return { id, label, values: Object.fromEntries(found.filter(([, v]) => v !== undefined)), missing: found.filter(([, v]) => v === undefined).map(([n]) => n) };
    },

    lock() {
      unlock.lock();
      threadUnlocks.clear();
      return { unlocked: false };
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerVault(ipcMain, { vault, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("The vault only answers the board window.");
      return fn(...args);
    });
  handle("vault:overview", (folders) => vault.overview(Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : []));
  handle("vault:scan", (folder) => vault.scan(String(folder)));
  handle("vault:import", (folder, picks) => vault.importPicks(String(folder), Array.isArray(picks) ? picks : []));
  handle("vault:reveal", (id, name, env) => vault.reveal(String(id), String(name), String(env)));
  handle("vault:copy", (id, name, env) => vault.copy(String(id), String(name), String(env)));
  handle("vault:set", (folder, name, env, value) => vault.setValue(String(folder), String(name), String(env), String(value ?? "")));
  handle("vault:add-blank", (folder, name, env) => vault.addBlanks(String(folder), [String(name)], [String(env)], { source: "added blank" }));
  handle("vault:copy-to", (id, name, env, folder) => vault.copyTo(String(id), String(name), String(env), String(folder)));
  handle("vault:remove", (id, name, env) => vault.remove(String(id), String(name), String(env)));
  handle("vault:write-back", (folder) => vault.writeBack(String(folder)));
  handle("vault:lock", () => vault.lock());
}

// Wires the vault into Electron main for the board window (board() is its webContents).
function setupVault({ ipcMain, dataDir, window, board }) {
  const { clipboard, dialog, safeStorage, systemPreferences } = require("electron");
  // A hand edit to a managed .env.local: the board loads the vaults again and its nudge offers the import.
  const onChange = (folder) => {
    const contents = board();
    if (contents && !contents.isDestroyed()) contents.send("vault:changed", folder);
  };
  const vault = createVault({ dataDir, safeStorage, sodium: require("./vault-crypto.cjs"), clipboard, prompt: touchIdPrompt({ systemPreferences, dialog, window }), onChange });
  registerVault(ipcMain, { vault, isBoard: (sender) => Boolean(sender) && sender === board() });
  return vault;
}

module.exports = { setupVault, createVault, registerVault, touchIdPrompt, createUnlock, parseRemote, vaultIdFor, UNLOCK_MS, CLIPBOARD_MS };
