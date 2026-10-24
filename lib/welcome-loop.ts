// The welcome's tour: public/welcome/intro.html (Welcome to Weft, the agents it runs on), loop.html (a card from prompt
// to Done), then beats.html (connect your tools, the 🔐 vault, panes, code quality, BlastCP, the Wefter Profile, open source, "Now
// let's get started"), three HyperFrames compositions that play live in the Get ready hero
// (components/WelcomeLoop.tsx) and render to MP4s for weft.zip (scripts/render-welcome-loop.mjs).
// This builds the first page's address: ?live=1 plays it, ?tour=1 hands intro → loop → beats → intro (public/welcome/live.js),
// ?p= puts up to three of your own project names on the cards. It also reads the beat messages the pages post, and
// writes the ones that jump between beats.

export const LOOP_PATH = "/welcome/intro.html";

export function loopSrc(names: string[]): string {
  const picked = names
    .map((n) => n.replace(/,/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  const query = new URLSearchParams({ live: "1", tour: "1" });
  if (picked.length) query.set("p", picked.join(","));
  return `${LOOP_PATH}?${query.toString()}`;
}

// The tour's beats in order (build → ship → show), the page each one is on, and the title the welcome's tour bar
// shows for it (components/WelcomeTourBar.tsx). beats.html's SCENES must keep the same order.
export const BEATS = ["intro", "loop", "tools", "vault", "pane", "quality", "blastcp", "profile", "opensource", "cta"] as const;
export type Beat = (typeof BEATS)[number];

export const BEAT_TITLES: Record<Beat, string> = {
  intro: "Welcome to Weft",
  loop: "A card from idea to Done",
  tools: "Connect your tools",
  vault: "Your keys, in the vault",
  pane: "Live panes you can share",
  quality: "Code quality",
  blastcp: "Build in public",
  profile: "Your Wefter Profile",
  opensource: "Weft is open source",
  cta: "Let's get started",
};

type Page = "intro" | "loop" | "beats";
export function pageOf(beat: Beat): Page {
  return beat === "intro" || beat === "loop" ? beat : "beats";
}

// What a page posts as its beat changes (public/welcome/live.js): the beat, the page's time, and whether it got there
// by a jump (Back, Next or a tap on the bar) rather than by playing. Null for any other message.
export type BeatMessage = { beat: Beat; t: number; jumped: boolean };
export function beatMessage(data: unknown): BeatMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const { weft, beat, t, jumped } = data as { weft?: unknown; beat?: unknown; t?: unknown; jumped?: unknown };
  if (weft !== "welcome" || !BEATS.includes(beat as Beat)) return null;
  return { beat: beat as Beat, t: typeof t === "number" && t >= 0 ? t : 0, jumped: jumped === true };
}

// The beat before or after this one, or null at either end (the tour bar's Back and Next).
export function stepBeat(beat: Beat, by: 1 | -1): Beat | null {
  return BEATS[BEATS.indexOf(beat) + by] ?? null;
}

// The message that sends the tour to a beat; live.js seeks there, or loads the beat's page first.
export function goMessage(beat: Beat) {
  return { weft: "go", beat, page: `${pageOf(beat)}.html` };
}

// Each page's voiceover (scripts/narrate-welcome.mjs), lined up with that page's timeline.
export function pageVoice(beat: Beat): string {
  return `/welcome/narration-${pageOf(beat)}.m4a`;
}

// The voiceover to start when a beat opens its page: intro.html opens on "intro", loop.html on "loop", beats.html on
// "tools". The other beats run inside a track already playing.
export function voiceFor(beat: Beat): string | null {
  return beat === "intro" || beat === "loop" || beat === "tools" ? pageVoice(beat) : null;
}

// The line the welcome says as a later step opens: "Allow Weft to see your projects.", "Now start a new thread."
export function stepVoice(step: string): string | null {
  return step === "projects" || step === "first" ? `/welcome/narration-${step}.m4a` : null;
}

// Narration on or muted, kept across the welcome's steps and the next time it shows.
export const MUTE_KEY = "weft-welcome-muted";
