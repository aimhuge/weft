// Standing vault access for one thread (docs/architecture/secrets.md#thread-grants): after one Touch ID, a card may
// use one project's vault for GRANT_MS without being asked again: values typed into pane fields on any https site
// (mcp__secrets__fill_field), commands run with secrets (mcp__secrets__run) and its dev server's secrets. It never
// shows the thread a value. Writes (a value the thread made, stored with set_value; a push to Vercel) ask every time
// unless the grant names them: a thread setting up a service asks once for all of it, with writes on, and the Touch ID
// prompt says so. A grant lasts an hour, or for the thread: until its card is Done (lib/vault-grant-done.ts revokes
// it), at most THREAD_MS. Kept in memory only, so quitting Weft ends every grant; Revoke (card menu or the 🔐
// drawer's Activity) ends one (2026-10-29).
//
// A grant is scoped to a site. Filling a secret into a page writes it to that page, so a grant that
// covers a fill names the site it covers, and the Touch ID prompt says which one. A grant with no site
// covers only the site-less powers (a command run, a dev server) and never a fill: without a site in
// it, it says nothing about where a value may be typed (2026-10-28).

const { decideAccess } = require("./vault-access.cjs");

// How long a grant lasts from the Touch ID that gave it.
const GRANT_MS = 60 * 60_000;
// The most a grant for the thread lasts, in case its card never reaches Done (a thread left in Review overnight).
const THREAD_MS = 12 * 60 * 60_000;

/** @typedef {"hour" | "thread"} Span */
/** @typedef {{ card: string, thread?: string, id: string, label: string, site?: string, writes?: boolean, span?: Span, at: number, until: number }} Grant */
/** @typedef {{ card: string, thread?: string, id: string, label: string, site?: string, writes?: boolean, span?: Span }} GrantInput */

function createGrants({ now = Date.now, ms = GRANT_MS, threadMs = THREAD_MS } = {}) {
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

  // Whether the card may write to this vault without asking: any of its live grants for the vault that names writes.
  function allowsWrite(card, id) {
    if (!card || !id) return false;
    return [...grants.keys()].some((key) => {
      const g = live(key);
      return Boolean(g?.writes) && g?.card === card && g?.id === id;
    });
  }

  return {
    ms,
    threadMs,
    allows,
    allowsWrite,
    /**
     * Adds a grant. A grant without a site is valid: it covers only the site-less powers. A new grant never
     * narrows a live one at the same key: the hour after an approved command doesn't end a thread-long grant
     * or take its writes away.
     * @param {GrantInput} grant
     * @returns {Grant}
     */
    add({ card, thread, id, label, site, writes = false, span = "hour" }) {
      const key = keyOf(card, id, site);
      const was = live(key);
      const until = Math.max(now() + (span === "thread" ? threadMs : ms), was?.until ?? 0);
      const wide = was?.span === "thread" && was.until >= until ? "thread" : span;
      const g = { card, thread, id, label, site: site || undefined, writes: writes || Boolean(was?.writes), span: wide, at: now(), until };
      grants.set(key, g);
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

// What the Touch ID prompt says a grant covers and for how long, so the approval is no wider than its words.
function grantReason({ who, label, site, why, writes, span }, grants) {
  const where = site ? ` on ${site}` : "";
  const long = span === "thread" ? `until its card is Done (${spoken(grants.threadMs)} at most)` : `for ${spoken(grants.ms)}`;
  const also = writes ? ", and store secrets it makes in the vault and push them to Vercel," : "";
  return `let ${who} use ${label}'s secrets${where}${also} ${long} without asking each time${why ? ` (${why})` : ""}`;
}

// The vault's grant methods (electron/vault.cjs spreads them in). A grant always takes a fresh Touch ID, never the
// drawer's unlock or a thread's fill unlock: it's a bigger yes than either. by is who asked: "you" from the card
// menu, "thread" from mcp__secrets__request_access.
function grantMethods({ grants, prompt, idOf, log }) {
  const view = (g) => ({ card: g.card, thread: g.thread, id: g.id, label: g.label, site: g.site, writes: g.writes, span: g.span, at: g.at, until: g.until });
  return {
    /**
     * @param {{ card: string, thread?: string, why?: string, by?: string, site?: string, writes?: boolean, span?: Span }} opts
     * @returns {Promise<{ granted?: boolean, denied?: boolean, label: string, until?: number }>}
     */
    async grant(folder, opts) {
      const { card, thread, why, by = "thread", site, writes = false, span = "hour" } = opts;
      if (!card) throw new Error("A grant needs the card it's for.");
      const { id, label } = await idOf(folder);
      const who = thread ? `"${thread}"` : "a thread";
      // The site, the writes and the span are part of what the user approves: the prompt names each, so the
      // approval is no wider than the words on it (2026-10-28, 2026-10-29).
      const reason = grantReason({ who, label, site, why, writes, span }, grants);
      const line = { action: "grant", by, card, thread, vault: label, site, detail: [why, writes && "with writes", span === "thread" && "for the thread"].filter(Boolean).join(", ") || undefined };
      // A grant always takes a fresh Touch ID, never the drawer's unlock or a thread's fill unlock, so it
      // asks even when the card already has access (electron/vault-access.cjs decides it).
      const access = await decideAccess({ card, vaultId: id, ask: () => prompt(reason) });
      if (!access.allowed) return log({ ...line, outcome: "denied" }) && { denied: true, label };
      const g = grants.add({ card, thread, id, label, site, writes, span });
      log(line);
      return { granted: true, label, until: g.until, writes: g.writes, span: g.span };
    },

    // The hour that comes with saying yes to a card's command run or dev server (electron/secret-run.cjs): the
    // user just passed Touch ID for this card and vault, so its next runs and restarts don't ask again. It has no
    // site, so it never covers typing a value into a page; only main calls it, right after that Touch ID.
    /** @param {{ card: string, thread?: string, id: string, label: string }} opts */
    grantAfterApproval({ card, thread, id, label }) {
      if (!card || !id) return null;
      const g = grants.add({ card, thread, id, label });
      log({ action: "grant", by: "you", card, thread, vault: label, detail: "for the hour after you approved a command" });
      return view(g);
    },

    // Whether the card may use this vault without asking (electron/secret-run.cjs asks before a run).
    // A site, when the caller has one, is the page a value would be typed into.
    granted: (card, id, site) => grants.allows(card, id, site),

    // Whether the card's grant for this folder's vault covers writes (set_value, a push to Vercel), so the write
    // goes ahead without another Touch ID (electron/vault-routes.cjs, electron/vault-thread-tools.cjs).
    async writeGranted(card, folder) {
      if (!card) return false;
      const { id } = await idOf(folder);
      return grants.allowsWrite(card, id);
    },

    grantList: () => grants.list().map(view),

    // Ends the card's grant for one vault id, or all of its grants.
    revoke(card, id, by = "you") {
      const ended = grants.revoke(card, id);
      for (const g of ended) log({ action: "revoke", by, card, thread: g.thread, vault: g.label, site: g.site });
      return { revoked: ended.length };
    },
  };
}

module.exports = { createGrants, grantMethods, GRANT_MS, THREAD_MS };
