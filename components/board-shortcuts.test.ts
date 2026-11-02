// @vitest-environment jsdom
// The board's plain "t": it toggles the terminal only from the board itself with no card open, so a "t" typed or
// pressed anywhere else (a review box, a button, a dialog, an open card) never opens a shell.
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardShortcuts, type BoardShortcutContext } from "./board-shortcuts";

afterEach(() => {
  document.body.innerHTML = "";
});

function terminalKey(over: Partial<BoardShortcutContext> = {}) {
  const toggleTerminal = vi.fn();
  const ctx = { boardKeys: true, cardOpen: false, toggleTerminal, ...over } as BoardShortcutContext;
  const def = boardShortcuts(ctx).find((d) => d.id === "terminal");
  if (!def) throw new Error("no terminal shortcut");
  return { def, toggleTerminal };
}
const press = (target: EventTarget) => ({ target }) as unknown as KeyboardEvent;

describe("the terminal shortcut", () => {
  it("toggles from the board itself", () => {
    document.body.innerHTML = `<main data-board-surface><div id="col"></div></main>`;
    const { def, toggleTerminal } = terminalKey();
    expect(def.enabled).toBe(true);
    def.handler(press(document.getElementById("col") as HTMLElement));
    def.handler(press(document.body));
    expect(toggleTerminal).toHaveBeenCalledTimes(2);
  });

  it("passes the key on from anywhere else, and stands down with a card open or a dialog up", () => {
    document.body.innerHTML = `<aside><p id="review">feedback</p><button id="btn">ok</button></aside>`;
    const { def, toggleTerminal } = terminalKey();
    expect(def.handler(press(document.getElementById("review") as HTMLElement))).toBe(false);
    expect(def.handler(press(document.getElementById("btn") as HTMLElement))).toBe(false);
    expect(toggleTerminal).not.toHaveBeenCalled();
    expect(terminalKey({ cardOpen: true }).def.enabled).toBe(false);
    expect(terminalKey({ boardKeys: false }).def.enabled).toBe(false);
  });
});
