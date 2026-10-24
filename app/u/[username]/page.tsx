// weft.zip/@username: an account's public profile (docs/architecture/profiles.md). A folder can't be named
// "@…" (that's a parallel-route slot), so next.config.ts rewrites /@:username here; /u/<username> works too.
// No sign-in: lib/public-profile.ts reads it through the service client and returns public fields only.
//
// Like /s/[id], the body sits in a <Suspense> for cacheComponents: params are request data, so they're
// awaited inside it while the shell prerenders.
import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { isWebEnabled } from "@/lib/home";
import { loadPublicProfile } from "@/lib/public-profile";
import { PublicProfileView } from "@/components/profile/PublicProfileView";
import "@/components/team/team.css";
import { ProfileSkeleton } from "@/components/web-states/Skeletons";

// Static on purpose, like /s/[id]'s: a per-profile title would need the params outside the <Suspense>.
export const metadata: Metadata = { title: "Profile · Weft" };

function NotDeployed() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Profiles</h1>
        <p className="wz-authSub">Public profiles live on weft.zip.</p>
      </main>
    </div>
  );
}

async function PageBody({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  // Request-bound first: the service client's supabase-js reads Date.now(), which cacheComponents refuses mid-prerender.
  await connection();
  const profile = await loadPublicProfile(username);
  if (!profile) notFound();
  return <PublicProfileView profile={profile} />;
}

export default function Page({ params }: { params: Promise<{ username: string }> }) {
  if (!isWebEnabled()) return <NotDeployed />;
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <PageBody params={params} />
    </Suspense>
  );
}
