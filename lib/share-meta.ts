// What a shared thread's link unfurls as, the way a mini app's does (lib/app-share-meta.ts): the two thread
// routes' generateMetadata and the /api/s/[id]/og card read the share through the service client and only a
// public link gets the card's title, its first ask and its pane capture. A private, email or password link keeps
// the generic title, so nothing of the thread reaches a stranger's chat. A link with the chat hidden never puts
// the thread's words in its description either.
import "server-only";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanText, PREVIEW_DESCRIPTION_MAX, PREVIEW_TITLE_MAX } from "./app-preview";
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import { redactText } from "./share-redact";
import { loadShare, shareIdBySlug, type LoadedShare } from "./share-access";
import { shareUrl, threadPublicUrl, type CloudShareRow } from "./share-types";
import { toShareCard } from "./share-view";
import { SITE } from "./site";
import type { ThreadItem } from "./types";
import { serviceClient } from "./web-session";

export const GENERIC_THREAD_METADATA: Metadata = {
  title: "Shared thread · Weft",
  robots: { index: false, follow: false },
};

export interface ThreadPreview {
  // "🐛 Fix the login bug": the card's emoji and title, the way the card image draws a glyph and a name.
  name: string;
  title: string;
  description: string;
  // blob:sha256:<hex> of the card's pane capture, when it has one.
  thumb?: string;
}

const DEFAULT_DESCRIPTION = "A thread built with Weft: the chat and the page it made, live.";
const ASK_PROBE = 20;

// The first thing the user asked, redacted and cut to a line; undefined when the chat is hidden or there's none.
export async function firstAsk(service: SupabaseClient, share: Pick<CloudShareRow, "org_id" | "card_id" | "show_chat">): Promise<string | undefined> {
  if (share.show_chat === false) return undefined;
  const { data } = await service
    .from("cloud_thread_items")
    .select("item")
    .eq("org_id", share.org_id)
    .eq("card_id", share.card_id)
    .order("seq", { ascending: true })
    .limit(ASK_PROBE)
    .overrideTypes<{ item: ThreadItem }[]>();
  const ask = (data ?? []).map((r) => r.item).find((i): i is Extract<ThreadItem, { kind: "user" }> => i.kind === "user");
  return ask ? cleanText(redactText(ask.text), PREVIEW_DESCRIPTION_MAX) : undefined;
}

// The preview a link may show: a public share's, else null.
export async function threadPreview(service: SupabaseClient, loaded: LoadedShare | null): Promise<ThreadPreview | null> {
  if (!loaded?.card || loaded.share.mode !== "public") return null;
  const card = toShareCard(loaded.card.card);
  const title = cleanText(card.title, PREVIEW_TITLE_MAX) ?? "Shared thread";
  const thumb = typeof card.thumb === "string" && card.thumb.startsWith(BLOB_REF_PREFIX) ? card.thumb : undefined;
  return {
    name: card.emoji ? `${card.emoji} ${title}` : title,
    title,
    description: (await firstAsk(service, loaded.share)) ?? DEFAULT_DESCRIPTION,
    ...(thumb ? { thumb } : {}),
  };
}

// A short version of what the card shows, so a changed preview is a new image address and chats fetch it again.
export function threadCardVersion(preview: ThreadPreview): string {
  let h = 5381;
  for (const c of JSON.stringify(preview)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export function threadShareMetadata(id: string, preview: ThreadPreview | null, url: string): Metadata {
  if (!preview) return GENERIC_THREAD_METADATA;
  const { title, description } = preview;
  const image = { url: `${SITE}/api/s/${id}/og?v=${threadCardVersion(preview)}`, width: 1200, height: 630, alt: title };
  // Every address is absolute, so no metadataBase: a URL object can't cross the routes' "use cache".
  return {
    title: `${title} · Weft`,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: { type: "article", siteName: "Weft", title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

// For /s/<id>, which redirects a slugged link to its own address (unfurlers follow it).
export async function threadMetadataById(id: string): Promise<Metadata> {
  const service = serviceClient();
  if (!service) return GENERIC_THREAD_METADATA;
  const loaded = await loadShare(id);
  return threadShareMetadata(id, await threadPreview(service, loaded), shareUrl(id));
}

// For /@<username>/threads/<slug>.
export async function threadMetadataBySlug(username: string, slug: string): Promise<Metadata> {
  const service = serviceClient();
  if (!service) return GENERIC_THREAD_METADATA;
  const id = await shareIdBySlug(service, username, slug);
  if (!id) return GENERIC_THREAD_METADATA;
  const loaded = await loadShare(id);
  return threadShareMetadata(id, await threadPreview(service, loaded), threadPublicUrl(username, slug));
}
