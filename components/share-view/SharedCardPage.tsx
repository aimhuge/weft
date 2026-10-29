// The body both addresses of a shared thread render (docs/architecture/sharing.md): /s/<id> and
// /@<username>/threads/<slug>. It runs the access gate for the share id and renders the SharedCard or the
// fallback (404, sign in, private, the gate form, not set up). /s/<id> passes `toSlug` so a slugged link
// moves to its own address once the visitor is through the gate: the redirect never tells a stranger whose
// link it is. Request-bound: it lives inside the routes' <Suspense> for cacheComponents.
import "server-only";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { ShareGateForm } from "@aimhuge/share/client";
import { shareAccess, shareSlugPath } from "@/lib/share-access";
import { buildShareLive } from "@/lib/share-live";
import { serviceClient } from "@/lib/web-session";
import { SharedCard } from "./SharedCard";

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">{title}</h1>
        <p className="wz-authSub">{children}</p>
      </div>
    </main>
  );
}

const Unconfigured = () => <Notice title="Link unavailable">This link can&apos;t be opened right now. Try again in a little while.</Notice>;

// `here` is the address the visitor opened, for the sign-in's way back.
export async function SharedCardPage({ id, here, toSlug = false }: { id: string; here: string; toSlug?: boolean }) {
  // Request-bound first: the service client's supabase-js reads Date.now(), which cacheComponents refuses mid-prerender.
  await connection();
  const access = await shareAccess(id);
  if (access.kind === "unconfigured") return <Unconfigured />;
  if (access.kind === "missing") notFound();
  if (access.kind === "login") redirect(`/login?next=${encodeURIComponent(here)}`);
  if (access.kind === "denied") {
    return <Notice title="This thread is private">This thread is private to its workspace. Sign in with an account in that workspace to see it.</Notice>;
  }
  if (access.kind === "gate") return <ShareGateForm title="Shared thread" mode={access.mode} unlockUrl={`/api/s/${id}/unlock`} noun="thread" />;
  const service = serviceClient();
  if (!service) return <Unconfigured />;
  const { share, card } = access.share;
  // shareAccess's "ok" already answered "missing" for a gone card; the guard keeps a refactor from rendering an empty one.
  if (!card) notFound();
  if (toSlug) {
    const path = await shareSlugPath(service, share);
    if (path) redirect(path);
  }
  const live = await buildShareLive({ service, orgId: share.org_id, cardId: share.card_id, card: card.card, showChat: share.show_chat !== false });
  return <SharedCard id={id} initial={live} />;
}

export function NotDeployed() {
  return <Notice title="Shared thread">Shared links open on weft.zip.</Notice>;
}
