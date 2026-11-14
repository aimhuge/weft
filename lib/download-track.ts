// Counts website downloads in PostHog without a cookie. Every download link on weft.zip goes through a redirect route
// (app/download, /download/windows, /download/ios), and that route captures one download_redirected here after the
// redirect is sent (after() from next/server), so the count never waits on PostHog. A random distinct id per download,
// no person profile, no visitor IP (posthog-node sends from the server, with GeoIP off), and only the referrer's host.
// Bots and HEAD requests aren't counted. docs/architecture/analytics.md.
import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";
import { serverPosthogConfig } from "./analytics-server";

export const DOWNLOAD_EVENT = "download_redirected";

export interface DownloadInfo {
  platform: "mac" | "windows" | "ios";
  arch: string | null;
  version: string | null;
}

// Crawlers, link unfurlers, uptime checks and scripted fetches; an empty user agent counts as one too.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|monitor|curl|wget|python|go-http|java\/|axios|node-fetch|okhttp|httpclient/i;

export function isBotRequest(request: Request): boolean {
  if (request.method === "HEAD") return true;
  const ua = request.headers.get("user-agent") ?? "";
  return !ua.trim() || BOT_UA.test(ua);
}

// A short, plain label like hero or plans; anything else is dropped so the param can't carry junk into PostHog.
function cleanLabel(value: string | null, max = 40): string | null {
  const v = value?.trim().toLowerCase() ?? "";
  return v && v.length <= max && /^[a-z0-9._-]+$/.test(v) ? v : null;
}

function referrerHost(request: Request): string | null {
  try {
    return new URL(request.headers.get("referer") ?? "").host || null;
  } catch {
    return null;
  }
}

// The release version in a GitHub asset URL (…/releases/download/v0.7.6/…), or null.
export function versionFromUrl(url: string | null | undefined): string | null {
  return /\/download\/v([^/]+)\//.exec(url ?? "")?.[1] ?? null;
}

export function downloadProps(request: Request, info: DownloadInfo): Record<string, string | boolean | null> {
  const query = new URL(request.url).searchParams;
  return {
    platform: info.platform,
    arch: info.arch,
    version: info.version,
    from: cleanLabel(query.get("from")),
    referrer_host: referrerHost(request),
    utm_source: cleanLabel(query.get("utm_source"), 100),
    utm_medium: cleanLabel(query.get("utm_medium"), 100),
    utm_campaign: cleanLabel(query.get("utm_campaign"), 100),
    source: "website",
    $process_person_profile: false,
  };
}

type MakeClient = (token: string, host: string) => Pick<PostHog, "capture" | "shutdown">;
const makeClient: MakeClient = (token, host) => new PostHog(token, { host, flushAt: 1, flushInterval: 0, disableGeoip: true });

// Never throws: a download that can't be counted is dropped. Returns whether it was sent.
export async function captureDownload(request: Request, info: DownloadInfo, make: MakeClient = makeClient): Promise<boolean> {
  if (isBotRequest(request)) return false;
  const config = serverPosthogConfig();
  if (!config) return false;
  try {
    const posthog = make(config.token, config.host);
    posthog.capture({ distinctId: randomUUID(), event: DOWNLOAD_EVENT, properties: downloadProps(request, info), disableGeoip: true });
    await posthog.shutdown(2000);
    return true;
  } catch {
    return false;
  }
}
