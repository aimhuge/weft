// weft.zip/@<username>/apps/<slug>: a shared mini app under its owner (lib/app-share-types.ts,
// docs/architecture/mini-app-hosting.md). proxy.ts rewrites /@<user>/apps/<slug> to /u/<user>/apps/<slug>,
// so this route folder never sees the @ prefix. A server component reads the share by
// (owner = user, ownerSlug = username, slug), runs the same gate as a card's link
// (lib/app-share-access.ts, with the user-private rule), and renders the app's page full-window
// or the fallback (404, sign in, private, the gate form, not set up). The shared body lives in
// ./shared-app-body.tsx so /<org>/apps/<slug> renders the same.
//
// Like /a/[id] and /s/[id], the body sits in a <Suspense> for cacheComponents: params are request
// data, awaited inside it, while the shell prerenders.
import type { Metadata } from "next";
import { Suspense } from "react";
import { isDeployed } from "@/lib/home";
import { SharedAppPageBody } from "./shared-app-body";
import { SharedAppSkeleton } from "@/components/web-states/Skeletons";

// Static on purpose, like /a/[id] and /s/[id]: a per-share title would need the params outside
// the <Suspense>.
export const metadata: Metadata = {
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

export default function Page({ params }: { params: Promise<{ username: string; slug: string }> }) {
  if (!isDeployed()) return <NotDeployed />;
  return (
    <Suspense fallback={<SharedAppSkeleton />}>
      <SharedAppPageBody params={params} owner="user" />
    </Suspense>
  );
}
