import { after } from "next/server";
import { captureDownload } from "@/lib/download-track";
import { SITE } from "@/lib/site";
import { testflightPublicUrl } from "@/lib/testflight";

// weft.zip/download/ios: the phone app's public TestFlight link, so the iPhone button is counted like the Mac and
// Windows ones (lib/download-track.ts). Before that link is set, the home page.
export function GET(request: Request): Response {
  const testflight = testflightPublicUrl();
  after(() => captureDownload(request, { platform: "ios", arch: null, version: null }));
  return Response.redirect(testflight ?? SITE, 302);
}
