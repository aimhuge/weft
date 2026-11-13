import type { Metadata } from "next";
import { SITE } from "./site";

// The home page at weft.zip (components/home/Home.tsx), served by the deployed Weft on Vercel: app/page.tsx renders
// it instead of the board when isDeployed(), and app/home/page.tsx always does, so it can be seen on localhost.
// What the page says and links to lives here, where lib/home.test.ts can read it; the release feed lookup that
// fills the download button is lib/home-release.ts.

export { SITE };
export const REPO = "https://github.com/aimhuge/weft";
export const RELEASES = `${REPO}/releases`;
export const FEED = `${RELEASES}/latest/download/update.json`;
// The footer's credits, as on the board's footer (components/BoardFooter.tsx).
export const COFFEE = "https://buymeacoffee.com/alexmiller";
export const AIMHUGE = "https://aimhuge.com";
export const TAGLINE = "Engineering the future";
export const DESCRIPTION =
  "Weft is a kanban board where every card is an AI coding thread, with a browser pane that shows what it built. " +
  "Bring the idea; Claude Code, Codex or Puku threads plan it, build it, show it and walk you through the review.";

// Vercel sets VERCEL=1 on every deployment; WEFT_HOME=1 shows the home page at / on a local server too.
export function isDeployed(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL || env.WEFT_HOME);
}

// The weft.zip routes (the workspace board, /team, /login, the share and app pages) are for the
// deployed site. Locally they're off, so `next dev` renders the desktop board at / and nothing
// else. WEFT_WEB=1 turns just those routes on without the home page taking over / — so a local
// server can serve the web board and the desktop board at the same time (/ and /<slug>/board).
export function isWebEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isDeployed(env) || Boolean(env.WEFT_WEB);
}

export function homeMetadata(version: string): Metadata {
  const title = `Weft: ${TAGLINE}`;
  return {
    title,
    description: DESCRIPTION,
    metadataBase: new URL(SITE),
    alternates: { canonical: "/" },
    openGraph: { title, description: DESCRIPTION, url: SITE, siteName: "Weft", type: "website" },
    twitter: { card: "summary_large_image", title, description: DESCRIPTION },
    other: { "weft:version": version },
  };
}

// A release in scripts/release-feed.mjs's update.json, as the download button wants it.
export interface Release {
  version: string;
  dmg: string;
  page: string;
}

// Reads the feed's newest release; null when the feed has none or isn't the shape we write.
export function parseFeed(feed: unknown): Release | null {
  if (!feed || typeof feed !== "object") return null;
  // What scripts/release-feed.mjs writes: currentRelease, the dmg as download and the release page at the top
  // level (releases[] holds Squirrel's updateTo entries, which carry the zip, not the dmg).
  const { currentRelease, download, page: tagPage } = feed as Record<string, unknown>;
  if (typeof currentRelease === "string" && typeof download === "string") {
    return { version: currentRelease, dmg: download, page: typeof tagPage === "string" ? tagPage : download };
  }
  const releases = (feed as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) return null;
  for (const entry of releases) {
    if (!entry || typeof entry !== "object") continue;
    const { version, page, dmg } = entry as Record<string, unknown>;
    const url = typeof dmg === "string" ? dmg : typeof page === "string" ? page : undefined;
    if (typeof version === "string" && url) return { version, dmg: url, page: typeof page === "string" ? page : url };
  }
  return null;
}

// What the download button says and where it goes: the dmg when a release exists, the repo until then.
export function downloadLink(release: Release | null): { label: string; href: string; note: string } {
  if (release) {
    return {
      label: `Download Weft ${release.version} for Mac`,
      href: release.dmg,
      note: "Your Mac's AI Workflow.",
    };
  }
  return {
    label: "Get Weft on GitHub",
    href: REPO,
    note: "The first release is on its way. Until then, clone it and run npm run desktop.",
  };
}

// One of the hero's download buttons: Mac (the dmg), Windows (app/download/windows, with an ARM link beside it) and
// iPhone (the phone app's public TestFlight link). href null renders a "coming soon" chip instead of a link.
export interface PlatformLink {
  platform: "mac" | "windows" | "ios";
  label: string;
  sub: string;
  href: string | null;
  track: string;
  alt?: { label: string; href: string; track: string };
}

// The hero's buttons. Windows waits for a release like the dmg; iPhone waits for TESTFLIGHT_PUBLIC_URL.
export function platformLinks(release: Release | null, testflightUrl: string | null): PlatformLink[] {
  const mac = downloadLink(release);
  const v = release?.version ?? "github";
  const links: PlatformLink[] = [
    { platform: "mac", label: release ? "Download for Mac" : mac.label, sub: release ? `${release.version} · Apple silicon` : "Clone and run", href: mac.href, track: v },
  ];
  if (release) {
    links.push({
      platform: "windows",
      label: "Download for Windows",
      sub: `${release.version} · x64`,
      href: "/download/windows",
      track: `${v}-windows`,
      alt: { label: "ARM", href: "/download/windows?arch=arm64", track: `${v}-windows-arm64` },
    });
  }
  links.push(
    testflightUrl
      ? { platform: "ios", label: "Get it on iPhone", sub: "TestFlight beta", href: testflightUrl, track: "ios-testflight" }
      : { platform: "ios", label: "iPhone app", sub: "Coming soon", href: null, track: "ios-soon" },
  );
  return links;
}

// The Windows installer's feed: latest.yml, which the release's Windows job uploads beside Weft-Setup-X.exe
// (.github/workflows/windows.yml). It lands minutes after the Mac dmg, so it's read on its own.
export const WINDOWS_FEED = `${RELEASES}/latest/download/latest.yml`;
// arm64's own installer and feed, built on an arm64 runner beside the x64 one.
export const WINDOWS_ARM_FEED = `${RELEASES}/latest/download/latest-arm64.yml`;

// The installer latest.yml names, at its version's own release; null when it names none.
export function windowsInstallerUrl(yml: string | null | undefined): string | null {
  const text = yml ?? "";
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  const file = /^path:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  return version && file ? `${RELEASES}/download/v${version}/${file}` : null;
}
