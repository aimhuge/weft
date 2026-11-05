import { describe, expect, it, vi } from "vitest";
import { escapeToReplay, replayEscapeToBoard } from "./pane-escape.cjs";

// Escape in the browser pane, replayed into the board. Escape types nothing, so Chromium reports
// it as a rawKeyDown: the pane used to drop those, and the board never heard the key.

const key = (over: Record<string, unknown> = {}) => ({ type: "keyDown", key: "Escape", ...over });

describe("escapeToReplay", () => {
  it("replays a plain Escape into the board", () => {
    expect(escapeToReplay(key())).toEqual({ type: "keyDown", keyCode: "Escape" });
  });

  it("replays the rawKeyDown Escape, the way Chromium sends a key that types nothing", () => {
    expect(escapeToReplay(key({ type: "rawKeyDown" }))).toEqual({ type: "keyDown", keyCode: "Escape" });
  });

  it("leaves every other key to the page", () => {
    expect(escapeToReplay(key({ key: "a" }))).toBeNull();
    expect(escapeToReplay(key({ key: "Enter" }))).toBeNull();
    expect(escapeToReplay(key({ key: "ArrowDown" }))).toBeNull();
  });

  it("ignores a key-up", () => {
    expect(escapeToReplay(key({ type: "keyUp" }))).toBeNull();
  });

  it("leaves Escape in the pane while a video is fullscreen", () => {
    expect(escapeToReplay(key(), { fullscreen: true })).toBeNull();
    expect(escapeToReplay(key({ type: "rawKeyDown" }), { fullscreen: true })).toBeNull();
  });

  it("leaves a modified Escape alone, so the page's own shortcuts still work", () => {
    expect(escapeToReplay(key({ shift: true }))).toBeNull();
    expect(escapeToReplay(key({ control: true }))).toBeNull();
    expect(escapeToReplay(key({ alt: true }))).toBeNull();
    expect(escapeToReplay(key({ meta: true }))).toBeNull();
  });
});

describe("replayEscapeToBoard", () => {
  function wire(board: unknown) {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    replayEscapeToBoard({ on: (event: string, fn: (...args: unknown[]) => void) => handlers.set(event, fn) }, () => board);
    return (event: string, ...args: unknown[]) => handlers.get(event)?.(...args);
  }

  it("focuses the board and replays Escape there", () => {
    const board = { focus: vi.fn(), sendInputEvent: vi.fn() };
    wire(board)("before-input-event", {}, { type: "keyDown", key: "Escape" });
    expect(board.focus).toHaveBeenCalled();
    expect(board.sendInputEvent).toHaveBeenCalledWith({ type: "keyDown", keyCode: "Escape" });
    expect(board.sendInputEvent).toHaveBeenCalledWith({ type: "keyUp", keyCode: "Escape" });
  });

  it("leaves Escape to a fullscreen video, other keys alone, and does nothing with no board", () => {
    const board = { focus: vi.fn(), sendInputEvent: vi.fn() };
    const on = wire(board);
    on("before-input-event", {}, { type: "keyDown", key: "a" });
    on("enter-html-full-screen");
    on("before-input-event", {}, { type: "keyDown", key: "Escape" });
    expect(board.sendInputEvent).not.toHaveBeenCalled();
    on("leave-html-full-screen");
    on("before-input-event", {}, { type: "keyDown", key: "Escape" });
    expect(board.sendInputEvent).toHaveBeenCalled();
    expect(() => wire(undefined)("before-input-event", {}, { type: "keyDown", key: "Escape" })).not.toThrow();
  });
});
