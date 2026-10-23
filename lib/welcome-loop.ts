// The welcome's tour: public/welcome/intro.html (Welcome to Weft, the agents it runs on), loop.html (a card from prompt
// to Done, with the 🔐 vault), then beats.html (connect your tools, the Wefter Profile, code quality, "Now let's get
// started"), three HyperFrames compositions that play live in the Get ready hero
// (components/WelcomeLoop.tsx) and render to MP4s for weft.zip (scripts/render-welcome-loop.mjs).
// This builds the first page's address: ?live=1 plays it, ?tour=1 hands intro → loop → beats → intro (public/welcome/live.js),
// ?p= puts up to three of your own project names on the cards. It also reads the beat messages the pages post.

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

export const BEATS = ["intro", "loop", "tools", "pane", "profile", "quality", "cta"] as const;
export type Beat = (typeof BEATS)[number];

// The beat a page's postMessage names, or null for any other message.
export function beatFrom(data: unknown): Beat | null {
  if (typeof data !== "object" || data === null) return null;
  const { weft, beat } = data as { weft?: unknown; beat?: unknown };
  return weft === "welcome" && BEATS.includes(beat as Beat) ? (beat as Beat) : null;
}

// The voiceover to start when a beat opens its page (scripts/narrate-welcome.mjs): intro.html opens on "intro",
// loop.html on "loop", beats.html on "tools". The other beats run inside a track already playing.
export function voiceFor(beat: Beat): string | null {
  if (beat === "intro") return "/welcome/narration-intro.m4a";
  if (beat === "loop") return "/welcome/narration-loop.m4a";
  if (beat === "tools") return "/welcome/narration-beats.m4a";
  return null;
}

// The line the welcome says as a later step opens: "Allow Weft to see your projects.", "Now start a new thread."
export function stepVoice(step: string): string | null {
  return step === "projects" || step === "first" ? `/welcome/narration-${step}.m4a` : null;
}

// Narration on or muted, kept across the welcome's steps and the next time it shows.
export const MUTE_KEY = "weft-welcome-muted";
