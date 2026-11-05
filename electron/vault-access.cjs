// One place that answers "may this card use this vault right now, and how was it allowed?" (docs/architecture/secrets.md).
// Three paths ask it, and the audit log's via column has to agree on the words: the vault's fill
// (electron/vault.cjs), a command run with secrets (electron/secret-run.cjs), and the grant a thread asks for
// (electron/vault-grants.cjs).

/** The words the audit log's via column uses. */
const VIA = {
  // The card's standing grant for the vault (electron/vault-grants.cjs).
  grant: "grant",
  // The card's own Touch ID for this site and vault, still open (electron/vault.cjs's threadUnlocks).
  unlocked: "unlocked",
  // A Touch ID asked for now.
  "touch-id": "touch-id",
  // A command the user said may always run with certain secrets (electron/run-rules.cjs).
  rule: "rule",
  // The user said yes, for this once.
  once: "once",
  // The user said yes, and to remember it.
  always: "always",
};

const NO = { allowed: false, via: null };

// The card's own approval for one site and vault: still open, or one Touch ID away.
async function byTouchId({ unlockFor, reason }) {
  const holder = await unlockFor();
  const via = holder.unlocked() ? VIA.unlocked : VIA["touch-id"];
  return { allowed: Boolean(await holder.ensure(reason)), via };
}

// The user says yes: once, or always (which also remembers a rule).
async function byTheUser({ ask, remember }) {
  const choice = await ask();
  if (!choice) return NO;
  if (choice !== VIA.always) return { allowed: true, via: VIA.once };
  remember?.();
  return { allowed: true, via: VIA.always };
}

/**
 * Whether a card may use a vault, and the word the audit log records for it.
 *
 * The ways in, in the order they are tried:
 *  - grants: the card's standing grant for the vault. Live, it is allowed outright ("grant").
 *  - rule: a command the user said may always run with these secrets ("rule").
 *  - unlockFor: the card's own approval for one site and vault ("unlocked", or "touch-id" asked for now).
 *  - ask: the user saying yes ("once", or "always" with a rule remembered).
 *
 * Only one of unlockFor and ask is given by a caller: a fill asks for a Touch ID, a command asks the user,
 * a grant asks the user for an hour.
 *
 * site is the page a value would be typed into, when the caller has one. A grant that names a site
 * covers that site and nothing else, and a grant with no site covers only the site-less powers: a
 * grant is never wider than the approval the user read (2026-10-28).
 *
 * @param {{ grants?: any, card: string, vaultId: string, site?: string, rule?: any, unlockFor?: any, reason?: string, ask?: any, remember?: any }} options
 */
async function decideAccess({ grants, card, vaultId, site, rule = null, unlockFor = null, reason = "", ask = null, remember = null }) {
  // The card's standing grant for this vault, on this site: no question at all.
  if (grants?.allows?.(card, vaultId, site)) return { allowed: true, via: VIA.grant };

  // A command the user said may always run with these secrets.
  if (rule && rule.allows()) return { allowed: true, via: VIA.rule };

  // The card's own approval for this site and vault.
  if (unlockFor) return byTouchId({ unlockFor, reason });

  // The user says yes.
  if (ask) return byTheUser({ ask, remember });

  return NO;
}

module.exports = { decideAccess, VIA };
