import { describe, expect, it } from "vitest";
import { frameSrc, gesture } from "./use-screen-stream";

const at = (px: number, py: number) => ({ x: px / 100, y: py / 100, px, py });

describe("frameSrc", () => {
  it("reads a frame and ignores anything else", () => {
    expect(frameSrc({ jpg: "abc" })).toBe("data:image/jpeg;base64,abc");
    expect(frameSrc({ jpg: 1 })).toBeNull();
    expect(frameSrc(null)).toBeNull();
  });
});

describe("gesture", () => {
  it("is a tap under the slop and a clamped swipe past it", () => {
    expect(gesture("d", at(10, 10), at(12, 12), 90)).toEqual({ kind: "tap", device: "d", x: 0.1, y: 0.1 });
    expect(gesture("d", at(10, 10), at(10, 60), 20)).toMatchObject({ kind: "swipe", y2: 0.6, ms: 100 });
    expect(gesture("d", at(10, 10), at(10, 60), 9_000)).toMatchObject({ ms: 1500 });
  });
});
