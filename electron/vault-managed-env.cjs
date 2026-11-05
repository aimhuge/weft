// The managed .env.local of a vault (docs/architecture/secrets.md): the file Weft writes from the
// vault's development values, and the one it watches for hand edits. Kept beside the vault's other
// pieces so electron/vault.cjs stays about the vault itself.

const path = require("node:path");
const { MANAGED_FILE, isManaged, readOrNull, renderEnv, writeFileAtomic } = require("./env-writeback.cjs");

/**
 * The managed .env.local of a vault: what to write, where, and when to write it again.
 *
 * @param {{ store: () => any, watcher: any, ids: Map<string, { id: string, label: string }> }} deps
 */
function createManagedEnv({ store, watcher, ids }) {
  // Whether the folder's .env.local is Weft's, watching it if so (a restart picks the watch up again here).
  function watchManaged(folder) {
    const text = readOrNull(path.join(folder, MANAGED_FILE));
    if (!isManaged(text)) return false;
    if (!watcher.watching(folder)) watcher.wrote(folder, text);
    return true;
  }

  // The development values as .env.local's text. Only called with the store open.
  function managedText(id) {
    const s = store();
    const entries = s.exists(id) ? s.list(id).filter((e) => e.environment === "development") : [];
    return renderEnv(entries.map((e) => ({ name: e.name, value: e.missing ? null : s.get(id, e.name, "development") })));
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

  return { watchManaged, managedText, writeManaged, refreshManaged };
}

module.exports = { createManagedEnv };
