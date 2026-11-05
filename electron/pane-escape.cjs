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

// Wires a pane page to replay its Escape into the board (boardContents() gives the board's webContents, or undefined).
// It tracks the page's fullscreen itself, so a fullscreen video keeps its Escape.
function replayEscapeToBoard(wc, boardContents) {
  let fullscreen = false;
  wc.on("enter-html-full-screen", () => (fullscreen = true));
  wc.on("leave-html-full-screen", () => (fullscreen = false));
  wc.on("before-input-event", (_e, input) => {
    const escape = escapeToReplay(input, { fullscreen });
    if (!escape) return;
    const board = boardContents();
    if (!board) return;
    board.focus();
    board.sendInputEvent(escape);
    board.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  });
}

module.exports = { escapeToReplay, replayEscapeToBoard };
