// @vitest-environment happy-dom
// onBoardItself (lib/hotkeys.ts): whether a key was pressed on the board itself, for plain letters that open something
// heavy (the terminal's "t"), so a stray key from a panel, a review box, a control or a dialog never does.
import { afterEach, describe, expect, it } from "vitest";
import { onBoardItself } from "./hotkeys";

describe("onBoardItself", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true for the board's own columns and for nothing focused with no dialog up", () => {
    document.body.innerHTML = `<main data-board-surface><section><div id="col">x</div></section></main>`;
    expect(onBoardItself(document.getElementById("col"))).toBe(true);
    expect(onBoardItself(document.body)).toBe(true);
    expect(onBoardItself(document.documentElement)).toBe(true);
  });

  it("is false in a field, a control, a dialog, a frame, or outside the board, and with a dialog up", () => {
    document.body.innerHTML = `
      <main data-board-surface><button id="btn">b</button><input id="box" type="checkbox"><div contenteditable="true"><span id="ed">e</span></div></main>
      <aside id="review">review</aside>
      <div role="dialog"><p id="dlg">d</p></div>
      <webview id="frame"></webview>`;
    for (const id of ["btn", "box", "ed", "review", "dlg", "frame"]) expect(onBoardItself(document.getElementById(id))).toBe(false);
    expect(onBoardItself(window)).toBe(false);
    expect(onBoardItself(null)).toBe(false);
    document.body.insertAdjacentHTML("beforeend", `<div aria-modal="true"></div>`);
    expect(onBoardItself(document.body)).toBe(false);
  });
});
