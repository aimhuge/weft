import { RELEASES } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";

// weft.zip/download: one link that always gets the newest Weft dmg, for READMEs, posts and emails. The release comes
// from the update feed (lib/home-release.ts, cached for hours like the home page's button); with no release yet, or
// GitHub unreachable, it goes to the releases page.
export async function GET(): Promise<Response> {
  const release = await latestRelease();
  return Response.redirect(release?.dmg ?? RELEASES, 302);
}
