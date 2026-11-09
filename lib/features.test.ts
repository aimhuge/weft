import { describe, expect, it } from "vitest";
import { copilotEnabled } from "./features";

describe("copilotEnabled", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(copilotEnabled(undefined)).toBe(false);
    expect(copilotEnabled("")).toBe(false);
    expect(copilotEnabled("0")).toBe(false);
    expect(copilotEnabled("true")).toBe(false);
    expect(copilotEnabled("1")).toBe(true);
  });

  it("reads NEXT_PUBLIC_WEFT_COPILOT by default", () => {
    expect(copilotEnabled()).toBe(process.env.NEXT_PUBLIC_WEFT_COPILOT === "1");
  });
});
