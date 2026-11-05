// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { outcomeText, pairingBridge } from "./use-pairing";

describe("outcomeText", () => {
  it("says how a code ended", () => {
    expect(outcomeText({ status: "paired", device: { id: "d", name: "Pixel", kind: "phone", platform: "android", fingerprint: "f", pairedAt: "t" } })).toBe("Paired Pixel.");
    expect(outcomeText({ status: "paired" })).toBe("Paired the device.");
    expect(outcomeText({ status: "expired" })).toMatch(/expired/);
    expect(outcomeText({ status: "failed", error: "bad proof" })).toBe("Not paired: bad proof");
    expect(outcomeText({ status: "failed" })).toMatch(/didn't check out/);
    expect(outcomeText({ status: "cancelled" })).toBe("Not paired.");
  });
  it("finds no bridge outside the desktop app", () => {
    expect(pairingBridge()).toBeUndefined();
  });
});
