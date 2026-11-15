// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setBoardMode } from "./board-prefs";
import { pieceOverride, setSimplePiece, SIMPLE_PIECES, simplePieceOn } from "./simple-mode";

function clearCookies() {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

describe("simple mode pieces", () => {
  afterEach(clearCookies);

  it("follow the board mode with no override", () => {
    for (const piece of SIMPLE_PIECES) expect(simplePieceOn(piece)).toBe(false);
    setBoardMode("regular");
    for (const piece of SIMPLE_PIECES) expect(simplePieceOn(piece)).toBe(true);
  });

  it("an override wins over the mode either way", () => {
    setSimplePiece("pane-full", true);
    expect(simplePieceOn("pane-full")).toBe(true);
    setBoardMode("regular");
    setSimplePiece("three-piles", false);
    expect(simplePieceOn("three-piles")).toBe(false);
    expect(pieceOverride("three-piles")).toBe(false);
  });

  it("clearing the override follows the mode again and fires the prefs event", () => {
    let fired = 0;
    const on = () => fired++;
    window.addEventListener("weft-board-prefs", on);
    setBoardMode("regular");
    setSimplePiece("fold-turn-steps", false);
    setSimplePiece("fold-turn-steps", undefined);
    window.removeEventListener("weft-board-prefs", on);
    expect(pieceOverride("fold-turn-steps")).toBeUndefined();
    expect(simplePieceOn("fold-turn-steps")).toBe(true);
    expect(fired).toBe(3);
  });
});
