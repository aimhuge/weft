// The /s/[id] page on weft.zip — one shared card's thread, live (lib/share-types.ts, docs/architecture/sharing.md).
// The body (components/share-view/SharedCardPage.tsx) runs the access gate and renders the SharedCard or the
// fallback. A link with a slug moves to its own address, /@<user>/threads/<slug>, once the visitor is through
// the gate; /s/<id> keeps working for links made before slugs.
//
// Like /a/[id], the body lives in a <Suspense> for cacheComponents (next.config.ts): params and the gate's
// cookie are request data, so they're read inside it while the shell prerenders.
import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { isWebEnabled } from "@/lib/home";
import { threadMetadataById } from "@/lib/share-meta";
import { NotDeployed, SharedCardPage } from "@/components/share-view/SharedCardPage";
import { SharedCardSkeleton } from "@/components/web-states/Skeletons";

// The link preview (lib/share-meta.ts), on params alone: reading the gate's cookie here would break the
// prerendered shell, and a preview never depends on who is looking.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  "use cache";
  cacheLife("minutes");
  const { id } = await params;
  return threadMetadataById(id);
}

async function PageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedCardPage id={id} here={`/s/${id}`} toSlug />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isWebEnabled()) return <NotDeployed />;
  return (
    <Suspense fallback={<SharedCardSkeleton />}>
      <PageBody params={params} />
    </Suspense>
  );
}
