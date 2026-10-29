// electron/browser-pane.cjs: whether the pane shows for the card that just became active.
//
// The rule: a card and its browser go together. Opening a card shows the pane, whether or not the
// card has a page loaded yet (the board's own placeholder shows in the meantime), and the board
// itself — no card open — hides it. A pane the user closed earlier comes back with the next card.
//
// Pure, so it can be tested without standing up the pane's webContentsView.

// The board's own key: the pane when no card is open.
const BOARD = "board";

// The key a card becomes active under: the card's id, or the board's when no card is open.
function activeKey(key) {
  return key || BOARD;
}

// Whether the pane shows for the active key.
function paneVisibleFor(key) {
  return activeKey(key) !== BOARD;
}

// Whether a card that just became active needs its remembered page restored: it has none loaded.
function needsRestore(key, hasPage) {
  return activeKey(key) !== BOARD && !hasPage;
}

// The key the pane switches to when the board asks for it with one, and the key it stays on when
// the board doesn't say. The board asks for the pane (setVisible) and then activates the card
// (setActive), so without the key the pane would be made for the card that was active a moment
// ago: the old card's page, or the board's own, flashing over the new one for a frame.
function switchKey(key, current) {
  if (key === undefined || key === null) return current;
  return activeKey(key);
}

module.exports = { BOARD, activeKey, paneVisibleFor, needsRestore, switchKey };
