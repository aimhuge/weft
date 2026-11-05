// Find in page for the browser pane: the board's find bar (components/PaneFindBar.tsx) asks for a word, Chromium
// highlights its matches in the page, and each count comes back to the bar as "browser:found".

// next is false while the user types (a new search) and true for Enter / Shift+Enter (the next or previous match).
function findInPage(wc, text, { forward = true, next = false } = {}) {
  if (!wc || wc.isDestroyed()) return;
  const query = String(text ?? "");
  if (!query) return stopFind(wc);
  wc.findInPage(query, { forward: forward !== false, findNext: !next });
}

// Clears the highlights and leaves the current match selected, as Chrome does when its find bar closes.
function stopFind(wc) {
  if (wc && !wc.isDestroyed()) wc.stopFindInPage("keepSelection");
}

// Chromium reports the active match and the count in pieces; send whatever it knows.
function watchFind(wc, onFound) {
  wc.on("found-in-page", (_e, result) => onFound({ active: result.activeMatchOrdinal ?? 0, matches: result.matches ?? 0 }));
}

module.exports = { findInPage, stopFind, watchFind };
