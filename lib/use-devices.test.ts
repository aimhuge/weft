// lib/use-devices.ts outside a browser (the server render): no bridges to find. The hook itself is driven through
// components/DevicesSettings.test.tsx.
import { describe, expect, it } from "vitest";
import { bridgesHere, sealLine, sealOutcome } from "./use-devices";

describe("bridgesHere", () => {
  it("finds none without a window", () => {
    expect(bridgesHere()).toEqual({});
  });
});

describe("a worker's sealing, in words", () => {
  it("says sealed only under the workspace's newest key, and what a Seal… did", () => {
    expect(sealOutcome("m1mini", { denied: true })).toBe("Not sealed: m1mini keeps publishing in the clear.");
    expect(sealOutcome("m1mini", {})).toBe("m1mini now holds key v0: it seals what it publishes from now on.");
    // A grant for an older version only is in the clear: a device revoked since may hold that key.
    expect(sealLine({ sealOn: true, workers: { w1: { version: 2, latest: 3 } } }, "w1")).toEqual({ sealed: false, text: "Threads in the clear" });
    expect(sealLine(null, "w1").sealed).toBe(false);
  });
});
