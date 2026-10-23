// weft.zip/<org>/apps/<slug>: a shared mini app under a workspace (lib/app-share-types.ts,
// docs/architecture/mini-app-hosting.md). proxy.ts rewrites /<org>/apps/<slug> to /w/<org>/apps/<slug>
// with a regex that excludes every reserved first segment, so this route folder only sees real
// app links. A server component reads the share by (owner = org, ownerSlug = org, slug), runs
// the same gate as a card's link (lib/app-share-access.ts), and renders the app's page
// full-window or the fallback (404, sign in, private, the gate form, not set up). The shared
// body lives in app/u/[username]/apps/[slug]/shared-app-body.tsx; the user app page owns the file
// because both views are the same flow and the user one is the first one written.
import { Suspense } from "react";
import { isDeployed } from "@/lib/home";
import { SharedAppPageBody } from "@/app/u/[username]/apps/[slug]/shared-app-body";
import { SharedAppSkeleton } from "@/components/web-states/Skeletons";

export const metadata = {
  title: "Shared app · Weft",
  robots: { index: false, follow: false },
};

function NotDeployed() {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">Shared app</h1>
        <p className="wz-authSub">Shared links open on weft.zip.</p>
      </div>
    </main>
  );
}

export default function Page({ params }: { params: Promise<{ org: string; slug: string }> }) {
  if (!isDeployed()) return <NotDeployed />;
  return (
    <Suspense fallback={<SharedAppSkeleton />}>
      <SharedAppPageBody params={params} owner="org" />
    </Suspense>
  );
}
