import { cacheLife } from "next/cache";
import { FEED, WINDOWS_ARM_FEED, WINDOWS_FEED, parseFeed, windowsInstallerUrl, type Release } from "./home";

const RELEASE_FEED_TIMEOUT_MS = 3_000;
// The same release through GitHub's API, for when the public /releases/latest/download path is down: on 2026-11-09
// it answered 504 for many minutes while the API served the release fine, and the home page said "the first release
// is on its way" with v0.8.0 out.
export const RELEASE_API = "https://api.github.com/repos/aimhuge/weft/releases/latest";

interface ApiAsset {
  name: string;
  url: string;
}

// The API's latest release as its tag, page and assets; null when it isn't the shape GitHub sends.
function parseApiRelease(body: unknown): { version: string; page: string; assets: ApiAsset[] } | null {
  const { tag_name: tag, html_url: page, assets } = (body ?? {}) as Record<string, unknown>;
  if (typeof tag !== "string" || !Array.isArray(assets)) return null;
  const files = assets.flatMap((asset: unknown) => {
    const { name, browser_download_url: url } = (asset ?? {}) as Record<string, unknown>;
    return typeof name === "string" && typeof url === "string" ? [{ name, url }] : [];
  });
  return { version: tag.replace(/^v/, ""), page: typeof page === "string" ? page : "", assets: files };
}

// The latest release from the API, or null when it can't be reached or isn't a release.
async function apiRelease(fetchFn: typeof fetch) {
  try {
    const res = await fetchFn(RELEASE_API, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(RELEASE_FEED_TIMEOUT_MS),
    });
    return res.ok ? parseApiRelease(await res.json()) : null;
  } catch {
    return null;
  }
}

// The home page's Release from the API: the dmg asset, and the tag page (the dmg when GitHub sends no page).
async function releaseFromApi(fetchFn: typeof fetch): Promise<Release | null> {
  const release = await apiRelease(fetchFn);
  const dmg = release?.assets.find((asset) => asset.name.endsWith(".dmg"))?.url;
  return release && dmg ? { version: release.version, dmg, page: release.page || dmg } : null;
}

// The Windows installer for arch from the API: Weft-Setup-<version>-<arch>.exe.
async function installerFromApi(arch: "x64" | "arm64", fetchFn: typeof fetch): Promise<string | null> {
  const release = await apiRelease(fetchFn);
  return release?.assets.find((asset) => asset.name.endsWith(`-${arch}.exe`))?.url ?? null;
}

// The newest Weft release for the home page's download button, from the update feed the release workflow
// publishes with each tag (scripts/release-feed.mjs, docs/architecture/updates.md). Cached for minutes, so a visit
// doesn't wait on GitHub and a new release shows within a couple of minutes, with no redeploy (with "hours" a
// release published just after a deploy sat behind the old version for up to an hour); null when there is no release yet or GitHub
// can't be reached, and the button points at the repo instead (downloadLink in lib/home.ts). When the feed can't be
// fetched it asks GitHub's API instead (RELEASE_API).
export async function latestRelease(fetchFn: typeof fetch = fetch): Promise<Release | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const res = await fetchFn(FEED, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(RELEASE_FEED_TIMEOUT_MS),
    });
    if (res.ok) return parseFeed(await res.json());
  } catch {
    // the download path is down or slow: ask the API below
  }
  return releaseFromApi(fetchFn);
}

// The newest Windows installer for weft.zip/download/windows (x64, or arm64 with ?arch=arm64), cached like
// latestRelease, with the same API fallback; null until a release carries one (the link then goes to the releases page).
export async function latestWindowsInstaller(arch: "x64" | "arm64" = "x64", fetchFn: typeof fetch = fetch): Promise<string | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const res = await fetchFn(arch === "arm64" ? WINDOWS_ARM_FEED : WINDOWS_FEED, { signal: AbortSignal.timeout(RELEASE_FEED_TIMEOUT_MS) });
    if (res.ok) return windowsInstallerUrl(await res.text());
  } catch {
    // the download path is down or slow: ask the API below
  }
  return installerFromApi(arch, fetchFn);
}
