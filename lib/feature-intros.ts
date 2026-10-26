// The feature intros: a short narrated video (public/intros/<id>.html, a HyperFrames composition like the welcome
// tour's) that plays the first time you open each tool drawer on the left rail, the New thread dialog, the code
// quality dialog and the leagues. components/FeatureIntro.tsx draws it; lib/use-feature-intro.ts decides when it
// shows. Which ones you've seen live in localStorage, so each plays once on its own; ▶ beside the title plays it again.

export const INTROS = [
  "vault",
  "webhooks",
  "vercel",
  "supabase",
  "cloudflare",
  "blastcp",
  "github",
  "slack",
  "crons",
  "skills",
  "services",
  "quality",
  "leagues",
  "newthread",
] as const;
export type IntroId = (typeof INTROS)[number];

export const INTRO_TITLES: Record<IntroId, string> = {
  vault: "Secrets",
  webhooks: "Webhooks",
  vercel: "Vercel",
  supabase: "Supabase",
  cloudflare: "Cloudflare",
  blastcp: "BlastCP",
  github: "GitHub",
  slack: "Slack",
  crons: "Crons",
  skills: "Skills",
  services: "Services",
  quality: "Code quality",
  leagues: "Leagues",
  newthread: "New thread",
};

export const isIntro = (id: unknown): id is IntroId => INTROS.includes(id as IntroId);

// The intros that have a video page in public/intros. Every drawer has one today, but a new drawer can join
// INTROS before its video is made; it still has an id and a title, so the rail knows it, but it plays nothing:
// the ▶ button stays away and nothing opens on the first visit.
export const VIDEO_INTROS = ["vault", "webhooks", "vercel", "supabase", "cloudflare", "blastcp", "github", "slack", "crons", "skills", "services", "quality", "leagues", "newthread"] as const;

export const hasVideo = (id: IntroId) => (VIDEO_INTROS as readonly string[]).includes(id);

// The page plays itself with ?live=1 (public/intros/player.js), voice and all: its voiceover is the track beside it,
// made by `pnpm intros:narrate` (scripts/narrate-intros.mjs) from the page's own #narration lines, and the page plays
// it so the frames wait for it. ?muted=1 starts it muted; muteMessage flips it after.
export const introSrc = (id: IntroId, muted = false) => `/intros/${id}.html?live=1${muted ? "&muted=1" : ""}`;
export const muteMessage = (muted: boolean) => ({ weft: "intro-mute", muted }) as const;

// What the page posts as it plays: "start" when the timeline starts from the top, "pause" and "play" when a click
// stops it and plays it on, "done" when it ends.
const INTRO_EVENTS = ["start", "pause", "play", "done"] as const;
export type IntroEvent = (typeof INTRO_EVENTS)[number];
export function introEvent(data: unknown): IntroEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const { weft, event } = data as { weft?: unknown; event?: unknown };
  return weft === "intro" && INTRO_EVENTS.includes(event as IntroEvent) ? (event as IntroEvent) : null;
}
// The message that plays the page again from the top.
export const REPLAY_MESSAGE = { weft: "intro-go" } as const;
// The message a click on the video sends: pause it, or play it on (or again from the top, once it has ended).
export const TOGGLE_MESSAGE = { weft: "intro-toggle" } as const;
// The message that pauses it when something comes over it (lib/intro-cover.ts); a paused or finished page ignores it.
export const PAUSE_MESSAGE = { weft: "intro-pause" } as const;

export const INTROS_KEY = "weft-intros-seen";

type IntroStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): IntroStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSeenIntros(storage: IntroStorage | null = defaultStorage()): Set<IntroId> {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(INTROS_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter(isIntro) : []);
  } catch {
    return new Set();
  }
}

export function markIntroSeen(id: IntroId, storage: IntroStorage | null = defaultStorage()): Set<IntroId> {
  const seen = loadSeenIntros(storage);
  seen.add(id);
  try {
    storage?.setItem(INTROS_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage full or blocked: it just plays again next time.
  }
  return seen;
}

// Settings → General's Reset tips plays every intro again too.
export function resetIntros(storage: IntroStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(INTROS_KEY);
  } catch {
    // Nothing saved to clear.
  }
}
