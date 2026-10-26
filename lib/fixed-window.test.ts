import { describe, expect, it } from "vitest";
import { fixedWindow } from "./fixed-window";

describe("fixedWindow", () => {
  it("counts hits per key inside a window and starts over when it ends", () => {
    const w = fixedWindow(1_000);
    expect(w.hit("a", 0)).toBe(1);
    expect(w.hit("a", 500)).toBe(2);
    expect(w.hit("b", 500)).toBe(1);
    expect(w.retryAfter("a", 500)).toBe(1);
    expect(w.hit("a", 1_000)).toBe(1);
    expect(w.size()).toBe(2);
    w.reset();
    expect(w.size()).toBe(0);
  });

  it("answers retry-after in whole seconds, at least 1", () => {
    const w = fixedWindow(60_000);
    w.hit("k", 0);
    expect(w.retryAfter("k", 0)).toBe(60);
    expect(w.retryAfter("k", 59_999)).toBe(1);
  });

  it("sweeps ended windows once it holds sweepAt keys", () => {
    const w = fixedWindow(1_000, 3);
    w.hit("a", 0);
    w.hit("b", 0);
    w.hit("c", 900);
    w.hit("d", 1_500); // a and b ended; c is still live
    expect(w.size()).toBe(2);
  });
});
