import { cacheLife } from "next/cache";
import { FEED, WINDOWS_ARM_FEED, WINDOWS_FEED, parseFeed, windowsInstallerUrl, type Release } from "./home";

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

// The newest Windows installer for weft.zip/download/windows (x64, or arm64 with ?arch=arm64), cached like
// latestRelease; null until a release carries one (the link then goes to the releases page).
export async function latestWindowsInstaller(arch: "x64" | "arm64" = "x64", fetchFn: typeof fetch = fetch): Promise<string | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const res = await fetchFn(arch === "arm64" ? WINDOWS_ARM_FEED : WINDOWS_FEED, { signal: AbortSignal.timeout(RELEASE_FEED_TIMEOUT_MS) });
    if (!res.ok) return null;
    return windowsInstallerUrl(await res.text());
  } catch {
    return null;
  }
}
