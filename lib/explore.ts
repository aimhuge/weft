import type { ExploreFeature } from "./explorer-badges";

// The first use of one of Weft's own features, for the Weft explorer badges (lib/explorer-badges.ts). Its id is the
// feature, so the log keeps one per feature ever and calling it on every use costs a Set lookup. Best effort and
// never throws: the log loads lazily, so the modules that call this don't pull the board's store in with them.
export function recordExplore(feature: ExploreFeature, at = Date.now()): Promise<void> {
  return import("./activity")
    .then(({ append }) => append([{ id: `explore:${feature}`, at, kind: "explore", feature }]))
    .catch((err: unknown) => console.warn("Couldn't write the activity log", err));
}
