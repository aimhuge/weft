// lib/use-devices.ts outside a browser (the server render): no bridges to find. The hook itself is driven through
// components/DevicesSettings.test.tsx.
import { describe, expect, it } from "vitest";
import { bridgesHere, repinOutcome, revokeRoute, sealLine, sealOutcome, workerOutcome } from "./use-devices";

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

describe("use-devices helpers", () => {
  it("routes a pinned phone or browser through main, the rest through the registry", () => {
    const pinned = new Set(["p1", "b1"]);
    expect(revokeRoute({ id: "p1", kind: "phone" }, pinned)).toBe("pairing");
    expect(revokeRoute({ id: "b1", kind: "browser" }, pinned)).toBe("pairing");
    expect(revokeRoute({ id: "p9", kind: "phone" }, pinned)).toBe("registry");
    expect(revokeRoute({ id: "p1", kind: "worker" }, pinned)).toBe("registry");
  });

  it("says how a worker's code ended", () => {
    expect(workerOutcome({ status: "paired" })).toBe("Added the worker.");
    expect(workerOutcome({ status: "expired" })).toMatch(/expired/);
    expect(workerOutcome({ status: "failed", error: "bad proof" })).toBe("Not added: bad proof");
    expect(workerOutcome({ status: "failed" })).toMatch(/didn't check out/);
    expect(workerOutcome({ status: "cancelled" })).toBe("Not added.");
  });

  it("says how a Re-pin went", () => {
    expect(repinOutcome("m1mini", { denied: true })).toBe("Not re-pinned.");
    expect(repinOutcome("m1mini", { forgotten: false })).toBe("m1mini had no pinned keys on this Mac.");
    expect(repinOutcome("m1mini", { forgotten: true, keysError: "offline" })).toBe("Forgot m1mini's pinned keys, but its workspace key grant couldn't be dropped: offline");
  });
});
