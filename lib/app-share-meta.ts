// What a shared mini app's link unfurls as (lib/app-preview.ts): the three share routes' generateMetadata and the
// /api/a/[id]/og card read the row through the service client and use its preview only for a public link. A private,
// email or password link keeps Weft's generic card, so its name, words and screenshot never reach a stranger's chat.
import "server-only";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanPreview, type AppPreview } from "./app-preview";
import { loadAppShare, loadAppShareBySlug } from "./app-share-access";
import { appPublicUrl, appShareUrl, type AppOwner, type CloudAppShareRow } from "./app-share-types";
import { SITE } from "./site";
import { serviceClient } from "./web-session";

export const GENERIC_APP_METADATA: Metadata = {
  title: "Shared app · Weft",
  robots: { index: false, follow: false },
};

// The preview a link may show: a public share's, else none.
export function publicPreview(share: Pick<CloudAppShareRow, "mode" | "preview"> | null): AppPreview | null {
  return share?.mode === "public" ? cleanPreview(share.preview) ?? {} : null;
}

// A short version of what the card shows, so a changed preview is a new image address and chats fetch it again.
export function cardVersion(share: Pick<CloudAppShareRow, "name" | "preview">): string {
  let h = 5381;
  for (const c of JSON.stringify([share.name, share.preview ?? null])) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

// The picture: the app's or page's own https image, else the branded card (which also serves a folder's own image).
export function previewImageUrl(share: Pick<CloudAppShareRow, "id" | "name" | "preview">, preview: AppPreview): string {
  if (preview.image?.startsWith("https:")) return preview.image;
  return `${SITE}/api/a/${share.id}/og?v=${cardVersion(share)}`;
}

export function appShareMetadata(share: CloudAppShareRow | null, url: string): Metadata {
  const preview = share ? publicPreview(share) : null;
  if (!share || !preview) return GENERIC_APP_METADATA;
  const title = preview.title ?? share.name;
  const description = preview.description ?? `${share.name}, a mini app shared on Weft.`;
  const image = { url: previewImageUrl(share, preview), width: 1200, height: 630, alt: title };
  // Every address here is absolute, so no metadataBase: a URL object can't cross the routes' "use cache".
  return {
    title: `${title} · Weft`,
    description,
    // Unfurlers ignore noindex; search engines keep out until a link asks to be found.
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: "Weft", title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

// For generateMetadata on /@<user>/apps/<slug> and /<org>/apps/<slug>, under its "use cache".
export async function appMetadataBySlug(lookup: { owner: AppOwner; ownerSlug: string; slug: string }): Promise<Metadata> {
  const service = serviceClient();
  if (!service) return GENERIC_APP_METADATA;
  const share = await loadAppShareBySlug(service, lookup);
  return appShareMetadata(share, appPublicUrl(lookup.owner, lookup.ownerSlug, lookup.slug));
}

// For /a/<id>, which redirects a slugged link to its public address (unfurlers follow it).
export async function appMetadataById(id: string): Promise<Metadata> {
  const service = serviceClient();
  if (!service) return GENERIC_APP_METADATA;
  return appShareMetadata(await loadAppShare(service, id), appShareUrl(id));
}

// Who the card says the app is by: "@username", or the workspace's name.
export async function shareByline(service: SupabaseClient, share: Pick<CloudAppShareRow, "owner" | "created_by" | "org_id">): Promise<string> {
  if (share.owner === "user" && share.created_by) {
    const { data } = await service.from("profiles").select("username").eq("id", share.created_by).maybeSingle<{ username: string | null }>();
    if (data?.username) return `@${data.username}`;
  }
  const { data } = await service.from("orgs").select("name, slug").eq("id", share.org_id).maybeSingle<{ name: string | null; slug: string }>();
  return data?.name || data?.slug || "weft.zip";
}

// A blob's bytes from weft-blobs/<org>/<sha>, or null.
export async function blobBytes(service: SupabaseClient, orgId: string, sha: string): Promise<ArrayBuffer | null> {
  const { data } = await service.storage.from("weft-blobs").download(`${orgId}/${sha}`);
  return data ? data.arrayBuffer() : null;
}
