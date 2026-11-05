// The dictation pill's start and stop sounds: two soft glassy notes, rising to start and falling to stop, made live
// with Web Audio, so there are no files to ship. Each note is a sine with a quiet octave above it, a 5 ms attack and an
// exponential fade, ~0.3 s for the pair.

export type DictationChime = "start" | "stop";

// E5 and A5: a fourth apart, bright without being shrill.
const LOW = 659.25;
const HIGH = 880;

export const CHIME_NOTES: Record<DictationChime, [number, number]> = { start: [LOW, HIGH], stop: [HIGH, LOW] };

const GAP = 0.085;
const LENGTH = 0.22;
const VOLUME = 0.16;

type AudioContextLike = Pick<AudioContext, "currentTime" | "destination" | "createOscillator" | "createGain" | "state" | "resume">;

let shared: AudioContextLike | undefined;

function context(make: () => AudioContextLike) {
  shared ??= make();
  if (shared.state === "suspended") void shared.resume();
  return shared;
}

function note(ctx: AudioContextLike, frequency: number, at: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH);
  gain.connect(ctx.destination);
  for (const [multiple, level] of [
    [1, 1],
    [2, 0.25],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * multiple, at);
    if (level === 1) osc.connect(gain);
    else {
      const quiet = ctx.createGain();
      quiet.gain.setValueAtTime(level, at);
      osc.connect(quiet);
      quiet.connect(gain);
    }
    osc.start(at);
    osc.stop(at + LENGTH + 0.02);
  }
}

export function playDictationChime(kind: DictationChime, make: () => AudioContextLike = () => new AudioContext()) {
  try {
    const ctx = context(make);
    const [first, second] = CHIME_NOTES[kind];
    note(ctx, first, ctx.currentTime);
    note(ctx, second, ctx.currentTime + GAP);
  } catch {
    // No audio device (or no Web Audio): dictation works the same, silently.
  }
}

// For tests: forget the shared context.
export function resetDictationChimes() {
  shared = undefined;
}
