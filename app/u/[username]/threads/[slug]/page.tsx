// weft.zip/@<username>/threads/<slug>: a shared thread under its sharer, the way a mini app lives at
// /@<username>/apps/<slug> (docs/architecture/sharing.md). proxy.ts rewrites the @ address to this folder
// (lib/app-routes.ts). The slug only names the link: the share id behind it goes through the same gate and body
// as /s/<id> (components/share-view/SharedCardPage.tsx).
import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { isWebEnabled } from "@/lib/home";
import { shareIdBySlug } from "@/lib/share-access";
import { threadMetadataBySlug } from "@/lib/share-meta";
import { serviceClient } from "@/lib/web-session";
import { NotDeployed, SharedCardPage } from "@/components/share-view/SharedCardPage";
import { SharedCardSkeleton } from "@/components/web-states/Skeletons";

type Params = Promise<{ username: string; slug: string }>;

// The link preview (lib/share-meta.ts): a public link's title, first ask and card, else the generic one.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  "use cache";
  cacheLife("minutes");
  const { username, slug } = await params;
  return threadMetadataBySlug(username, slug);
}

async function PageBody({ params }: { params: Params }) {
  const { username, slug } = await params;
  await connection();
  const service = serviceClient();
  const id = service ? await shareIdBySlug(service, username, slug) : null;
  if (!id) notFound();
  return <SharedCardPage id={id} here={`/@${username}/threads/${slug}`} />;
}

export default function Page({ params }: { params: Params }) {
  if (!isWebEnabled()) return <NotDeployed />;
  return (
    <Suspense fallback={<SharedCardSkeleton />}>
      <PageBody params={params} />
    </Suspense>
  );
}
