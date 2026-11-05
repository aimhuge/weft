// Which card a vault request is for, proven rather than claimed (docs/architecture/secrets.md).
//
// The control server (electron/browser-pane.cjs) is reached by the Next server, which holds the
// launch token and knows which card a turn belongs to. Electron main used to take the card id from
// the request body, so anything that could shape that body could act as any card: a card's grant,
// its unlocks and its audit lines all hang off that id. Now the server signs the card id with the
// launch token, and main verifies the signature before it believes the id. A request without a
// valid signature has no card, and the vault routes refuse it.
//
// The signature is an HMAC over the card id and the route, so a signature for one route can't be
// replayed on another (a grant for one card's vault can't become a run for another's).

const crypto = require("node:crypto");

// The tag the server sends with a card id. Short: it travels in a JSON body on every vault call.
const CARD_FIELD = "card";
const SIG_FIELD = "cardSig";

/**
 * The signature for one card and route, as the server sends it.
 * @param {string} secret the launch token, shared by the server and main
 * @param {string} card the card's id
 * @param {string} route the route the card is asking about, e.g. "/secrets/fill"
 * @returns {string} hex HMAC
 */
function signCard(secret, card, route) {
  return crypto.createHmac("sha256", String(secret)).update(`${route}\n${card}`).digest("hex");
}

// Constant-time, so a signature can't be guessed a byte at a time.
function same(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * The card a request is for, or "" when it proves nothing.
 *
 * @param {{ secret: string, route: string, body: Record<string, unknown> }} options
 * @returns {string} the card id, or "" when the request carries no valid signature
 */
function cardOf({ secret, route, body }) {
  const card = String(body?.[CARD_FIELD] ?? "");
  const sig = String(body?.[SIG_FIELD] ?? "");
  if (!card || !sig || !secret) return "";
  return same(sig, signCard(secret, card, route)) ? card : "";
}

/**
 * The card a request is for, for one launch's token. Handed to the route tables so every
 * vault-facing route asks the same question the same way.
 * @param {string} secret the launch token
 * @returns {(body: Record<string, unknown>, route: string) => string}
 */
function cardFinder(secret) {
  return (body, route) => cardOf({ secret, route, body });
}

module.exports = { signCard, cardOf, cardFinder, CARD_FIELD, SIG_FIELD };
