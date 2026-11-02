import { describe, expect, it } from "vitest";
import { bitrateControl, feedbackOf, MIN_BITRATE } from "./rtp-bitrate";

describe("feedbackOf", () => {
  const report = { ssrc: 7, packetsLost: 3, highestSequence: 900 };

  it("reads the running totals from a receiver or sender report about this stream", () => {
    expect(feedbackOf({ type: 201, reports: [{ ...report, ssrc: 8 }, report] }, 7)).toEqual({ lost: 3, seq: 900 });
    expect(feedbackOf({ type: 200, reports: [report] }, 7)).toEqual({ lost: 3, seq: 900 });
    expect(feedbackOf({ type: 201, reports: [report] }, 9)).toEqual({});
    expect(feedbackOf({ type: 201 }, 7)).toEqual({});
  });

  it("hears a PLI or a FIR as a call for a key frame, and leaves REMB and the rest", () => {
    expect(feedbackOf({ type: 206, feedback: { count: 1 } }, 7)).toEqual({ keyframe: true });
    expect(feedbackOf({ type: 206, feedback: { count: 4 } }, 7)).toEqual({ keyframe: true });
    expect(feedbackOf({ type: 206, feedback: { count: 15 } }, 7)).toEqual({});
    expect(feedbackOf({ type: 206 }, 7)).toEqual({});
    expect(feedbackOf({ type: 205, feedback: { count: 1 } }, 7)).toEqual({});
  });
});

describe("bitrateControl", () => {
  // A clock the test moves, and a board that reports `lost` of every 100 packets.
  const setup = (ceiling = 8_000_000) => {
    let t = 0;
    const control = bitrateControl(ceiling, () => t);
    let seq = 0;
    let lost = 0;
    const window = (dropped: number, after = 1_000) => {
      t += after;
      seq += 100;
      lost += dropped;
      return control.report({ lost, seq });
    };
    control.report({ lost, seq });
    return { control, window, at: (ms: number) => (t = ms) };
  };

  it("starts at the quality's rate, which a floor never raises", () => {
    expect(bitrateControl(8_000_000).rate).toBe(8_000_000);
    expect(bitrateControl(100_000).rate).toBe(100_000);
  });

  it("ignores reports without totals, a first report, and reports that go nowhere", () => {
    const control = bitrateControl(8_000_000, () => 10_000);
    expect(control.report({ keyframe: true })).toBeNull();
    expect(control.report({ lost: 0, seq: 10 })).toBeNull();
    expect(control.report({ lost: 50, seq: 10 })).toBeNull();
    expect(control.report({ lost: 60, seq: 5 })).toBeNull();
  });

  it("judges loss over a hundred packets, not per report", () => {
    let t = 5_000;
    const c = bitrateControl(8_000_000, () => t);
    c.report({ lost: 0, seq: 0 });
    // Half of ten packets is lost, then the next ninety arrive whole: 5% over the window, nothing changes.
    expect(c.report({ lost: 5, seq: 10 })).toBeNull();
    t = 10_000;
    expect(c.report({ lost: 5, seq: 100 })).toBeNull();
    expect(c.rate).toBe(8_000_000);
  });

  it("counts packets NACK repaired after the report as not lost", () => {
    const { control, window } = setup();
    window(30, 5_000);
    expect(control.rate).toBe(4_800_000);
    // Thirty lost, then twenty-five of them repaired: 5% after repair, so no further cut.
    window(30, 5_000);
    expect(control.rate).toBe(2_880_000);
    expect(window(-25, 5_000)).toBeNull();
    expect(window(5, 5_000)).toBeNull();
  });

  it("steps down on sustained loss, no faster than every four seconds, never under the floor", () => {
    const { control, window } = setup();
    expect(window(20, 1_000)).toBeNull();
    expect(window(20, 3_000)).toBe(4_800_000);
    expect(window(20, 1_000)).toBeNull();
    expect(window(20, 4_000)).toBe(2_880_000);
    for (let i = 0; i < 10; i++) window(20, 4_000);
    expect(control.rate).toBe(MIN_BITRATE);
    expect(window(20, 4_000)).toBeNull();
  });

  it("climbs back once loss stays clear for twelve seconds, up to the ceiling", () => {
    const { control, window } = setup();
    window(20, 4_000);
    window(20, 4_000);
    expect(control.rate).toBe(2_880_000);
    expect(window(0, 6_000)).toBeNull();
    expect(window(0, 6_000)).toBe(4_320_000);
    // Some loss, under the overrun, holds the climb.
    expect(window(5, 6_000)).toBeNull();
    expect(window(0, 6_000)).toBeNull();
    expect(window(0, 6_000)).toBe(6_480_000);
    window(0, 12_000);
    expect(control.rate).toBe(8_000_000);
    expect(window(0, 12_000)).toBeNull();
  });
});
