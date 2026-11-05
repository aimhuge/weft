// A focused page swallows keys the board never sees, so Escape is replayed into the board too,
// where it closes the newest layer as usual. A fullscreen video keeps it to leave fullscreen.
function replayEscape(wc, boardContents) {
  let fullscreen = false;
  wc.on("enter-html-full-screen", () => (fullscreen = true));
  wc.on("leave-html-full-screen", () => (fullscreen = false));
  wc.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || input.key !== "Escape" || fullscreen) return;
    if (input.shift || input.control || input.alt || input.meta) return;
    const board = boardContents();
    if (!board) return;
    board.focus();
    board.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    board.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  });
}

module.exports = { replayEscape };
