// The /a/[id] page on weft.zip — one shared mini app (lib/app-share-types.ts, docs/architecture/mini-apps.md).
// A server component reads the share, runs the same gate as a card's link (lib/app-share-access.ts), and renders the
// app's page full-window or the fallback (404, sign in, private, the gate form, not set up).
//
// If the share row has a slug (the public URL), the page redirects to /@<user>/apps/<slug> or
// /<org>/apps/<slug> so the same content lives at one URL. /a/<id> keeps working for links made
// before slugs and for the public id the dialog used to share.
//
// Like /s/[id], it lives in a <Suspense> for cacheComponents: the gate reads the cookie, and params is runtime data.
import "server-only";
import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { ShareGateForm } from "@aimhuge/share/client";
import { appShareAccess } from "@/lib/app-share-access";
import { appFrameSrc, appPublicUrl } from "@/lib/app-share-types";
import { isDeployed } from "@/lib/home";
import { SharedApp } from "@/components/share-view/SharedApp";
import { ShareNotice } from "@/components/share-view/ShareNotice";
import { serviceClient } from "@/lib/web-session";
import "@/components/home/home.css";
import { SharedAppSkeleton } from "@/components/web-states/Skeletons";

// Static on purpose, like /s/[id]: a generateMetadata that reads the gate's cookie breaks the prerendered shell.
export const metadata: Metadata = {
  title: "Shared app · Weft",
  robots: { index: false, follow: false },
};

// Look up the row's owner slug: profiles.username for owner "user", orgs.slug for owner "org".
// null is returned for a missing row, so the redirect falls through to the normal /a/<id> view
// (the share is a pre-slug link whose id is still valid).
async function ownerSlug(share: { owner: "user" | "org"; created_by?: string; org_id: string }): Promise<string | null> {
  // PageBody already awaited it; again here so the helper is request-bound on its own (lib/prerender-check.ts).
  await connection();
  const service = serviceClient();
  if (!service) return null;
  if (share.owner === "user") {
    if (!share.created_by) return null;
    const { data } = await service.from("profiles").select("username").eq("id", share.created_by).maybeSingle<{ username: string }>();
    return data?.username ?? null;
  }
  const { data } = await service.from("orgs").select("slug").eq("id", share.org_id).maybeSingle<{ slug: string }>();
  return data?.slug ?? null;
}

async function PageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Request-bound first: the service client's supabase-js reads Date.now(), which cacheComponents refuses mid-prerender.
  await connection();
  const access = await appShareAccess(id);
  if (access.kind === "missing") notFound();
  if (access.kind === "login") redirect(`/login?next=${encodeURIComponent(`/a/${id}`)}`);
  if (access.kind === "unconfigured") {
    return <ShareNotice title="Link unavailable">This link can&apos;t be opened right now. Try again in a little while.</ShareNotice>;
  }
  if (access.kind === "denied") {
    return <ShareNotice title="This app is private">This app is private. Sign in with an account it&apos;s shared with to open it.</ShareNotice>;
  }
  if (access.kind === "gate") return <ShareGateForm title="Shared app" mode={access.mode} unlockUrl={`/api/a/${id}/unlock`} noun="app" />;
  // The share has a public URL: redirect to it. The id route keeps working for pre-slug links
  // and for the dialog's saved id; the slug URL is the canonical one.
  const share = access.share;
  if (share.slug) {
    const slug = await ownerSlug(share);
    if (slug) redirect(appPublicUrl(share.owner, slug, share.slug));
  }
  // Pre-slug share: render in place. The parent-side bridge is not wired here (only the
  // /@<user>/apps/<slug> and /<org>/apps/<slug> views need it; pre-slug links are the legacy path).
  return <SharedApp name={share.name} src={appFrameSrc(id, share)} site={share.kind === "site"} />;
}


export default function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isDeployed()) {
    return <ShareNotice title="Shared app">Shared links open on weft.zip.</ShareNotice>;
  }
  return (
    <Suspense fallback={<SharedAppSkeleton />}>
      <PageBody params={params} />
    </Suspense>
  );
}
