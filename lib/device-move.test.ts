import { describe, expect, it } from "vitest";
import type { DeviceView } from "./device-registry";
import { movedNote, moveTargets, offersMove, threadsText } from "./device-move";

const base: DeviceView = {
  id: "old", kind: "worker", name: "m1mini", platform: "darwin", orgId: "o", host: "worker:old", hasBoxKey: true, hasSignKey: true, hasPasskey: false,
  approves: false, fingerprint: null, status: "offline", lastSeenAt: null, revokedAt: null, note: null, build: null, here: false, threads: 38,
};
const dev = (over: Partial<DeviceView>): DeviceView => ({ ...base, ...over });
const live = dev({ id: "new", status: "online", threads: 0 });

describe("moveTargets", () => {
  it("is your other live workers in the same workspace", () => {
    const list = [base, live, dev({ id: "gone", revokedAt: "x" }), dev({ id: "elsewhere", orgId: "o2" }), dev({ id: "mac", kind: "mac" })];
    expect(moveTargets(base, list).map((d) => d.id)).toEqual(["new"]);
  });
});

describe("offersMove", () => {
  it("offers it for a revoked or offline worker that owns threads, with somewhere to go", () => {
    expect(offersMove(base, [base, live])).toBe(true);
    expect(offersMove(dev({ revokedAt: "x", status: "online" }), [base, live])).toBe(true);
    expect(offersMove(dev({ status: null }), [base, live])).toBe(true);
  });

  it("doesn't for a running worker, one with no threads, no target, or another kind", () => {
    expect(offersMove(dev({ status: "online" }), [live])).toBe(false);
    expect(offersMove(dev({ status: "busy" }), [live])).toBe(false);
    expect(offersMove(dev({ threads: 0 }), [live])).toBe(false);
    expect(offersMove(base, [base])).toBe(false);
    expect(offersMove(dev({ kind: "mac" }), [live])).toBe(false);
  });
});

describe("words", () => {
  it("counts threads and says what moved", () => {
    expect(threadsText(1)).toBe("1 thread");
    expect(threadsText(38)).toBe("38 threads");
    expect(movedNote("m1mini (old)", "m1mini", 38)).toBe("Moved 38 threads from m1mini (old) to m1mini.");
    expect(movedNote("m1mini", "box", 0)).toBe("m1mini had no threads to move.");
  });
});
