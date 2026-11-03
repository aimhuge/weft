import { describe, expect, it, vi } from "vitest";
import { accessUnits, FLUSH_MS } from "./h264-units";

// A fake screenrecord stream: SPS, PPS, an IDR, then P frames, some of two slices.
const nal = (...bytes: number[]) => Buffer.from([0, 0, 0, 1, ...bytes]);
const SPS = nal(0x67, 0x64, 0x00, 0x1f);
const PPS = nal(0x68, 0xee);
const IDR = nal(0x65, 0x88, 0x11);
const P1 = nal(0x41, 0x9a, 0x22);
// A second slice of the same frame: first_mb_in_slice isn't 0, so its first bit is 0.
const P1b = nal(0x41, 0x40, 0x33);
const P2 = nal(0x41, 0x9a, 0x44);
const AUD = nal(0x09, 0xf0);

function fakeTimers() {
  let pending: { fn: () => void; ms: number } | null = null;
  return {
    timers: { set: (fn: () => void, ms: number) => (pending = { fn, ms }), clear: () => (pending = null) },
    fire: () => {
      const p = pending;
      pending = null;
      expect(p?.ms).toBe(FLUSH_MS);
      p?.fn();
    },
    get pending() {
      return pending;
    },
  };
}

function rig() {
  const units: Buffer[] = [];
  const t = fakeTimers();
  return { units, t, a: accessUnits((u) => units.push(u), t.timers) };
}

describe("accessUnits", () => {
  it("cuts a stream into frames at each new frame's first NAL, and the last on a lull", () => {
    const r = rig();
    r.a.push(Buffer.concat([SPS, PPS, IDR, P1, P1b, AUD, P2]));
    expect(r.units).toEqual([Buffer.concat([SPS, PPS, IDR]), Buffer.concat([P1, P1b])]);
    r.t.fire();
    expect(r.units[2]).toEqual(Buffer.concat([AUD, P2]));
    expect(r.units).toHaveLength(3);
  });

  it("puts back together a NAL and a start code a pipe split across chunks", () => {
    const r = rig();
    const all = Buffer.concat([SPS, PPS, IDR, P1]);
    for (let i = 0; i < all.length; i += 3) r.a.push(all.subarray(i, i + 3));
    r.a.end();
    expect(r.units).toEqual([Buffer.concat([SPS, PPS, IDR]), P1]);
  });

  it("gives a later IDR the last SPS and PPS when it comes without them", () => {
    const r = rig();
    r.a.push(Buffer.concat([SPS, PPS, IDR, P1, IDR]));
    r.a.end();
    expect(r.units[2]).toEqual(Buffer.concat([SPS, PPS, IDR]));
  });

  it("drops bytes before any start code, and sends no frame without a slice", () => {
    const r = rig();
    r.a.push(Buffer.from([7, 7, 7]));
    r.a.push(Buffer.concat([SPS, PPS]));
    r.t.fire();
    expect(r.units).toEqual([]);
    r.a.push(Buffer.concat([IDR, nal()]));
    r.a.end();
    expect(r.units).toEqual([Buffer.concat([SPS, PPS, IDR])]);
  });

  it("takes a 3-byte start code, and trims the zeros a 4-byte one leaves behind", () => {
    const r = rig();
    r.a.push(Buffer.from([0, 0, 1, 0x65, 0x88, 0, 0, 0, 1, 0x41, 0x9a]));
    r.a.end();
    expect(r.units).toEqual([Buffer.from([0, 0, 0, 1, 0x65, 0x88]), Buffer.from([0, 0, 0, 1, 0x41, 0x9a])]);
    // A slice with no header past its type reads as another slice of the same frame.
    const s = rig();
    s.a.push(Buffer.concat([IDR, nal(0x41)]));
    s.a.end();
    expect(s.units).toEqual([Buffer.concat([IDR, nal(0x41)])]);
  });

  it("sends nothing after stop or end, and a lull with nothing held sends nothing", () => {
    const r = rig();
    r.a.push(IDR);
    r.a.stop();
    expect(r.t.pending).toBeNull();
    r.a.push(P1);
    r.a.end();
    expect(r.units).toEqual([]);
    const s = rig();
    s.a.push(Buffer.from([1]));
    s.t.fire();
    s.a.push(IDR);
    s.a.end();
    s.a.end();
    s.a.push(P1);
    expect(s.units).toEqual([IDR]);
  });
});

describe("accessUnits on the real clock", () => {
  it("ends a frame after a lull by default", () => {
    vi.useFakeTimers();
    const units: Buffer[] = [];
    const a = accessUnits((u) => units.push(u));
    a.push(IDR);
    a.push(P1);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(units).toEqual([IDR, P1]);
    a.push(P2);
    a.stop();
    vi.advanceTimersByTime(FLUSH_MS);
    expect(units).toHaveLength(2);
    vi.useRealTimers();
  });
});
