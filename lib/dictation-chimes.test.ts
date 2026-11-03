import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHIME_NOTES, playDictationChime, resetDictationChimes } from "./dictation-chimes";

function param() {
  return { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

function fakeContext(state: AudioContextState = "running") {
  const oscillators: { type: string; frequency: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const gains: { gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 2,
    destination: { name: "speakers" },
    state,
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => {
      const osc = { type: "", frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const gain = { gain: param(), connect: vi.fn() };
      gains.push(gain);
      return gain;
    }),
  };
  const make = vi.fn(() => ctx as unknown as AudioContext);
  return { ctx, make, oscillators, gains };
}

function frequencies(oscillators: ReturnType<typeof fakeContext>["oscillators"]) {
  return oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0] as [number, number]);
}

beforeEach(() => {
  resetDictationChimes();
});

describe("playDictationChime", () => {
  it("rises to start: each note a sine with its octave", () => {
    const { make, oscillators } = fakeContext();
    playDictationChime("start", make);
    const [low, high] = CHIME_NOTES.start;
    expect(low).toBeLessThan(high);
    expect(oscillators).toHaveLength(4);
    expect(oscillators.every((o) => o.type === "sine")).toBe(true);
    expect(frequencies(oscillators)).toEqual([
      [low, 2],
      [low * 2, 2],
      [high, 2.085],
      [high * 2, 2.085],
    ]);
  });

  it("falls to stop", () => {
    const { make, oscillators } = fakeContext();
    playDictationChime("stop", make);
    const [high, low] = CHIME_NOTES.stop;
    expect(high).toBeGreaterThan(low);
    expect(frequencies(oscillators).map(([f]) => f)).toEqual([high, high * 2, low, low * 2]);
  });

  it("fades each note in and out and wires it to the speakers", () => {
    const { ctx, make, oscillators, gains } = fakeContext();
    playDictationChime("start", make);
    // Per note: the envelope gain, then the octave's quiet gain.
    expect(gains).toHaveLength(4);
    const [envelope, quiet] = gains as [(typeof gains)[number], (typeof gains)[number]];
    expect(envelope.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 2);
    expect(envelope.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.16, 2.005);
    expect(envelope.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 2.22);
    expect(envelope.connect).toHaveBeenCalledWith(ctx.destination);
    expect(quiet.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 2);
    expect(quiet.connect).toHaveBeenCalledWith(envelope);
    expect(oscillators[0]!.connect).toHaveBeenCalledWith(envelope);
    expect(oscillators[1]!.connect).toHaveBeenCalledWith(quiet);
    expect(oscillators[0]!.start).toHaveBeenCalledWith(2);
    expect(oscillators[0]!.stop.mock.calls[0]![0]).toBeCloseTo(2.24);
  });

  it("makes the audio context once and reuses it", () => {
    const { make } = fakeContext();
    playDictationChime("start", make);
    playDictationChime("stop", make);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("makes a new context after a reset", () => {
    const { make } = fakeContext();
    playDictationChime("start", make);
    resetDictationChimes();
    playDictationChime("start", make);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("resumes a suspended context", () => {
    const { ctx, make } = fakeContext("suspended");
    playDictationChime("start", make);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("leaves a running context alone", () => {
    const { ctx, make } = fakeContext();
    playDictationChime("start", make);
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("stays silent when there's no audio", () => {
    const make = vi.fn(() => {
      throw new Error("no audio device");
    });
    expect(() => playDictationChime("start", make)).not.toThrow();
  });

  it("uses a real AudioContext by default", () => {
    const { ctx } = fakeContext();
    const Ctor = vi.fn(function () {
      return ctx;
    });
    vi.stubGlobal("AudioContext", Ctor);
    playDictationChime("start");
    expect(Ctor).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
