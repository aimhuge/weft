// The Weft explorer badges: the first time you use each of Weft's own features, from the activity log's
// "explore" events (lib/explore.ts logs one per feature), and Explorer for earning them all. Pure.
import { def, type Def, type Result } from "./badge-kit";
import { INTROS } from "./feature-intros";
import type { GameFacts } from "./game-badges";

// The features lib/explore.ts logs a first use of. A watched intro is "intro:<id>".
export const EXPLORE_FEATURES = ["vault", "webhook", "devserver", "screenshot", "card-share", "app-share", "profile"] as const;
export type ExploreFeature = (typeof EXPLORE_FEATURES)[number] | `intro:${string}`;

// When each feature was first used.
function firstUses(f: GameFacts): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of f.events) {
    if (e.kind !== "explore" || !e.feature) continue;
    out.set(e.feature, Math.min(out.get(e.feature) ?? Infinity, e.at));
  }
  return out;
}

// Every one of these features used, dated by the last of them to arrive.
function usedAll(features: readonly string[]) {
  return (f: GameFacts): Result => {
    const uses = firstUses(f);
    const times = features.flatMap((x) => uses.get(x) ?? []);
    const done = times.length === features.length;
    return { unlocked: done, at: done ? Math.max(...times) : undefined, have: times.length, need: features.length };
  };
}

const used = (feature: string) => (f: GameFacts): Result => {
  const at = firstUses(f).get(feature);
  return { unlocked: at !== undefined, at };
};

const INTRO_FEATURES = INTROS.map((id) => `intro:${id}`);

const G = "Weft explorer";

const FEATURE_DEFS: Def[] = [
  def(G, "keymaster", "🔑", "Keymaster", "Fill a field from the 🔐 vault with Touch ID", used("vault")),
  def(G, "hooked", "🪝", "Hooked", "Get your first webhook delivery through the relay", used("webhook")),
  def(G, "showrunner", "🖥️", "Showrunner", "Start a dev server through Weft", used("devserver")),
  def(G, "snapshot", "📸", "Snapshot", "Your thread takes its first browser-pane screenshot", used("screenshot")),
  def(G, "show-and-tell", "📣", "Show and tell", "Share a card", used("card-share")),
  def(G, "launch-party", "🚀", "Launch party", "Share an app on weft.zip", used("app-share")),
  def(G, "public-face", "🪪", "Public face", "Publish your weft.zip profile", used("profile")),
  def(G, "cinephile", "🎬", "Cinephile", "Watch every feature intro", usedAll(INTRO_FEATURES)),
];

// Explorer asks for every other badge here, so it's earned by the same events.
function explorer(f: GameFacts): Result {
  const results = FEATURE_DEFS.map((d) => d.test(f));
  const done = results.every((r) => r.unlocked);
  return {
    unlocked: done,
    at: done ? Math.max(...results.map((r) => r.at ?? 0)) : undefined,
    have: results.filter((r) => r.unlocked).length,
    need: results.length,
  };
}

export const EXPLORER_DEFS: Def[] = [...FEATURE_DEFS, def(G, "explorer", "🧭", "Explorer", "Earn every badge in this family", explorer)];
