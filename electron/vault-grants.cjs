// Standing vault access for one thread (docs/architecture/secrets.md#thread-grants): after one Touch ID, a card may
// use one project's vault for GRANT_MS without being asked again: values typed into pane fields on any https site
// (mcp__secrets__fill_field), commands run with secrets (mcp__secrets__run) and its dev server's secrets. It never
// shows the thread a value, and it doesn't cover writes or pushes to another service: those still ask every time.
// Kept in memory only, so quitting Weft ends every grant; Revoke (card menu or the 🔐 drawer's Activity) ends one.
//
// A grant is scoped to a site. Filling a secret into a page writes it to that page, so a grant that
// covers a fill names the site it covers, and the Touch ID prompt says which one. A grant with no site
// covers only the site-less powers (a command run, a dev server) and never a fill: without a site in
// it, it says nothing about where a value may be typed (2026-10-28).

const { decideAccess } = require("./vault-access.cjs");

// How long a grant lasts from the Touch ID that gave it.
const GRANT_MS = 60 * 60_000;

/** @typedef {{ card: string, thread?: string, id: string, label: string, site?: string, at: number, until: number }} Grant */
/** @typedef {{ card: string, thread?: string, id: string, label: string, site?: string }} GrantInput */

function createGrants({ now = Date.now, ms = GRANT_MS } = {}) {
  /** @type {Map<string, Grant>} */
  const grants = new Map(); // card \n site \n vault id -> grant
  // A grant without a site is keyed by an empty site, so a card's grants for one vault don't
  // overwrite each other when it has one for several sites.
  const keyOf = (card, id, site) => `${card}\n${site ?? ""}\n${id}`;

  // The grant if it's still live; an expired one is dropped on the way.
  function live(key) {
    const g = grants.get(key);
    if (g && now() > g.until) grants.delete(key);
    return grants.get(key) ?? null;
  }

  // Whether this card may use this vault for this site. A site-less power (a run, a dev server)
  // asks with no site and is covered by any of the card's grants for the vault; a fill asks with
  // the page's host and is covered only by a grant that names that host.
  function allows(card, id, site) {
    if (!card || !id) return false;
    if (site) return Boolean(live(keyOf(card, id, site)));
    return [...grants.keys()].some((key) => {
      const g = live(key);
      return Boolean(g) && g.card === card && g.id === id;
    });
  }

  return {
    ms,
    allows,
    /**
     * Adds a grant. A grant without a site is valid: it covers only the site-less powers.
     * @param {GrantInput} grant
     * @returns {Grant}
     */
    add({ card, thread, id, label, site }) {
      const g = { card, thread, id, label, site: site || undefined, at: now(), until: now() + ms };
      grants.set(keyOf(card, id, site), g);
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
  const view = (g) => ({ card: g.card, thread: g.thread, id: g.id, label: g.label, site: g.site, at: g.at, until: g.until });
  return {
    /**
     * @param {{ card: string, thread?: string, why?: string, by?: string, site?: string }} opts
     * @returns {Promise<{ granted?: boolean, denied?: boolean, label: string, until?: number }>}
     */
    async grant(folder, opts) {
      const { card, thread, why, by = "thread", site } = opts;
      if (!card) throw new Error("A grant needs the card it's for.");
      const { id, label } = await idOf(folder);
      const who = thread ? `"${thread}"` : "a thread";
      // The site is part of what the user approves: a grant that covers typing a value into a page
      // says which page, so the approval is no wider than the words on it (2026-10-28).
      const where = site ? ` on ${site}` : "";
      const reason = `let ${who} use ${label}'s secrets${where} for ${spoken(grants.ms)} without asking each time${why ? ` (${why})` : ""}`;
      const line = { action: "grant", by, card, thread, vault: label, site, detail: why };
      // A grant always takes a fresh Touch ID, never the drawer's unlock or a thread's fill unlock, so it
      // asks even when the card already has access (electron/vault-access.cjs decides it).
      const access = await decideAccess({ card, vaultId: id, ask: () => prompt(reason) });
      if (!access.allowed) return log({ ...line, outcome: "denied" }) && { denied: true, label };
      const g = grants.add({ card, thread, id, label, site });
      log(line);
      return { granted: true, label, until: g.until };
    },

    // Whether the card may use this vault without asking (electron/secret-run.cjs asks before a run).
    // A site, when the caller has one, is the page a value would be typed into.
    granted: (card, id, site) => grants.allows(card, id, site),

    grantList: () => grants.list().map(view),

    // Ends the card's grant for one vault id, or all of its grants.
    revoke(card, id, by = "you") {
      const ended = grants.revoke(card, id);
      for (const g of ended) log({ action: "revoke", by, card, thread: g.thread, vault: g.label, site: g.site });
      return { revoked: ended.length };
    },
  };
}

module.exports = { createGrants, grantMethods, GRANT_MS };
