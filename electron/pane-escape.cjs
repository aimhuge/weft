// Escape in the browser pane, and the board.
//
// A page in the pane has the keyboard focus, so the board never sees the key. Escape is therefore
// replayed into the board, where it closes the newest layer as usual (a thread, the browser itself,
// and with nothing open, the flip between board and list view).
//
// Escape types nothing, so Chromium reports it as a rawKeyDown rather than a keyDown. Matching on
// "keyDown" alone dropped it, and the board never heard the key at all.

// The Escape to replay into the board, or null when this key event isn't one.
// `fullscreen` keeps Escape in the pane, where a fullscreen video needs it to leave fullscreen.
function escapeToReplay(input, { fullscreen = false } = {}) {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return null;
  if (input.key !== "Escape" || fullscreen) return null;
  if (input.shift || input.control || input.alt || input.meta) return null;
  return { type: "keyDown", keyCode: "Escape" };
}

module.exports = { escapeToReplay };
