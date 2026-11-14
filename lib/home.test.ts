import { describe, expect, it } from "vitest";
import {
  DESCRIPTION,
  REPO,
  SITE,
  downloadLink,
  platformLinks,
  homeMetadata,
  isDeployed,
  isWebEnabled,
  parseFeed,
  windowsInstallerUrl,
} from "./home";

describe("isDeployed", () => {
  it("is true on Vercel or with WEFT_HOME, false otherwise", () => {
    expect(isDeployed({ VERCEL: "1" })).toBe(true);
    expect(isDeployed({ WEFT_HOME: "1" })).toBe(true);
    expect(isDeployed({})).toBe(false);
    expect(isDeployed({ VERCEL: "" })).toBe(false);
  });

  it("reads process.env by default", () => {
    expect(isDeployed()).toBe(Boolean(process.env.VERCEL || process.env.WEFT_HOME));
  });
});

describe("isWebEnabled", () => {
  it("is true whenever the site is deployed", () => {
    expect(isWebEnabled({ VERCEL: "1" })).toBe(true);
    expect(isWebEnabled({ WEFT_HOME: "1" })).toBe(true);
  });

  it("is true with WEFT_WEB alone, so a local server can serve the web routes", () => {
    expect(isWebEnabled({ WEFT_WEB: "1" })).toBe(true);
  });

  it("is false on a plain local server", () => {
    expect(isWebEnabled({})).toBe(false);
    expect(isWebEnabled({ WEFT_WEB: "" })).toBe(false);
  });

  it("reads process.env by default", () => {
    expect(isWebEnabled()).toBe(Boolean(process.env.VERCEL || process.env.WEFT_HOME || process.env.WEFT_WEB));
  });
});

describe("homeMetadata", () => {
  it("names the site, the description and the version", () => {
    const meta = homeMetadata("0.3.0");
    expect(meta.title).toBe("Weft: Engineering the future");
    expect(meta.description).toBe(DESCRIPTION);
    expect(String(meta.metadataBase)).toBe(`${SITE}/`);
    expect(meta.alternates).toEqual({ canonical: "/" });
    expect(meta.openGraph).toMatchObject({ url: SITE, siteName: "Weft", type: "website" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.other).toEqual({ "weft:version": "0.3.0" });
  });
});

describe("parseFeed", () => {
  const dmg = "https://github.com/aimhuge/weft/releases/download/v0.3.0/Weft-0.3.0-arm64.dmg";
  const page = "https://github.com/aimhuge/weft/releases/tag/v0.3.0";

  it("reads the newest release with its dmg and page", () => {
    expect(parseFeed({ releases: [{ version: "0.3.0", dmg, page }] })).toEqual({ version: "0.3.0", dmg, page });
  });

  it("reads the feed the release workflow publishes (currentRelease, download, page at the top)", () => {
    const zip = "https://github.com/aimhuge/weft/releases/download/v0.3.0/Weft-0.3.0-arm64.zip";
    const feed = { currentRelease: "0.3.0", page, download: dmg, releases: [{ version: "0.3.0", updateTo: { version: "0.3.0", url: zip } }] };
    expect(parseFeed(feed)).toEqual({ version: "0.3.0", dmg, page });
    expect(parseFeed({ currentRelease: "0.3.0", download: dmg })).toEqual({ version: "0.3.0", dmg, page: dmg });
  });

  it("falls back to the page when the entry has no dmg", () => {
    expect(parseFeed({ releases: [{ version: "0.3.0", page }] })).toEqual({ version: "0.3.0", dmg: page, page });
  });

  it("skips entries that aren't releases", () => {
    expect(parseFeed({ releases: [null, "x", { version: 3 }, { version: "0.2.0", dmg }] })).toEqual({ version: "0.2.0", dmg, page: dmg });
  });

  it("is null for anything else", () => {
    expect(parseFeed(null)).toBeNull();
    expect(parseFeed("Not Found")).toBeNull();
    expect(parseFeed({})).toBeNull();
    expect(parseFeed({ releases: "no" })).toBeNull();
    expect(parseFeed({ releases: [] })).toBeNull();
    expect(parseFeed({ releases: [{ dmg }] })).toBeNull();
  });
});

describe("downloadLink", () => {
  it("points at weft.zip/download, which counts and redirects to the dmg, when there is a release", () => {
    const release = { version: "0.3.0", dmg: "https://x/Weft.dmg", page: "https://x/tag" };
    const link = downloadLink(release);
    expect(link.label).toBe("Download Weft 0.3.0 for Mac");
    expect(link.href).toBe("/download?from=site");
    expect(downloadLink(release, "plans").href).toBe("/download?from=plans");
    expect(link.note).toBe("Your Mac's AI Workflow.");
  });

  it("points at the repo until the first release", () => {
    const link = downloadLink(null);
    expect(link.href).toBe(REPO);
    expect(link.label).toBe("Get Weft on GitHub");
    expect(link.note).toMatch(/npm run desktop/);
  });
});

describe("platformLinks", () => {
  const release = { version: "0.7.6", dmg: "https://x/Weft.dmg", page: "https://x/tag" };
  const tf = "https://testflight.apple.com/join/AbC123";

  it("offers Mac, Windows (with ARM) and iPhone once there is a release and a TestFlight link", () => {
    const [mac, win, ios] = platformLinks(release, tf);
    expect(mac).toMatchObject({ platform: "mac", label: "Download for Mac", href: "/download?from=hero", track: "0.7.6" });
    expect(mac?.sub).toMatch(/0\.7\.6/);
    expect(win).toMatchObject({ platform: "windows", href: "/download/windows?from=hero", track: "0.7.6-windows" });
    expect(win?.alt).toEqual({ label: "ARM", href: "/download/windows?arch=arm64&from=hero", track: "0.7.6-windows-arm64" });
    expect(ios).toMatchObject({ platform: "ios", href: "/download/ios?from=hero", sub: "TestFlight beta" });
    expect(platformLinks(release, tf, "closing")[0]?.href).toBe("/download?from=closing");
  });

  it("shows iPhone as coming soon without a TestFlight link", () => {
    const ios = platformLinks(release, null).at(-1);
    expect(ios).toMatchObject({ platform: "ios", href: null, sub: "Coming soon" });
  });

  it("leaves Windows off and sends Mac to GitHub before the first release", () => {
    const links = platformLinks(null, null);
    expect(links.map((l) => l.platform)).toEqual(["mac", "ios"]);
    expect(links[0]).toMatchObject({ href: REPO, label: "Get Weft on GitHub", track: "github" });
  });
});

describe("windowsInstallerUrl", () => {
  it("is the installer latest.yml names, at its version's release", () => {
    expect(windowsInstallerUrl("version: 0.7.6\npath: Weft-Setup-0.7.6.exe\n")).toBe(`${REPO}/releases/download/v0.7.6/Weft-Setup-0.7.6.exe`);
    expect(windowsInstallerUrl("version: '1.0.0'\npath: 'Weft-Setup-1.0.0.exe'\n")).toBe(`${REPO}/releases/download/v1.0.0/Weft-Setup-1.0.0.exe`);
  });

  it("is null without a version or a path", () => {
    expect(windowsInstallerUrl("path: Weft-Setup-1.exe\n")).toBeNull();
    expect(windowsInstallerUrl("version: 1\n")).toBeNull();
    expect(windowsInstallerUrl(undefined)).toBeNull();
  });
});
