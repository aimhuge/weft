// /invite/[token]: the claim page for a workspace email invite. Three shapes:
//
//  1. Signed-out visitor → card + a "Continue with GitHub" link that
//     preserves the token through sign-in (the /auth/callback's `next` param
//     brings them right back here).
//  2. Signed in, token is valid → "Join <org name>" form. The form action
//     (./actions.ts) calls acceptInvite + setCurrentOrg and redirects to
//     /[orgSlug]/team?joined=1. We render the form rather than mutating in
//     render so link-preview bots (Slack, iMessage, Twitter) — which fetch
//     the URL on the inviter's behalf — can't drain a single-use token. The
//     same reason: accepting is a side effect, and side effects want a
//     POST, not a GET.
//  3. Signed in, token is missing / used / expired → "this link is no
//     longer valid" card. The package's lookupInviteByToken returns null
//     for all three (by design — a used token must not reveal whether a row
//     ever existed), so the visitor gets one message regardless of why.
//
// Reads cookies() through webUser(), so the body is in a <Suspense> for
// cacheComponents. Same no-op marker as the other deployed-site pages in
// `next dev`.
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { lookupInviteByToken } from "@aimhuge/teams";
import { isWebEnabled } from "@/lib/home";
import { serviceClient, webUser } from "@/lib/web-session";
import { JoinForm } from "@/components/team/JoinForm";
import { joinWorkspace } from "./actions";
import "@/components/team/team.css";

export const metadata: Metadata = {
  title: "Join a Weft workspace",
  description: "Accept your invite to a Weft workspace.",
};

function NotDeployedCard() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">You&apos;re invited to a Weft workspace</h1>
        <p className="wz-authSub">Invites live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

function SignedOutCard({ token }: { token: string }) {
  // Preserve the token through sign-in: /auth/callback redirects to `next`
  // after the cookie exchange, so the visitor comes back here ready to
  // click the Join button. The link is a plain GET — the same path the
  // /login form's "Continue with GitHub" uses (lib/auth/login-form.tsx).
  const next = `/invite/${token}`;
  const params = new URLSearchParams({ provider: "github", next });
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">You&apos;re invited to a Weft workspace</h1>
        <p className="wz-authSub">
          Sign in with GitHub and we&apos;ll bring you back here to accept.
        </p>
        <div className="wz-ctas" style={{ marginTop: 16 }}>
          <a className="wz-btnPrimary" href={`/auth/sign-in?${params.toString()}`}>
            Continue with GitHub →
          </a>
        </div>
      </main>
    </div>
  );
}

function ExpiredCard() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">This invite link is no longer valid</h1>
        <p className="wz-authSub">
          It may have expired, been revoked, or already been used. Ask the person who invited you to send a new
          one.
        </p>
        <p className="wz-authSub" style={{ marginTop: 16, fontSize: 13 }}>
          <Link href="/">← Back to weft.zip</Link>
        </p>
      </main>
    </div>
  );
}

// The signed-in, valid-token shape: the Join button inside the same card as the other three, so it
// picks up the .wz-app palette (bare, it rendered unstyled on the page's dark background).
function JoinCard({ token, orgName }: { token: string; orgName: string }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Join {orgName} on Weft</h1>
        <p className="wz-authSub">You&apos;ve been invited to this workspace. Join to see its board and team.</p>
        <JoinForm token={token} orgName={orgName} action={joinWorkspace} />
      </main>
    </div>
  );
}

async function InviteBody({ token }: { token: string }) {
  // Request-bound before anything else: building the Supabase client reads Date.now(), which
  // cacheComponents refuses during prerender ("unstable value Date.now()"), and on a cold start that
  // error left the visitor on the "Checking your invite…" fallback.
  await connection();

  // serviceClient() is null on a deployment without SUPABASE_SECRET_KEY —
  // same "invites aren't available" condition the action uses. notFound()
  // here is the right shape: the URL exists, the deployment just doesn't
  // support what it points at.
  const service = serviceClient();
  if (!service) notFound();

  const user = await webUser();
  if (!user) return <SignedOutCard token={token} />;

  // Look the invite up on the server: the only way the form can know the
  // org name and slug is by reading the row itself, and the action re-reads
  // it on POST so the org slug in the redirect is the server's, not a
  // hidden field.
  const lookup = await lookupInviteByToken(service, token).catch(() => null);
  if (!lookup) return <ExpiredCard />;

  return <JoinCard token={token} orgName={lookup.org.name} />;
}

function InviteFallback() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Join a Weft workspace</h1>
        <p className="wz-authSub wz-loading">Checking your invite…</p>
      </main>
    </div>
  );
}

// The route params are request data under cacheComponents, so they're read inside the <Suspense>, not before it.
async function InviteFor({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isWebEnabled()) return <NotDeployedCard />;
  return <InviteBody token={token} />;
}

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<InviteFallback />}>
      <InviteFor params={params} />
    </Suspense>
  );
}
