// The Vercel side of the vault ⇄ Vercel drift (docs/architecture/vercel.md "Drift"): each linked folder's env list
// (names, targets and types, never a value), kept per folder so the 🔐 and ▲ badges and the copilot can line it up
// against the vault without a Vercel call each time. A missing or stale list is fetched in the background, after the
// answer, and onChange(folder) tells the board when it lands. Every real listing (the drawers' status, push, pull)
// refreshes it too. Nothing here runs when a card starts: only the board's folder list and the copilot ask.

const TTL_MS = 10 * 60_000;

/** @param {{ list: (folder: string) => Promise<any>, linked: (folder: string) => boolean, onChange?: (folder: string) => void, now?: () => number, later?: (fn: () => unknown) => unknown, ttl?: number }} deps */
function createEnvCache({ list, linked, onChange = () => {}, now = Date.now, later = setImmediate, ttl = TTL_MS }) {
  /** @type {Map<string, { at: number, value: unknown, key: string }>} */
  const lists = new Map();
  const pending = new Set();

  // Keeps a list and tells the board only when what it says changed.
  function keep(folder, value) {
    const key = JSON.stringify(value);
    const was = lists.get(folder)?.key;
    lists.set(folder, { at: now(), value, key });
    if (was !== key) onChange(folder);
  }

  function refresh(folder) {
    if (pending.has(folder)) return;
    pending.add(folder);
    later(() =>
      list(folder)
        .then(
          (value) => keep(folder, value),
          // Signed out or Vercel down: keep what we had and ask again after the TTL.
          () => lists.set(folder, { ...(lists.get(folder) ?? { value: null, key: "null" }), at: now() }),
        )
        .finally(() => pending.delete(folder)),
    );
  }

  return {
    // A real listing, kept on the way through.
    async listed(folder) {
      const value = await list(folder);
      keep(folder, value);
      return value;
    },
    // What's kept for a folder right now, or null; starts a background fetch when it's missing or stale.
    peek(folder) {
      if (!linked(folder)) {
        lists.delete(folder);
        return null;
      }
      const hit = lists.get(folder);
      if (!hit || now() - hit.at > ttl) refresh(folder);
      return hit?.value ?? null;
    },
  };
}

module.exports = { createEnvCache, TTL_MS };
