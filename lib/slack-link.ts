import { accountClient } from "./account";
import { syncOrgId } from "./cloud-sync";
import { syncFolders } from "./settings";
import { SITE } from "./site";

// The link a Slack message carries to its card on weft.zip (docs/architecture/slack.md), where you can read the whole
// thread, reply, review and move it. A card has the same id there as here (lib/cloud-sync-cards.ts); the page is the
// workspace's board with the card open. A card is there only when its folder syncs, so without sync (or signed out,
// or with no workspace) the message goes without a link rather than with one that 404s.

export function webCardUrl(slug: string, cardId: string, origin = SITE): string {
  return `${origin}/${encodeURIComponent(slug)}/board?card=${encodeURIComponent(cardId)}`;
}

// The workspace's slug, kept for the server's life once found: it changes only when the workspace is renamed.
let slugCache: { userId: string; slug: string } | null = null;

async function workspaceSlug(): Promise<string | null> {
  const client = accountClient();
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  if (slugCache?.userId === userId) return slugCache.slug;
  const orgId = await syncOrgId(client, userId);
  if (!orgId) return null;
  const { data: org } = await client.from("orgs").select("slug").eq("id", orgId).maybeSingle<{ slug: string }>();
  if (!org?.slug) return null;
  slugCache = { userId, slug: org.slug };
  return org.slug;
}

export async function cardLink(cardId: string, cwd: string): Promise<string | null> {
  if (!syncFolders().includes(cwd)) return null;
  try {
    const slug = await workspaceSlug();
    return slug ? webCardUrl(slug, cardId) : null;
  } catch {
    return null; // accounts aren't set up in this build, or Supabase is out of reach
  }
}

// For a test: forget the cached slug.
export function resetSlugCache() {
  slugCache = null;
}
