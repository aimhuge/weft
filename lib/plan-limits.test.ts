import { describe, expect, it } from "vitest";
import { liveWindow, planLimits } from "./plan-limits";

describe("planLimits", () => {
  it("is empty with no readings", () => {
    expect(planLimits([])).toEqual({});
  });

  it("keeps the pool's newest reading of each window, whatever order they come in", () => {
    const plans = planLimits([
      { at: 30, backend: "claude", kind: "five_hour", used: 40, resetsAt: 900 },
      { at: 10, backend: "claude", kind: "five_hour", used: 10, resetsAt: 900 },
      { at: 20, backend: "claude", kind: "seven_day", used: 15, resetsAt: 5000 },
      { at: 25, backend: "puku", kind: "five_hour", used: 70 },
    ]);
    expect(plans).toEqual({
      claude: { reportedAt: 30, fiveHour: { used: 40, resetsAt: 900 }, fiveHourAt: 30, sevenDay: { used: 15, resetsAt: 5000 }, sevenDayAt: 20 },
      // puku read the pool's 5-hour window earlier (70), but Claude Code read it later (40): the pool's
      // newest reading wins, and it is the same counter either way.
      puku: { reportedAt: 25, fiveHour: { used: 40, resetsAt: 900 }, fiveHourAt: 30, sevenDay: { used: 15, resetsAt: 5000 }, sevenDayAt: 20 },
    });
  });

  it("gives each CLI the account's one pool, not a slice of its own", () => {
    // Claude Code's 5-hour window is spent; puku read the same window earlier, with room left.
    const plans = planLimits([
      { at: 10, backend: "puku", kind: "five_hour", used: 20, resetsAt: 900 },
      { at: 30, backend: "claude", kind: "five_hour", used: 100, resetsAt: 800 },
    ]);
    expect(plans.puku?.fiveHour).toEqual({ used: 100, resetsAt: 800 });
    expect(plans.puku?.fiveHourAt).toBe(30);
    expect(plans.claude?.fiveHour).toEqual({ used: 100, resetsAt: 800 });
    expect(plans.puku?.reportedAt).toBe(10);
  });

  it("gives a CLI that stopped reporting the pool's newer reading, not its own stale one", () => {
    const plans = planLimits([
      { at: 10, backend: "puku", kind: "five_hour", used: 60, resetsAt: 900 },
      { at: 30, backend: "claude", kind: "five_hour", used: 70, resetsAt: 900 },
    ]);
    expect(plans.puku?.fiveHour).toEqual({ used: 70, resetsAt: 900 });
    expect(plans.puku?.fiveHourAt).toBe(30);
  });

  it("gives each CLI its own copy of the pool's window", () => {
    const plans = planLimits([
      { at: 10, backend: "claude", kind: "five_hour", used: 40 },
      { at: 20, backend: "puku", kind: "five_hour", used: 40 },
    ]);
    expect(plans.puku?.fiveHour).not.toBe(plans.claude?.fiveHour);
    plans.puku!.fiveHour = { used: 1 };
    expect(plans.claude?.fiveHour).toEqual({ used: 40 });
  });

  it("keeps a CLI on another plan's numbers out of the pool", () => {
    const plans = planLimits([
      { at: 10, backend: "claude", kind: "five_hour", used: 40, resetsAt: 900 },
      { at: 20, backend: "codex", kind: "five_hour", used: 80, resetsAt: 900 },
    ]);
    expect(plans.claude?.fiveHour).toEqual({ used: 40, resetsAt: 900 });
    expect(plans.codex?.fiveHour).toEqual({ used: 80, resetsAt: 900 });
  });

  it("gives a CLI with only one window no entry for the other", () => {
    const plans = planLimits([{ at: 30, backend: "puku", kind: "seven_day", used: 9 }]);
    expect(plans.puku).toEqual({ reportedAt: 30, sevenDay: { used: 9 }, sevenDayAt: 30 });
  });

  it("leaves a CLI that never reported out of the strip", () => {
    const plans = planLimits([{ at: 30, backend: "claude", kind: "five_hour", used: 40, resetsAt: 900 }]);
    expect(Object.keys(plans)).toEqual(["claude"]);
  });
});

describe("liveWindow", () => {
  it("passes no window through", () => {
    expect(liveWindow(undefined, 1)).toBeUndefined();
  });

  it("keeps a window whose reset is still ahead, or unknown", () => {
    expect(liveWindow({ used: 80, resetsAt: 2000 }, 1_000_000)).toEqual({ used: 80, resetsAt: 2000 });
    expect(liveWindow({ used: 80 }, 1_000_000)).toEqual({ used: 80 });
  });

  it("reads a window whose reset has passed as full again", () => {
    expect(liveWindow({ used: 100, resetsAt: 1000 }, 1_000_000)).toEqual({ used: 0 });
  });

  it("leaves the window alone before the clock starts (prerender reads 0)", () => {
    expect(liveWindow({ used: 100, resetsAt: 1000 }, 0)).toEqual({ used: 100, resetsAt: 1000 });
  });
});
