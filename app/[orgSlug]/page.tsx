// weft.zip/<org>: the workspace's own address. It had no page, so it drew the workspace shell around nothing;
// it goes to the board, the workspace's front door. The layout's gate (requireTeam) has already run by the time
// this renders, so a visitor who isn't a member never reaches the redirect.
//
// Params are request data under cacheComponents, so they're read inside the <Suspense>; redirect() there streams
// a client-side redirect, which is what the docs say it does in a streaming context.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BoardSkeleton } from "@/components/web-states/Skeletons";

async function ToBoard({ params }: { params: Promise<{ orgSlug: string }> }): Promise<React.ReactNode> {
  const { orgSlug } = await params;
  redirect(`/${encodeURIComponent(orgSlug)}/board`);
}

export default function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <ToBoard params={params} />
    </Suspense>
  );
}
