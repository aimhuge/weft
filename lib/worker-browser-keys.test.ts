import { afterEach, describe, expect, it } from "vitest";
import { keyFor, releaseKeys } from "./worker-browser-keys";

afterEach(releaseKeys);

describe("keyFor", () => {
  it("types a letter, a digit and a named key that types, with its text", () => {
    expect(keyFor(4, true)).toEqual({ type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0, text: "a" });
    expect(keyFor(30, true)).toMatchObject({ key: "1", code: "Digit1", text: "1" });
    expect(keyFor(39, true)).toMatchObject({ key: "0", code: "Digit0", windowsVirtualKeyCode: 48 });
    expect(keyFor(40, true)).toMatchObject({ type: "keyDown", key: "Enter", text: "\r" });
    expect(keyFor(44, true)).toMatchObject({ type: "keyDown", key: " ", text: " " });
  });

  it("sends a key with no text as a raw key, and every release as keyUp", () => {
    expect(keyFor(80, true)).toEqual({ type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, modifiers: 0 });
    expect(keyFor(4, false)).toEqual({ type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0 });
  });

  it("holds Shift and Alt across presses, the way a keyboard does", () => {
    expect(keyFor(225, true)).toBeNull();
    expect(keyFor(4, true)).toMatchObject({ key: "A", text: "A", modifiers: 8 });
    expect(keyFor(31, true)).toMatchObject({ key: "@", modifiers: 8 });
    expect(keyFor(45, true)).toMatchObject({ key: "_", code: "Minus" });
    expect(keyFor(229, false)).toBeNull();
    expect(keyFor(226, true)).toBeNull();
    expect(keyFor(4, true)).toMatchObject({ key: "a", modifiers: 1 });
    expect(keyFor(230, false)).toBeNull();
    expect(keyFor(4, true)).toMatchObject({ modifiers: 0 });
  });

  it("knows nothing of a usage it has no key for", () => {
    expect(keyFor(3, true)).toBeNull();
    expect(keyFor(200, true)).toBeNull();
  });
});
