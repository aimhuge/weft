import { beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_MS, closeWindow, markKnown, markUnknown, openWindow, resetWriters, unknownWriters, writersAt } from "./bash-writers";

// Whose Bash call was open when a file was written (lib/bash-writers.ts): a window per call, by tool use id,
// from PreToolUse to PostToolUse, held open longer for a call sent to the background. Times are given.

const HOUR = 60 * 60_000;

beforeEach(() => resetWriters());

describe("Bash windows", () => {
  it("names the cards open at a moment, a closed window counting through its last millisecond", () => {
    openWindow("a", "me", 1000);
    openWindow("b", "other", 1500);
    expect(closeWindow("a", false, 2000)).toBe(1000);
    expect([...writersAt(999)]).toEqual([]);
    expect([...writersAt(1200)]).toEqual(["me"]);
    expect([...writersAt(1800)]).toEqual(["me", "other"]);
    expect([...writersAt(2000.6)]).toEqual(["me", "other"]);
    expect([...writersAt(2001)]).toEqual(["other"]);
  });

  it("closes a call once, and not a call it never opened", () => {
    openWindow("a", "me", 1000);
    expect(closeWindow("a", false, 1100)).toBe(1000);
    expect(closeWindow("a", false, 1200)).toBeUndefined();
    expect(closeWindow("never", false, 1200)).toBeUndefined();
  });

  it("keeps a background call open for the background timeout after it returns", () => {
    openWindow("bg", "me", 1000);
    closeWindow("bg", true, 1010);
    expect(writersAt(1010 + BACKGROUND_MS - 1).has("me")).toBe(true);
    expect(writersAt(1010 + BACKGROUND_MS + 1).has("me")).toBe(false);
  });

  it("drops windows past Bash's longest timeout, open or closed, and holds at most 500", () => {
    openWindow("lost", "me", 0);
    openWindow("done", "other", 0);
    closeWindow("done", false, 10);
    openWindow("fresh", "third", 3 * HOUR);
    expect([...writersAt(5)]).toEqual([]);
    for (let i = 0; i < 510; i++) openWindow(`w${i}`, `c${i}`, 3 * HOUR + i);
    expect(writersAt(3 * HOUR + 600).size).toBe(500);
    expect(writersAt(3 * HOUR + 600).has("third")).toBe(false);
  });
});

describe("unknown writers", () => {
  it("marks and forgets files", () => {
    markUnknown("/r/a.ts");
    markUnknown("/r/b.ts");
    markKnown("/r/a.ts");
    expect([...unknownWriters()]).toEqual(["/r/b.ts"]);
  });
});
