import { describe, expect, it } from "vitest";
import { keyEvents, NAMED } from "./pane-keys.cjs";

type KeyEvent = {
  type: string;
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
  unmodifiedText?: string;
  commands?: string[];
};

const events = (combo: string) => keyEvents(combo) as KeyEvent[];
const down = (combo: string) => events(combo)[0]!;
const up = (combo: string) => events(combo)[1]!;

describe("keyEvents", () => {
  it("sends Enter as a keyDown that types a carriage return", () => {
    expect(down("Enter")).toEqual({
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      modifiers: 0,
      text: "\r",
      unmodifiedText: "\r",
    });
    expect(up("Enter")).toEqual({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0 });
  });

  it("sends Tab as a rawKeyDown with no text, so it moves focus instead of typing", () => {
    const d = down("Tab");
    expect(d.type).toBe("rawKeyDown");
    expect(d.text).toBeUndefined();
    expect(d.unmodifiedText).toBeUndefined();
    expect(d.key).toBe("Tab");
    expect(d.code).toBe("Tab");
    expect(d.windowsVirtualKeyCode).toBe(9);
    expect(up("Tab")).toEqual({ type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 0 });
  });

  it("sends Shift+Tab with the shift bit and no text", () => {
    const d = down("Shift+Tab");
    expect(d.modifiers).toBe(8);
    expect(d.type).toBe("rawKeyDown");
    expect(d.text).toBeUndefined();
    expect(d.key).toBe("Tab");
    expect(up("Shift+Tab").modifiers).toBe(8);
  });

  it("sends Meta+a as a command, not a keystroke", () => {
    const d = down("Meta+a");
    expect(d.modifiers).toBe(4);
    expect(d.commands).toEqual(["selectAll"]);
    expect(d.text).toBeUndefined();
    expect(d.type).toBe("rawKeyDown");
    expect(d.key).toBe("a");
    expect(d.code).toBe("KeyA");
    expect(d.windowsVirtualKeyCode).toBe(65);
    expect(up("Meta+a").type).toBe("keyUp");
    expect(up("Meta+a").commands).toBeUndefined();
  });

  it("sends Shift+a as an uppercase A", () => {
    const d = down("Shift+a");
    expect(d.modifiers).toBe(8);
    expect(d.key).toBe("A");
    expect(d.code).toBe("KeyA");
    expect(d.text).toBe("A");
    expect(d.unmodifiedText).toBe("A");
    expect(d.type).toBe("keyDown");
    expect(up("Shift+a").key).toBe("A");
  });

  it("gives a digit its own code", () => {
    const d = down("1");
    expect(d.code).toBe("Digit1");
    expect(d.key).toBe("1");
    expect(d.windowsVirtualKeyCode).toBe(49);
    expect(d.text).toBe("1");
  });

  it("knows the arrow aliases", () => {
    expect(down("Up")).toMatchObject({ key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
    expect(down("Down")).toMatchObject({ key: "ArrowDown", windowsVirtualKeyCode: 40 });
    expect(down("Left")).toMatchObject({ key: "ArrowLeft", windowsVirtualKeyCode: 37 });
    expect(down("Right")).toMatchObject({ key: "ArrowRight", windowsVirtualKeyCode: 39 });
  });

  it("knows the Escape, Return and Delete aliases", () => {
    expect(down("Esc")).toMatchObject({ key: "Escape", windowsVirtualKeyCode: 27 });
    expect(down("Return")).toMatchObject({ key: "Enter", windowsVirtualKeyCode: 13 });
    expect(down("Del")).toMatchObject({ key: "Delete", windowsVirtualKeyCode: 46 });
  });

  it("sends a function key", () => {
    const d = down("F5");
    expect(d.key).toBe("F5");
    expect(d.code).toBe("F5");
    expect(d.windowsVirtualKeyCode).toBe(116);
    expect(d.text).toBeUndefined();
    expect(d.type).toBe("rawKeyDown");
  });

  it("sends a lone plus as the plus key", () => {
    const d = down("+");
    expect(d.key).toBe("+");
    expect(d.code).toBe("+");
    expect(d.windowsVirtualKeyCode).toBe(0);
    expect(d.text).toBe("+");
    expect(d.type).toBe("keyDown");
    expect(up("+").key).toBe("+");
  });

  it("sends Shift++ as the plus key with the shift bit", () => {
    const d = down("Shift++");
    expect(d.modifiers).toBe(8);
    expect(d.key).toBe("+");
    expect(d.code).toBe("+");
    expect(d.text).toBe("+");
    expect(up("Shift++").modifiers).toBe(8);
  });

  it("treats a trailing plus as the space bar", () => {
    const d = down("Shift+");
    expect(d.modifiers).toBe(8);
    expect(d.key).toBe(" ");
    expect(d.code).toBe("Space");
    expect(d.text).toBe(" ");
  });

  it("says what a modifier should be", () => {
    expect(() => keyEvents("Foo+Tab")).toThrow("Foo isn't a modifier; use Shift, Control, Alt or Meta.");
  });

  it("says what a key should be", () => {
    expect(() => keyEvents("Frobnicate")).toThrow(
      /Frobnicate isn't a key I know; use a single character or one of Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Insert\./,
    );
  });

  it("wants a key at all", () => {
    expect(() => keyEvents("")).toThrow('Give a key, like "Enter", "Shift+Tab" or "Meta+a".');
    expect(() => keyEvents("   ")).toThrow('Give a key, like "Enter", "Shift+Tab" or "Meta+a".');
    expect(() => keyEvents(undefined)).toThrow('Give a key, like "Enter", "Shift+Tab" or "Meta+a".');
  });

  it("sends Space as a space", () => {
    const d = down("Space");
    expect(d.type).toBe("keyDown");
    expect(d.key).toBe(" ");
    expect(d.code).toBe("Space");
    expect(d.windowsVirtualKeyCode).toBe(32);
    expect(d.text).toBe(" ");
    expect(up("Space").key).toBe(" ");
  });

  it("accepts the other modifier spellings", () => {
    expect(down("Alt+a").modifiers).toBe(1);
    expect(down("Option+a").modifiers).toBe(1);
    expect(down("Control+a").modifiers).toBe(2);
    expect(down("Ctrl+a").modifiers).toBe(2);
    expect(down("Cmd+a").modifiers).toBe(4);
    expect(down("Command+a").modifiers).toBe(4);
  });

  it("gives a chord no text, so the page's editing shortcut can't double-fire", () => {
    const d = down("Control+a");
    expect(d.text).toBeUndefined();
    expect(d.type).toBe("rawKeyDown");
    expect(d.commands).toBeUndefined();
  });

  it("combines modifiers", () => {
    const d = down("Shift+Control+a");
    expect(d.modifiers).toBe(10);
    expect(d.text).toBeUndefined();
  });

  it("knows every named key it lists", () => {
    for (const [name, [code]] of Object.entries(NAMED)) {
      const d = down(name);
      expect(d.key).toBe(name === "Space" ? " " : name);
      expect(d.windowsVirtualKeyCode).toBe(code);
    }
  });
});
