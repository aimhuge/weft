// The weft:// links that only ask the board to show something, as the menu action main sends it (lib/board-menu-bridge.ts):
// weft://card/<id>                         open a card
// weft://secrets?repo=owner/name&share=1   the 🔐 drawer on that repo, Share… up (lib/vault-ask.ts; the team page's
//                                          Share secrets in a browser, docs/architecture/teams-vault.md)
// The board checks each payload itself; this only carries the link's parts across.

/**
 * @param {URL} url
 * @returns {[string, string] | null} the menu action and its payload, or null for a link that isn't one of these
 */
function boardLink(url) {
  if (url.hostname === "card") return ["open-card", url.pathname.replace(/^\/+/, "")];
  if (url.hostname === "secrets") return ["open-secrets", JSON.stringify({ repo: url.searchParams.get("repo"), share: url.searchParams.get("share") === "1" })];
  return null;
}

module.exports = { boardLink };
