// What a thread may read of a vault, and the Touch ID gates around it (docs/architecture/secrets.md).
// A value reaches a thread's context only through one of these, and only after the user said yes:
// useFor (a card's standing grant, or a Touch ID), sendValue (a write somewhere else, every time),
// confirm (a write a thread asks for), and valuesFor (a command main runs, never over IPC).
//
// Kept beside the vault so electron/vault.cjs stays about the vault itself.

const { createUnlock } = require("./vault-unlock.cjs");
const { decideAccess } = require("./vault-access.cjs");

/**
 * The thread-facing calls of a vault.
 *
 * @param {{ idOf: (folder: string) => Promise<{ id: string, label: string }>, storeReady: () => Promise<any>,
 *   existing: () => Promise<any>, store: () => any, log: (entry: Record<string, unknown>) => unknown,
 *   grants: any, prompt: (reason: string) => Promise<boolean>, now: () => number, onChange: (folder: string) => void }} deps
 */
function createThreadTools({ idOf, storeReady, existing, store, log, grants, prompt, now, onChange }) {
  // Each card's own unlocks, one per card, site and vault: the drawer being unlocked never lets a
  // thread in, and a yes for one site never covers another.
  const threadUnlocks = new Map();

  // Fills a value into a site for a card (electron/vault-routes.cjs): the card's standing grant if it
  // has one, else a Touch ID the first time and for UNLOCK_MS from its last use.
  /** @param {{ card: string, site: string, thread?: string }} who */
  async function useFor(folder, name, environment, who) {
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
  }

  // Hands one value to send() in main after a Touch ID every time, even while unlocked: a push to a service
  // (electron/vercel-env.cjs) is a write somewhere else. What send returns comes back; the value doesn't.
  async function sendValue(folder, name, environment, reason, send) {
    const { label, values } = await valuesFor(folder, [name], environment, false);
    const line = { action: "send", by: "weft", vault: label, names: [name], environment, detail: reason(label) };
    if (!(name in values)) return log({ ...line, outcome: "missing" }) && { missing: true, label };
    if (!(await prompt(reason(label)))) return log({ ...line, outcome: "denied" }) && { denied: true, label };
    log(line);
    return { ...(await send(values[name])), label };
  }

  // A Touch ID with no unlock cache, for a write a thread asks for (electron/vault-routes.cjs).
  // A no is a line in the audit log; a yes is the write's own line.
  async function confirm(reason) {
    const ok = await prompt(reason);
    if (!ok) log({ action: "ask", by: "weft", detail: reason, outcome: "denied" });
    return ok;
  }

  // Values for a command main runs (electron/secret-run.cjs), never sent over IPC. names null means every
  // name with a value in that environment, for a dev server. The caller asks the user first. use says who read
  // them for the audit line (default: Weft itself), or is false when the caller writes its own line.
  async function valuesFor(folder, names, environment, use = {}) {
    const { id, label } = await idOf(folder);
    // s is null when there's no vault for this project yet.
    const s = (await existing())?.exists(id) ? store() : null;
    const all = s ? s.list(id).filter((e) => e.environment === environment && !e.missing).map((e) => e.name) : [];
    const found = (names ?? all).map((name) => [name, s?.get(id, name, environment)]);
    const read = found.filter(([, v]) => v !== undefined).map(([n]) => n);
    if (use && read.length) log({ action: "read", by: "weft", ...use, vault: label, names: read, environment });
    return { id, label, values: Object.fromEntries(found.filter(([, v]) => v !== undefined)), missing: found.filter(([, v]) => v === undefined).map(([n]) => n) };
  }

  // Tells the board a folder's vault changed, for a write that doesn't itself (the intake's import).
  const notify = (folder) => onChange(folder);

  return { useFor, sendValue, confirm, valuesFor, notify, threadUnlocks };
}

module.exports = { createThreadTools };
