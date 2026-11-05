// electron/pane-escape.cjs: Escape on a focused page reaches the board too.
import { describe, expect, it, vi } from "vitest";
import { replayEscape } from "./pane-escape.cjs";

function setup(board: { focus: () => void; sendInputEvent: (e: unknown) => void } | undefined) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const wc = { on: (event: string, fn: (...args: unknown[]) => void) => handlers.set(event, fn) };
  replayEscape(wc, () => board);
  const press = (input: Record<string, unknown>) => handlers.get("before-input-event")!({}, { type: "keyDown", key: "Escape", ...input });
  return { handlers, press };
}

describe("replayEscape", () => {
  it("replays a plain Escape into the board", () => {
    const board = { focus: vi.fn(), sendInputEvent: vi.fn() };
    setup(board).press({});
    expect(board.focus).toHaveBeenCalled();
    expect(board.sendInputEvent.mock.calls).toEqual([[{ type: "keyDown", keyCode: "Escape" }], [{ type: "keyUp", keyCode: "Escape" }]]);
  });

  it("leaves other keys, modified Escapes and a fullscreen video's Escape alone", () => {
    const board = { focus: vi.fn(), sendInputEvent: vi.fn() };
    const { handlers, press } = setup(board);
    press({ key: "a" });
    press({ type: "keyUp" });
    for (const mod of ["shift", "control", "alt", "meta"]) press({ [mod]: true });
    handlers.get("enter-html-full-screen")!();
    press({});
    expect(board.sendInputEvent).not.toHaveBeenCalled();
    handlers.get("leave-html-full-screen")!();
    press({});
    expect(board.sendInputEvent).toHaveBeenCalledTimes(2);
  });

  it("does nothing with no board", () => {
    expect(() => setup(undefined).press({})).not.toThrow();
  });
});
