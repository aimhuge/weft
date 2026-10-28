// The secrets vault's side of Electron main (docs/architecture/secrets.md): which vault a project folder
// opens, the .env import with its preview, the rail's nudge, and Touch ID before a value is revealed or
// copied. It answers the board window only; pane pages are agent-driven and can be any site.
const fs = require("node:fs");
const path = require("node:path");
const { shortLived } = require("./dotenv.cjs");
const { readFiles, status, nudge } = require("./vault-env-scan.cjs");
const { loadDeviceKey } = require("./device-key.cjs");
const { createVaultStore, tailOf } = require("./vault-store.cjs");
const { MANAGED_FILE, createEnvWatcher, ignoreLocalEnv, planWrite, readOrNull } = require("./env-writeback.cjs");
const { touchIdPrompt } = require("./touch-id.cjs");
const { git, parseRemote, vaultIdFor } = require("./vault-id.cjs");
const { createGrants, grantMethods } = require("./vault-grants.cjs");
const { audit, configureAudit, keychainFor } = require("./keychain-audit.cjs");
const { createUnlock, UNLOCK_MS } = require("./vault-unlock.cjs");
const { createThreadTools } = require("./vault-thread-tools.cjs");
const { registerVault } = require("./vault-ipc.cjs");
const { createVaultSync } = require("./vault-sync.cjs");
const { writeValue } = require("./vault-conflict.cjs");
const { createManagedEnv } = require("./vault-managed-env.cjs");
const { createSharedApi } = require("./vault-shared-api.cjs");
const { readLocalVault } = require("./vault-local.cjs");
const { show: showRecovery, recoveryStatus } = require("./vault-recovery.cjs");
const { listOrgs, sharedBlock } = require("./vault-shared-meta.cjs");
const { accessToken } = require("./vault-rotate.cjs");

// A copied value leaves the clipboard after this, if it's still what's there.
const CLIPBOARD_MS = 60_000;
// What a .env file (and Vercel) takes as a variable's name.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// audit records one line per use of a value or write (electron/keychain-audit.cjs); grants are threads' standing
// access (electron/vault-grants.cjs).
function createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run = git, now = Date.now, setTimer = setTimeout, onChange = (folder) => void folder, watch = fs.watch, audit = /** @type {(entry: Record<string, unknown>) => unknown} */ ((entry) => entry), grants = createGrants({ now }), sync = null, accountClient = null }) {
  // .env.local files Weft writes from the vault; a hand edit tells the board to look again (onChange).
  const watcher = createEnvWatcher({ onEdit: onChange, watch });
  // Where the vault's files live: <hash>.json, <hash>.shared.json, <hash>.sync.json.
  const vaultDir = path.join(dataDir, "vault");
  let store;
  const ids = new Map(); // folder -> { id, label }
  const unlock = createUnlock({ prompt, now });

  async function storeReady() {
    if (!store) {
      await sodium.ready();
      const device = loadDeviceKey({ dir: dataDir, safeStorage, crypto: sodium });
      // A teammate's change to a shared vault (electron/vault-sync.cjs) reaches the board like a hand edit.
      const onRemote = (id) => [...ids].filter(([, known]) => known.id === id).forEach(([folder]) => onChange(folder));
      store = createVaultStore({ dir: vaultDir, device, sodium, now, sync, onRemote });
    }
    return store;
  }

  // The shared vault's side (docs/architecture/teams-vault.md): sealing this vault's key to a teammate's
  // device, and sharing a local vault for the first time. The key is read from the local file and handed
  // straight to the wrap; it never leaves main.
  async function sharedApi() {
    const device = loadDeviceKey({ dir: dataDir, safeStorage, crypto: sodium });
    // A folder is what the drawer knows; the local id is what the file is named with. A grant's pending
    // row names the server's vault, so a local id that isn't known here means the vault isn't ours.
    const readVault = async (folder) => {
      const { id, label } = await idOf(folder);
      return readLocalVault({ dir: vaultDir, id, label, device, sodium });
    };
    return createSharedApi({ readVault, device, sodium, sync });
  }

  // A shared vault's recovery key (electron/vault-recovery.cjs). The vault's key is read from this
  // device's file and unwrapped here, in main; the words are made here too. A re-show is a fresh key:
  // the old recovery row is revoked by the same write, so the old words stop working.
  async function recoveryApi() {
    const device = loadDeviceKey({ dir: dataDir, safeStorage, crypto: sodium });
    // The local vault behind a server vault id. The recovery page knows only the server's id (it
    // comes from the team's page), and the local vault's key is what makes the words — so this is
    // the lookup that joins the two. A vault that isn't here was never shared from this machine.
    const serverVault = async (vaultId) => {
      const found = sync?.byVaultId?.(String(vaultId));
      if (!found) throw new Error("That vault isn't shared from this machine. Open it in Weft and share it with the workspace first.");
      const local = await readLocalVault({ dir: vaultDir, id: found.id, device, sodium });
      return { id: String(vaultId), key: local.key, keyVersion: local.keyVersion, label: local.label };
    };
    return {
      /** Show the recovery key. Touch ID first, then the words. */
      async show({ vaultId, passphrase = "", reason } = {}) {
        const vault = await serverVault(String(vaultId));
        // The Touch ID gate, in main, where the key is: every path to the words goes through it.
        const ok = await prompt(reason ?? `show the recovery key for ${vault.label}`);
        if (!ok) return { denied: true };
        const result = await showRecovery({
          vault,
          accountClient,
          passphrase: typeof passphrase === "string" ? passphrase : "",
          sodium,
          reason: reason ?? `show the recovery key for ${vault.label}`,
        });
        // The words, and nothing else: no key, no private half, no passphrase.
        return { words: result.words, deviceId: result.deviceId, keyVersion: result.keyVersion, reshown: result.reshown, shownAt: result.shownAt };
      },
      /** Whether the vault has a recovery key yet. */
      async status({ vaultId } = {}) {
        const status = await recoveryStatus({ vaultId: String(vaultId), accountClient });
        return { ...status, shared: true };
      },
    };
  }

  // The store, or null before the first import (no vault, so no key to make yet).
  const existing = async () => (store || fs.existsSync(vaultDir) ? storeReady() : null);

  async function idOf(folder) {
    if (!ids.has(folder)) ids.set(folder, await vaultIdFor(folder, run));
    return ids.get(folder);
  }

  // A shared vault reads the server's changes into its shadow first; offline, the shadow answers as it is.
  const fresh = async (s, id) => (s?.isShared(id) ? s.pull(id).catch(() => null) : null);

  // A vault's label from its id, for the audit line of a call that only has the id.
  const labelOf = (id) => [...ids.values()].find((known) => known.id === id)?.label ?? id;

  // Always true, so a refusal can log and answer in one line.
  const log = (entry) => {
    audit({ kind: "vault", outcome: "ok", ...entry });
    return true;
  };

  // Whether the folder's .env.local is Weft's, watching it if so (a restart picks the watch up again here),
  // and the file Weft rewrites from the vault's development values (electron/vault-managed-env.cjs).
  const { watchManaged, managedText, writeManaged, refreshManaged } = createManagedEnv({ store: () => store, watcher, ids });

  // What a thread may do with a vault: fill a value into a site, hand one to a write elsewhere, ask for
  // a confirmation, and read names for a command main runs (electron/vault-thread-tools.cjs).
  const threadTools = createThreadTools({ idOf, storeReady, existing, store: () => store, log, grants, prompt, now, onChange });
  const { useFor, sendValue, confirm, valuesFor, notify, threadUnlocks } = threadTools;

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

    close() {
      watcher.close();
      sync?.close();
    },

    // One vault per project folder (folders of the same repo share one), with the rail's nudge.
    /** @returns {Promise<import("../lib/vault-view").VaultOverview>} */
    async overview(folders) {
      const seen = new Map();
      // The workspaces the user is in, for the drawer's "Share this vault" offer and for a shared
      // vault's header. Signed out, or a shell that doesn't know teams: an empty list.
      const orgs = await listOrgs({ accountClient });
      for (const folder of folders) {
        const { id, label } = await idOf(folder);
        const found = seen.get(id);
        if (found) {
          found.folders.push(folder);
          continue;
        }
        const s = await existing();
        await fresh(s, id);
        const secrets = s?.exists(id) ? s.list(id) : [];
        // shared: the vault is shared with a workspace (the drawer's badge and the Share offer).
        const shared = sharedBlock({ dir: vaultDir, id, orgs });
        // queued: writes to a shared vault made offline, waiting in <hash>.queue.jsonl (the drawer's chip).
        seen.set(id, { id, label, folder, folders: [folder], secrets, nudge: nudge(folder, id, s), managed: watchManaged(folder), ...(shared && { shared }), ...(s?.isShared(id) && { queued: s.queued(id) }) });
      }
      return { vaults: [...seen.values()], unlocked: unlock.unlocked(), orgs };
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
      if (entries.length) await s.set(id, label, entries);
      refreshManaged(id);
      if (entries.length) log({ action: "import", by, vault: label, names: [...new Set(entries.map((e) => e.name))], detail: [...new Set(entries.map((e) => e.source))].join(", ") });
      return { imported: entries.length };
    },

    async reveal(id, name, environment) {
      const line = { action: "reveal", by: "you", vault: labelOf(id), names: [name], environment };
      if (!(await unlock.ensure(`reveal ${name}`))) return log({ ...line, outcome: "denied" }) && { denied: true };
      const s = await storeReady();
      await fresh(s, id);
      const value = s.get(id, name, environment);
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
      const s = await storeReady();
      // A shared vault answers { conflicts, queued }: a conflict isn't saved, the server's row is
      // kept, and the drawer shows the banner (card 12).
      const result = await writeValue({ store: s, id, label, entry: { name, environment, value, source }, db: accountClient?.supabase, vaultId: sync?.shared?.(id)?.vaultId });
      if (!result.saved) return result;
      log({ action: "set", by, vault: label, names: [name], environment, detail: source });
      refreshManaged(id);
      if (source) onChange(folder);
      return result;
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
      await s.set(id, label, names.flatMap((name) => environments.map((environment) => ({ name, environment, value: null, source, hint }))));
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
      await s.set(target.id, target.label, [{ name, environment, value }]);
      log({ action: "copy to", by: "you", vault: labelOf(id), names: [name], environment, detail: `into ${target.label}` });
      refreshManaged(target.id);
      return { copied: true, label: target.label, replaced };
    },

    async remove(id, name, environment) {
      const removed = await (await storeReady()).remove(id, name, environment);
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
    // @param {{ card: string, site: string, thread?: string }} who
    useFor,

    // Hands one value to send() in main after a Touch ID every time, even while unlocked: a push to a service
    // (electron/vercel-env.cjs) is a write somewhere else. What send returns comes back; the value doesn't.
    sendValue,

    // A Touch ID with no unlock cache, for a write a thread asks for (electron/vault-routes.cjs).
    // A no is a line in the audit log; a yes is the write's own line.
    confirm,

    // Tells the board a folder's vault changed, for a write that doesn't itself (the intake's import).
    notify,

    // Values for a command main runs (electron/secret-run.cjs), never sent over IPC. names null means every
    // name with a value in that environment, for a dev server. The caller asks the user first. use says who read
    // them for the audit line (default: Weft itself), or is false when the caller writes its own line.
    valuesFor,

    // Grants (vault-grants.cjs) outlive a lock: the drawer locks itself when idle, and a grant is a separate yes.
    lock() {
      unlock.lock();
      threadUnlocks.clear();
      return { unlocked: false };
    },

    // The shared vault's calls (electron/vault-shared-api.cjs), for the drawer's "Share this vault" and
    // the team page's "Accept" on a device.
    shared: sharedApi,

    // A shared vault's recovery key (electron/vault-recovery.cjs): the 24 words the user writes down.
    // The key is unwrapped here, in main, and the words are made here; neither ever leaves.
    recovery: recoveryApi,

    ...grantMethods({ grants, prompt, idOf, log }),
  };
}

// Wires the vault into Electron main for the board window (board() is its webContents).
// accountClient (electron/account-client.cjs) syncs shared vaults through Supabase; without it every vault is local.
function setupVault({ ipcMain, dataDir, window, board, accountClient = null }) {
  const { clipboard, dialog, systemPreferences } = require("electron");
  // Every Keychain open and vault use is a line in ~/.weft/vault/audit.jsonl from here on.
  configureAudit({ dataDir });
  // The board window, and the only one the vault answers.
  const isBoard = (sender) => Boolean(sender) && sender === board();
  // A hand edit to a managed .env.local: the board loads the vaults again and its nudge offers the import.
  const onChange = (folder) => {
    const contents = board();
    if (contents && !contents.isDestroyed()) contents.send("vault:changed", folder);
  };
  const vault = createVault({ dataDir, safeStorage: keychainFor("vault key"), sodium: require("./vault-crypto.cjs"), clipboard, prompt: touchIdPrompt({ systemPreferences, dialog, window }), onChange, audit, accountClient, sync: accountClient && createVaultSync({ accountClient, dir: path.join(dataDir, "vault") }) });
  // The shared vault's calls need the account client (they talk to Supabase as the signed-in user)
  // and the device keypair (the wrap and the unwrap). Without a signed-in desktop there is no shared
  // vault, so those handlers aren't registered at all.
  //
  // The rotate needs one more thing: the account's access token, because the plan it makes is
  // written by weft.zip (the deployed Weft, which holds the service key). The token comes out of the
  // sealed account file, the same way electron/app-secrets-push.cjs gets it.
  const token = () => accessToken(accountClient?.read?.() ?? null);
  registerVault(ipcMain, {
    vault,
    isBoard,
    board,
    dataDir,
    accountClient: accountClient ? () => accountClient : null,
    shared: accountClient
      ? {
          grantPending: (opts) => vault.shared().grantPending(opts),
          shareLocal: (opts) => vault.shared().shareLocal(opts),
          rotate: (opts) => vault.shared().rotate({ ...opts, token: token() }),
        }
      : null,
  });
  return vault;
}

module.exports = { setupVault, createVault, registerVault, touchIdPrompt, createUnlock, parseRemote, vaultIdFor, UNLOCK_MS, CLIPBOARD_MS };
