import { describe, expect, it } from "vitest";
import { gestureLines, keyLines, textLines, wmSize } from "./adb-input";
import { hidUsage } from "./hid-keys";

describe("textLines", () => {
  it("types printable ASCII as quoted input text, with input's own space and % escapes", () => {
    expect(textLines("it's 100% ok")).toEqual(["input text 'it'\\''s%s100\\%%sok'"]);
    expect(textLines("$(rm -rf /);`x`")).toEqual(["input text '$(rm%s-rf%s/);`x`'"]);
  });

  it("sends newlines and tabs as keys, drops what isn't ASCII, and cuts long lines", () => {
    expect(textLines("a\r\nb\tc✓")).toEqual(["input text 'a'", "input keyevent 66", "input text 'b'", "input keyevent 61", "input text 'c'"]);
    expect(textLines("x".repeat(450)).map((l) => l.length)).toEqual([213, 213, 63]);
    expect(textLines("✓")).toEqual([]);
  });
});

describe("keyLines", () => {
  it("holds Shift, types what a key types and presses the rest by key code, on the way down only", () => {
    const key = keyLines();
    const u = (code: string) => hidUsage(code) as number;
    expect(key(u("KeyA"), true)).toEqual(["input text 'a'"]);
    expect(key(u("KeyA"), false)).toEqual([]);
    expect(key(u("ShiftLeft"), true)).toEqual([]);
    expect(key(u("Digit1"), true)).toEqual(["input text '!'"]);
    expect(key(u("ShiftRight"), false)).toEqual([]);
    expect(key(u("Space"), true)).toEqual(["input text '%s'"]);
    expect(key(u("Enter"), true)).toEqual(["input keyevent 66"]);
    expect(key(u("ArrowUp"), true)).toEqual(["input keyevent 19"]);
    expect(key(u("Backspace"), true)).toEqual(["input keyevent 67"]);
    expect(key(200, true)).toEqual([]);
  });
});

describe("gestureLines", () => {
  it("makes a quick still press a tap, and anything else a swipe over the time it took", () => {
    let t = 0;
    const g = gestureLines({ width: 1000, height: 2000 }, () => t);
    expect(g("down", 100.4, 200.6)).toEqual([]);
    expect(g("move", 105, 205)).toEqual([]);
    t = 100;
    expect(g("up", 104, 210)).toEqual(["input tap 100 201"]);
    g("down", 100, 200);
    t = 400;
    expect(g("up", 100, 1200)).toEqual(["input swipe 100 200 100 1200 300"]);
    g("down", 10, 10);
    t = 1_400;
    expect(g("up", 10, 10)).toEqual(["input swipe 10 10 10 10 1000"]);
    g("down", 10, 10);
    expect(g("up", 500, 10)).toEqual(["input swipe 10 10 500 10 50"]);
    g("down", 10, 10);
    t = 99_000;
    expect(g("up", 10, 10)).toEqual(["input swipe 10 10 10 10 5000"]);
    expect(g("up", 1, 1)).toEqual([]);
  });

  it("reads the clock by default", () => {
    const g = gestureLines({ width: 100, height: 100 });
    g("down", 5, 5);
    expect(g("up", 5, 5)).toEqual(["input tap 5 5"]);
  });
});

describe("wmSize", () => {
  it("takes the override size over the physical one", () => {
    expect(wmSize("Physical size: 1080x2400\n")).toEqual({ width: 1080, height: 2400 });
    expect(wmSize("Physical size: 1080x2400\nOverride size: 720x1600\n")).toEqual({ width: 720, height: 1600 });
    expect(() => wmSize("error: no devices")).toThrow(/screen's size/);
  });
});
