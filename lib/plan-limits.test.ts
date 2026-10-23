import { describe, expect, it } from "vitest";
import { liveWindow, planLimits } from "./plan-limits";

describe("planLimits", () => {
  it("is empty with no readings", () => {
    expect(planLimits([])).toEqual({});
  });

  it("keeps each CLI's newest reading of each window, whatever order they come in", () => {
    const plans = planLimits([
      { at: 30, backend: "claude", kind: "five_hour", used: 40, resetsAt: 900 },
      { at: 10, backend: "claude", kind: "five_hour", used: 10, resetsAt: 900 },
      { at: 20, backend: "claude", kind: "seven_day", used: 15, resetsAt: 5000 },
      { at: 25, backend: "puku", kind: "five_hour", used: 70 },
    ]);
    expect(plans).toEqual({
      claude: { at: 30, fiveHour: { used: 40, resetsAt: 900 }, sevenDay: { used: 15, resetsAt: 5000 } },
      puku: { at: 25, fiveHour: { used: 70 } },
    });
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
