import { describe, expect, it } from "vitest";
import { liveWindow, planLimits } from "./plan-limits";

describe("planLimits", () => {
  it("is empty with no readings", () => {
    expect(planLimits([])).toEqual({});
  });

  it("keeps each CLI's entry, but the account's one pool supplies the numbers", () => {
    // The plan limits are one pool per account: puku's reading and Claude Code's are the same
    // counter, so the newest of them is the account's value and every CLI's entry carries it.
    // The newest five_hour here is Claude Code's at 30 (used 40), not puku's earlier one.
    const plans = planLimits([
      { at: 30, backend: "claude", kind: "five_hour", used: 40, resetsAt: 900 },
      { at: 10, backend: "claude", kind: "five_hour", used: 10, resetsAt: 900 },
      { at: 20, backend: "claude", kind: "seven_day", used: 15, resetsAt: 5000 },
      { at: 25, backend: "puku", kind: "five_hour", used: 70 },
    ]);
    expect(plans).toEqual({
      claude: {
        reportedAt: 30,
        fiveHour: { used: 40, resetsAt: 900 },
        fiveHourAt: 30,
        sevenDay: { used: 15, resetsAt: 5000 },
        sevenDayAt: 20,
      },
      puku: {
        reportedAt: 25,
        fiveHour: { used: 40, resetsAt: 900 },
        fiveHourAt: 30,
        sevenDay: { used: 15, resetsAt: 5000 },
        sevenDayAt: 20,
      },
    });
  });

  it("gives a CLI that stopped reporting the pool's newer reading, not its own stale one", () => {
    // puku reported at 10; the pool moved on and Claude Code reported at 30. A card on puku shows 30.
    const plans = planLimits([
      { at: 10, backend: "puku", kind: "five_hour", used: 20, resetsAt: 900 },
      { at: 30, backend: "claude", kind: "five_hour", used: 60, resetsAt: 900 },
    ]);
    expect(plans.puku?.fiveHour).toEqual({ used: 60, resetsAt: 900 });
    expect(plans.claude?.fiveHour).toEqual({ used: 60, resetsAt: 900 });
    // The number is the pool's, so the time is the pool's too — not the reporting CLI's last report.
    expect(plans.puku?.fiveHourAt).toBe(30);
    expect(plans.claude?.fiveHourAt).toBe(30);
    expect(plans.puku?.reportedAt).toBe(10);
  });

  it("gives each CLI its own copy of the pool's window", () => {
    // A consumer that changes one CLI's window (to mark it stale, say) must not change the others'.
    const plans = planLimits([
      { at: 10, backend: "puku", kind: "five_hour", used: 20, resetsAt: 900 },
      { at: 30, backend: "claude", kind: "five_hour", used: 60, resetsAt: 900 },
    ]);
    expect(plans.puku?.fiveHour).not.toBe(plans.claude?.fiveHour);
    if (plans.puku?.fiveHour) plans.puku.fiveHour.used = 0;
    expect(plans.claude?.fiveHour).toEqual({ used: 60, resetsAt: 900 });
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
