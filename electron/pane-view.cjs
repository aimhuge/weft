// electron/browser-pane.cjs: one pane tab's view, made and laid out. Its rules (when a page shows, plays
// sound and keeps painting) live in electron/pane-visibility.cjs; this applies them to a WebContentsView.
const path = require("node:path");
const { throttlesOffScreen } = require("./pane-visibility.cjs");

// Its own session, apart from the board window's, so pages never carry the launch token (electron/api-token.cjs).
const PANE_PARTITION = "persist:threadboard-browser";

// A new tab is its card's current one until another opens, so it starts unthrottled; placeView keeps that up to date.
function paneWebPreferences() {
  return {
    partition: PANE_PARTITION,
    sandbox: true,
    contextIsolation: true,
    backgroundThrottling: false,
    preload: path.join(__dirname, "pane-preload.cjs"),
  };
}

// Puts a tab's view where the pane is, shown only when it is the page on screen. cardsCurrent: it is its
// card's current tab, the one the agent tools act on, whether or not that card is open.
function placeView(view, { bounds, onScreen, cardsCurrent, focusBoard }) {
  const wc = view.webContents;
  view.setBounds(bounds);
  // A hidden page keeps keyboard focus, and then no key reaches anything (Escape least of all).
  const losesFocus = !onScreen && wc.isFocused();
  view.setVisible(onScreen);
  if (losesFocus) focusBoard();
  // Only the page on screen plays sound; background cards' pages keep running but stay silent.
  wc.setAudioMuted(!onScreen);
  // Off screen, a card's current tab keeps painting for the agent tools (electron/pane-visibility.cjs).
  wc.setBackgroundThrottling(throttlesOffScreen(cardsCurrent));
}

module.exports = { PANE_PARTITION, paneWebPreferences, placeView };
