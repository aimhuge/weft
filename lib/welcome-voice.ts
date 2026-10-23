import { MUTE_KEY } from "./welcome-loop";

// The welcome tour's voiceover player (lib/use-welcome-tour.ts): one track at a time, each page's track started as its
// page starts, muted or not across tracks. A class, so React holds one instance and calls it instead of mutating an
// audio element through a ref.

export class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private quiet = false;

  constructor(private readonly make: (src: string) => HTMLAudioElement = (src) => new Audio(src)) {}

  // Stops whatever is playing and starts `src` at `at` seconds (the top by default; a jump in the tour starts partway,
  // which a media element takes before it has loaded as its start position). A refused play (no autoplay, or no media
  // support at all) just stays silent.
  play(src: string, at = 0) {
    this.stop();
    const audio = this.make(src);
    audio.muted = this.quiet;
    if (at > 0) audio.currentTime = at;
    this.audio = audio;
    Promise.resolve()
      .then(() => audio.play())
      .catch(() => {});
  }

  setMuted(muted: boolean) {
    this.quiet = muted;
    if (this.audio) this.audio.muted = muted;
  }

  stop() {
    this.audio?.pause();
    this.audio = null;
  }
}

// Whether you muted the welcome's narration, kept in localStorage so it stays muted across steps and replays.
export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // Storage off: the mute still holds for this showing.
  }
}
