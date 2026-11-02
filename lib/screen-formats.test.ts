import { describe, expect, it } from "vitest";
import { agreedType, BOARD_FORMATS } from "./screen-formats";

describe("agreedType", () => {
  it("is JPEG until a board says it takes WebP, and while any board there doesn't", () => {
    expect(agreedType({})).toBe("jpeg");
    expect(agreedType({ a: [{ formats: BOARD_FORMATS }] })).toBe("webp");
    expect(agreedType({ a: [{ formats: BOARD_FORMATS }], b: [{ formats: ["jpeg"] }] })).toBe("jpeg");
    expect(agreedType({ a: [{ formats: BOARD_FORMATS }, null] })).toBe("jpeg");
    expect(agreedType({ a: [{ formats: "webp" }] })).toBe("jpeg");
  });
});
