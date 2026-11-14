import { after } from "next/server";
import { captureDownload } from "@/lib/download-track";
import { RELEASES } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";

// weft.zip/download: one link that always gets the newest Weft dmg, for READMEs, posts and emails, and the target of
// every Mac download button on weft.zip (?from= says which). The release comes from the update feed
// (lib/home-release.ts, cached for hours like the home page's button); with no release yet, or GitHub unreachable, it
// goes to the releases page. After the redirect is sent, it counts the download in PostHog (lib/download-track.ts).
export async function GET(request: Request): Promise<Response> {
  const release = await latestRelease();
  after(() => captureDownload(request, { platform: "mac", arch: "arm64", version: release?.version ?? null }));
  return Response.redirect(release?.dmg ?? RELEASES, 302);
}
