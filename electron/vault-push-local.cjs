// Push's two steps on a folder, for electron/vault-shared-api.cjs `pushLocal` (docs/architecture/teams-vault.md,
// "Joining a shared vault" step 4): which of a shared vault's values are on this Mac only, then send the picked ones
// up through the store, with one audit line per environment and the drawer told to reload. Names only, never values.

/**
 * @param {{ idOf: (folder: string) => Promise<{ id: string, label: string }>, storeReady: () => Promise<any>,
 *   log: (entry: Record<string, unknown>) => unknown, onChange: (folder: string) => void }} deps
 */
function pushLocalSteps({ idOf, storeReady, log, onChange }) {
  async function localOnly(folder) {
    const { id, label } = await idOf(folder);
    return { label, entries: (await storeReady()).localOnly(id) };
  }

  /** @param {{ name: string, environment: string }[]} picked */
  async function pushLocal(folder, picked) {
    const { id, label } = await idOf(folder);
    /** @type {{ pushed: { name: string, environment: string }[], kept: { name: string, environment: string }[], queued: number }} */
    const result = await (await storeReady()).pushLocal(id, picked);
    for (const environment of new Set(result.pushed.map((p) => p.environment))) {
      const names = result.pushed.filter((p) => p.environment === environment).map((p) => p.name);
      log({ action: "push", by: "you", vault: label, names, environment, detail: "only on this Mac" });
    }
    onChange(folder);
    return result;
  }

  return { localOnly, pushLocal };
}

module.exports = { pushLocalSteps };
