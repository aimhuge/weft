// A card share link's address under its sharer, weft.zip/@<username>/threads/<slug> (lib/share-types.ts
// threadPublicUrl), picked the way a mini app's is (lib/app-share-slug.ts): the card's title as a slug, and a taken
// one tries <slug>-2 … <slug>-9 before the link goes without (it still works at /s/<id>).
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_SLUG_RE, appSlugFrom } from "./app-share-types";
import { isDuplicateSlug, slugCandidates } from "./app-share-slug";

// "Fix the login bug 🐛" → "fix-the-login-bug"; a title with nothing usable in it → "thread".
export function threadSlugFrom(title: string): string {
  const slug = appSlugFrom(title);
  return slug === "app" && !/\bapp\b/i.test(title) ? "thread" : slug;
}

export function isThreadSlug(value: unknown): value is string {
  return typeof value === "string" && APP_SLUG_RE.test(value);
}

// The sharer's username, the first part of the address; null before they've picked one.
export async function sharerUsername(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await client.from("profiles").select("username").eq("id", userId).maybeSingle<{ username: string | null }>();
  return data?.username ?? null;
}

// Gives the link the first free candidate slug, best effort: the slug it got, or null when every one was taken
// or the write failed for another reason.
export async function claimThreadSlug(client: SupabaseClient, shareId: string, title: string): Promise<string | null> {
  for (const slug of slugCandidates(threadSlugFrom(title))) {
    const { error } = (await client.from("cloud_shares").update({ slug }).eq("id", shareId)) as { error: { message: string } | null };
    if (!error) return slug;
    if (!isDuplicateSlug(error)) return null;
  }
  return null;
}
