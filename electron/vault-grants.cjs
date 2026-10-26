// Standing vault access for one thread (docs/architecture/secrets.md#thread-grants): after one Touch ID, a card may
// use one project's vault for GRANT_MS without being asked again: values typed into pane fields on any https site
// (mcp__secrets__fill_field), commands run with secrets (mcp__secrets__run) and its dev server's secrets. It never
// shows the thread a value, and it doesn't cover writes or pushes to another service: those still ask every time.
// Kept in memory only, so quitting Weft ends every grant; Revoke (card menu or the 🔐 drawer's Activity) ends one.

// How long a grant lasts from the Touch ID that gave it.
const GRANT_MS = 60 * 60_000;

/** @typedef {{ card: string, thread?: string, id: string, label: string, at: number, until: number }} Grant */

function createGrants({ now = Date.now, ms = GRANT_MS } = {}) {
  /** @type {Map<string, Grant>} */
  const grants = new Map(); // card \n vault id -> grant
  const keyOf = (card, id) => `${card}\n${id}`;

  // The grant if it's still live; an expired one is dropped on the way.
  function live(key) {
    const g = grants.get(key);
    if (g && now() > g.until) grants.delete(key);
    return grants.get(key) ?? null;
  }

  return {
    ms,
    allows: (card, id) => Boolean(card && id && live(keyOf(card, id))),
    /** @returns {Grant} */
    add({ card, thread, id, label }) {
      const g = { card, thread, id, label, at: now(), until: now() + ms };
      grants.set(keyOf(card, id), g);
      return g;
    },
    // Ends the card's grant for one vault, or for every vault when id is left out. Returns what it ended.
    /** @returns {Grant[]} */
    revoke(card, id) {
      const ended = [...grants.entries()].filter(([, g]) => g.card === card && (id === undefined || g.id === id));
      for (const [key] of ended) grants.delete(key);
      return ended.map(([, g]) => g);
    },
    /** @returns {Grant[]} */
    list: () => [...grants.keys()].map(live).filter((g) => g !== null),
  };
}

// How long a grant lasts, said the way the Touch ID prompt says it.
const spoken = (ms) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000} hour${ms === 3_600_000 ? "" : "s"}` : `${Math.round(ms / 60_000)} minutes`);

// The vault's grant methods (electron/vault.cjs spreads them in). A grant always takes a fresh Touch ID, never the
// drawer's unlock or a thread's fill unlock: it's a bigger yes than either. by is who asked: "you" from the card
// menu, "thread" from mcp__secrets__request_access.
function grantMethods({ grants, prompt, idOf, log }) {
  const view = (g) => ({ card: g.card, thread: g.thread, id: g.id, label: g.label, at: g.at, until: g.until });
  return {
    /**
     * @param {{ card: string, thread?: string, why?: string, by?: string }} opts
     * @returns {Promise<{ granted?: boolean, denied?: boolean, label: string, until?: number }>}
     */
    async grant(folder, opts) {
      const { card, thread, why, by = "thread" } = opts;
      if (!card) throw new Error("A grant needs the card it's for.");
      const { id, label } = await idOf(folder);
      const who = thread ? `"${thread}"` : "a thread";
      const reason = `let ${who} use ${label}'s secrets for ${spoken(grants.ms)} without asking each time${why ? ` (${why})` : ""}`;
      const line = { action: "grant", by, card, thread, vault: label, detail: why };
      if (!(await prompt(reason))) return log({ ...line, outcome: "denied" }) && { denied: true, label };
      const g = grants.add({ card, thread, id, label });
      log(line);
      return { granted: true, label, until: g.until };
    },

    // Whether the card may use this vault without asking (electron/secret-run.cjs asks before a run).
    granted: (card, id) => grants.allows(card, id),

    grantList: () => grants.list().map(view),

    // Ends the card's grant for one vault id, or all of its grants.
    revoke(card, id, by = "you") {
      const ended = grants.revoke(card, id);
      for (const g of ended) log({ action: "revoke", by, card, thread: g.thread, vault: g.label });
      return { revoked: ended.length };
    },
  };
}

module.exports = { createGrants, grantMethods, GRANT_MS };
