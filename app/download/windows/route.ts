import { after } from "next/server";
import { captureDownload, versionFromUrl } from "@/lib/download-track";
import { RELEASES } from "@/lib/home";
import { latestWindowsInstaller } from "@/lib/home-release";

// weft.zip/download/windows: the newest Weft-Setup-X-x64.exe, or the arm64 one with ?arch=arm64 (unsigned: Windows
// asks "Run anyway" once, on the first install; docs/architecture/windows.md). With no Windows build on the latest
// release yet, the releases page. Counted in PostHog after the redirect (lib/download-track.ts).
// Per request: each visit is counted, so Next must not prerender it at build time.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const arch = new URL(request.url).searchParams.get("arch") === "arm64" ? "arm64" : "x64";
  const installer = await latestWindowsInstaller(arch);
  after(() => captureDownload(request, { platform: "windows", arch, version: versionFromUrl(installer) }));
  return Response.redirect(installer ?? RELEASES, 302);
}
