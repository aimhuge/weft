import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDownload, DOWNLOAD_EVENT, downloadProps, isBotRequest, versionFromUrl } from "./download-track";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15";
const req = (url: string, headers: Record<string, string> = { "user-agent": BROWSER }, method = "GET") => new Request(url, { headers, method });
const MAC = { platform: "mac" as const, arch: "arm64", version: "0.8.3" };

function deployed() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
}

afterEach(() => vi.unstubAllEnvs());

describe("isBotRequest", () => {
  it("passes a browser and stops HEAD, empty and crawler user agents", () => {
    expect(isBotRequest(req("https://weft.zip/download"))).toBe(false);
    expect(isBotRequest(req("https://weft.zip/download", { "user-agent": BROWSER }, "HEAD"))).toBe(true);
    expect(isBotRequest(req("https://weft.zip/download", {}))).toBe(true);
    expect(isBotRequest(req("https://weft.zip/download", { "user-agent": "  " }))).toBe(true);
    for (const ua of ["Googlebot/2.1", "Slackbot-LinkExpanding 1.0", "curl/8.4.0", "facebookexternalhit/1.1", "python-requests/2.31", "HeadlessChrome/120"]) {
      expect(isBotRequest(req("https://weft.zip/download", { "user-agent": ua }))).toBe(true);
    }
  });
});

describe("versionFromUrl", () => {
  it("reads the tag out of a release asset URL", () => {
    expect(versionFromUrl("https://github.com/aimhuge/weft/releases/download/v0.7.6/Weft-Setup-0.7.6-x64.exe")).toBe("0.7.6");
    expect(versionFromUrl("https://github.com/aimhuge/weft/releases")).toBeNull();
    expect(versionFromUrl(null)).toBeNull();
  });
});

describe("downloadProps", () => {
  it("keeps the button, the referrer's host only and the utm tags", () => {
    const r = req("https://weft.zip/download?from=Hero&utm_source=newsletter&utm_medium=email&utm_campaign=launch_08", {
      "user-agent": BROWSER,
      referer: "https://news.ycombinator.com/item?id=123&user=someone",
    });
    expect(downloadProps(r, MAC)).toEqual({
      platform: "mac",
      arch: "arm64",
      version: "0.8.3",
      from: "hero",
      referrer_host: "news.ycombinator.com",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "launch_08",
      source: "website",
      $process_person_profile: false,
    });
  });

  it("drops junk labels and a missing or broken referrer", () => {
    const long = "x".repeat(41);
    const props = downloadProps(req(`https://weft.zip/download?from=${long}&utm_source=<script>`, { "user-agent": BROWSER, referer: "not a url" }), MAC);
    expect(props).toMatchObject({ from: null, utm_source: null, utm_medium: null, utm_campaign: null, referrer_host: null });
    expect(downloadProps(req("https://weft.zip/download"), MAC).referrer_host).toBeNull();
    expect(downloadProps(req("https://weft.zip/download", { "user-agent": BROWSER, referer: "about:blank" }), MAC).referrer_host).toBeNull();
  });
});

describe("captureDownload", () => {
  const client = () => ({ capture: vi.fn<(msg: unknown) => void>(), shutdown: vi.fn().mockResolvedValue(undefined) });

  it("captures one anonymous, profile-less download_redirected on the deployed Weft", async () => {
    deployed();
    const c = client();
    const make = vi.fn(() => c);
    expect(await captureDownload(req("https://weft.zip/download?from=hero"), MAC, make)).toBe(true);
    expect(make).toHaveBeenCalledWith("phc_test", "https://us.i.posthog.com");
    const sent = c.capture.mock.calls[0]?.[0] as { event: string; distinctId: string; disableGeoip: boolean; properties: Record<string, unknown> };
    expect(sent.event).toBe(DOWNLOAD_EVENT);
    expect(sent.distinctId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.disableGeoip).toBe(true);
    expect(sent.properties).toMatchObject({ from: "hero", platform: "mac", $process_person_profile: false });
    expect(c.shutdown).toHaveBeenCalledWith(2000);
  });

  it("sends nothing for a bot, or without PostHog keys", async () => {
    deployed();
    const make = vi.fn(client);
    expect(await captureDownload(req("https://weft.zip/download", { "user-agent": "Googlebot" }), MAC, make)).toBe(false);
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("WEFT_HOME", "");
    expect(await captureDownload(req("https://weft.zip/download"), MAC, make)).toBe(false);
    expect(make).not.toHaveBeenCalled();
  });

  it("swallows a PostHog failure", async () => {
    deployed();
    const make = () => ({ capture: vi.fn(), shutdown: vi.fn().mockRejectedValue(new Error("down")) });
    expect(await captureDownload(req("https://weft.zip/download"), MAC, make)).toBe(false);
  });

  it("builds a real posthog-node client by default", async () => {
    deployed();
    vi.doMock("posthog-node", () => ({ PostHog: vi.fn(function () { return client(); }) }));
    vi.resetModules();
    const fresh = await import("./download-track");
    expect(await fresh.captureDownload(req("https://weft.zip/download"), MAC)).toBe(true);
    const { PostHog } = await import("posthog-node");
    expect(PostHog).toHaveBeenCalledWith("phc_test", expect.objectContaining({ host: "https://us.i.posthog.com", disableGeoip: true }));
    vi.doUnmock("posthog-node");
  });
});
