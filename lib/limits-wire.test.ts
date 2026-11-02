import { describe, expect, it } from "vitest";
import type { LimitSample } from "./limit-chart";
import { latestReading, MAX_PACKED, packLimits, unpackLimits } from "./limits-wire";

const samples: LimitSample[] = [
  { at: 60_000, backend: "claude", kind: "five_hour", used: 10, resetsAt: 1_800_000_000 },
  { at: 120_000, backend: "puku", kind: "seven_day", used: 40 },
  { at: 180_000, backend: "claude", kind: "five_hour", used: 25, resetsAt: 1_800_000_060 },
];

describe("the limits wire", () => {
  it("packs samples small and reads them back as they were", () => {
    const packed = packLimits(samples);
    expect(packed.s[1]).toEqual([2, "puku", 7, 40, 0]);
    expect(unpackLimits(packed)).toEqual(samples);
  });

  it("keeps the newest when there are too many", () => {
    const many = Array.from({ length: MAX_PACKED + 5 }, (_, i): LimitSample => ({ at: i * 60_000, backend: "claude", kind: "five_hour", used: i % 100 }));
    const packed = packLimits(many);
    expect(packed.s).toHaveLength(MAX_PACKED);
    expect(packed.s[0]?.[0]).toBe(5);
    expect(packLimits(samples, 1).s).toHaveLength(1);
  });

  it("skips what isn't a sample, and reads anything else as none", () => {
    expect(unpackLimits({ v: 1, s: [[1, "bash", 5, 1, 0], [1, "claude", 6, 1, 0], [1, "claude", 5], "x", [3, "codex", 5, 9, 0], [2, "goose", 7, 1, 0]] })).toEqual([
      { at: 120_000, backend: "goose", kind: "seven_day", used: 1 },
      { at: 180_000, backend: "codex", kind: "five_hour", used: 9 },
    ]);
    expect(unpackLimits(null)).toEqual([]);
    expect(unpackLimits({ s: "x" })).toEqual([]);
  });

  it("reads the newest of each window", () => {
    expect(latestReading(samples)).toEqual({ fiveHour: { used: 25, resetsAt: 1_800_000_060 }, sevenDay: { used: 40 } });
    expect(latestReading([])).toEqual({});
  });
});
