import { describe, expect, it } from "vitest";
import { GRACE_MS, IDLE_MS, plan, track } from "./dev-idle";

describe("track", () => {
  it("starts a new server's clock now and moves an active one's", () => {
    const { activeAt, idle } = track(new Map([["a", 0]]), [{ key: "a", active: true }, { key: "b", active: false }], 1000);
    expect(activeAt).toEqual(new Map([["a", 1000], ["b", 1000]]));
    expect(idle).toEqual([]);
  });

  it("calls a server idle after IDLE_MS without activity, and drops ones no longer watched", () => {
    const { activeAt, idle } = track(new Map([["a", 0], ["gone", 0]]), [{ key: "a", active: false }], IDLE_MS);
    expect(idle).toEqual(["a"]);
    expect(activeAt.has("gone")).toBe(false);
    expect(track(new Map([["a", 1]]), [{ key: "a", active: false }], IDLE_MS).idle).toEqual([]);
  });
});

describe("plan", () => {
  it("announces a newly idle server, then stops it once the grace runs out", () => {
    const first = plan(["u"], new Map(), new Set(), 0);
    expect(first).toEqual({ pending: new Map([["u", { stopAt: GRACE_MS }]]), stop: [] });
    expect(plan(["u"], first.pending, new Set(), GRACE_MS - 1).stop).toEqual([]);
    expect(plan(["u"], first.pending, new Set(), GRACE_MS)).toEqual({ pending: new Map(), stop: ["u"] });
  });

  it("skips a kept server and drops the pending stop of one that's active again", () => {
    expect(plan(["u"], new Map(), new Set(["u"]), 0)).toEqual({ pending: new Map(), stop: [] });
    expect(plan([], new Map([["u", { stopAt: 5 }]]), new Set(), 10)).toEqual({ pending: new Map(), stop: [] });
  });
});
