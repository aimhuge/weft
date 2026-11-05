import { cacheLife } from "next/cache";
import { FEED, parseFeed, type Release } from "./home";

const RELEASE_FEED_TIMEOUT_MS = 3_000;

// The newest Weft release for the home page's download button, from the update feed the release workflow
// publishes with each tag (scripts/release-feed.mjs, docs/architecture/updates.md). Cached for minutes, so a visit
// doesn't wait on GitHub and a new release shows within a couple of minutes, with no redeploy (with "hours" a
// release published just after a deploy sat behind the old version for up to an hour); null when there is no release yet or GitHub
// can't be reached, and the button points at the repo instead (downloadLink in lib/home.ts).
export async function latestRelease(fetchFn: typeof fetch = fetch): Promise<Release | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const res = await fetchFn(FEED, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(RELEASE_FEED_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseFeed(await res.json());
  } catch {
    return null;
  }
}
