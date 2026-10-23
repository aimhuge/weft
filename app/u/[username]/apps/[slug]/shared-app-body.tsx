// The /@<user>/apps/<slug> and /<org>/apps/<slug> viewer's shared body (lib/app-share-types.ts,
// docs/architecture/mini-app-hosting.md). Both pages share the same load → gate → render flow
// (lib/app-share-access.appShareAccessBySlug): the username or org slug maps to an account or
// workspace, the share row is loaded by (owner, slug), the gate runs, the page falls back to one
// of (404, sign in, private, gate form, unconfigured) or renders the SharedApp with the bridge
// wired. The login redirect's ?next= is the public URL the visitor was looking at, not /a/<id>.
import "server-only";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { ShareGateForm } from "@aimhuge/share/client";
import { appShareAccessBySlug, loadAppShareBySlug } from "@/lib/app-share-access";
import { appFrameSrc, type AppOwner } from "@/lib/app-share-types";
import { SharedApp } from "@/components/share-view/SharedApp";
import { ShareNotice } from "@/components/share-view/ShareNotice";
import { serviceClient } from "@/lib/web-session";

// The body's params, parameterised by owner: a user page reads (username, slug) and an org page
// reads (org, slug). The page wrappers map their route's params into this shape.
type BodyParams =
  | { owner: "user"; params: Promise<{ username: string; slug: string }> }
  | { owner: "org"; params: Promise<{ org: string; slug: string }> };

// The public URL for ?next= after sign-in, matching the route that asked for it. Used as the
// login redirect's return target so the visitor lands back on the same public URL.
function publicPath(owner: AppOwner, ownerSlug: string, slug: string): string {
  return owner === "user" ? `/@${ownerSlug}/apps/${slug}` : `/${ownerSlug}/apps/${slug}`;
}

// Read the share row for a slug so the gate branch can build /api/a/<share id>/unlock. The verdict
// returns the share only on the ok branch; the gate form needs the id for its unlock route, so
// fetch the share once here to avoid a second pass through the gate.
async function shareIdFor(
  owner: AppOwner,
  ownerSlug: string,
  slug: string,
): Promise<string | null> {
  const service = serviceClient();
  if (!service) return null;
  const share = await loadAppShareBySlug(service, { owner, ownerSlug, slug });
  return share?.id ?? null;
}

export async function SharedAppPageBody({ params, owner }: BodyParams) {
  const resolved = await params;
  const ownerSlug = owner === "user" ? (resolved as { username: string }).username : (resolved as { org: string }).org;
  const slug = resolved.slug;
  // Request-bound first: the service client's supabase-js reads Date.now(), which cacheComponents
  // refuses mid-prerender.
  await connection();
  const access = await appShareAccessBySlug({ owner, ownerSlug, slug });
  const next = encodeURIComponent(publicPath(owner, ownerSlug, slug));
  if (access.kind === "missing") notFound();
  if (access.kind === "login") redirect(`/login?next=${next}`);
  if (access.kind === "unconfigured") {
    return <ShareNotice title="Link unavailable">This link can&apos;t be opened right now. Try again in a little while.</ShareNotice>;
  }
  if (access.kind === "denied") {
    return <ShareNotice title="This app is private">This app is private. Sign in with an account it&apos;s shared with to open it.</ShareNotice>;
  }
  if (access.kind === "gate") {
    // The share row was loaded inside appShareAccessBySlug to run the gate; the verdict doesn't
    // carry it on the non-ok branches. Refetch for the share id the unlock URL needs. A row that
    // disappeared between the two reads means the form would 404 on submit, which is fine — show
    // the same not-found state instead of a crash.
    const shareId = await shareIdFor(owner, ownerSlug, slug);
    if (!shareId) notFound();
    return <ShareGateForm title="Shared app" mode={access.mode} unlockUrl={`/api/a/${shareId}/unlock`} noun="app" />;
  }
  const share = access.share;
  return (
    <SharedApp
      name={share.name}
      src={appFrameSrc(share.id, share)}
      site={share.kind === "site"}
      shareId={share.id}
      manifest={share.manifest}
    />
  );
}