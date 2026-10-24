// The /team entry on weft.zip. The visitor signed in to a workspace earlier
// (the sign-up trigger seeds a personal one — supabase/migrations/20261013170000_teams.sql),
// and this page is the stable URL every sign-in lands on (the /auth/callback
// default, the /login default, the SignedInPrompt's Continue). It figures out
// which workspace they're in and bounces to /[orgSlug]/team, the page that
// actually shows the roster.
//
// Three outcomes:
//   - kind: "signed-out" → /login?next=/team
//   - kind: "none" (shouldn't happen post-trigger, but possible pre-backfill
//     on a very old account) → a small "No workspace yet" card with a hint
//   - kind: "ok" → redirect to /[slug]/team
//
// Reads cookies(), so the body is wrapped in <Suspense> for cacheComponents
// (next.config.ts): without it the route would be blocked from prerendering.
// In `next dev` (no VERCEL / WEFT_HOME) we render the same no-op marker the
// /login page uses, since the team pages are deployed-site only — the desktop
// app has its own account flow.
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { currentWorkspaceSlug } from "@/lib/teams";
import "@/components/team/team.css";

export const metadata = {
  title: "Your team",
  description: "Your Weft workspace.",
};

function NotDeployedCard() {
  // The /login page renders a similar marker; we keep ours in the same family
  // so the deployed-site styling (`wz-auth*`) is the only thing the visitor
  // sees, and a Weft with no VERCEL / WEFT_HOME still gets a recognizable
  // page.
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Your team</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

function NoWorkspaceCard() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">No workspace yet</h1>
        <p className="wz-authSub">
          A Weft workspace should be created on your first sign-in. Sign out and back in to create one; if it
          still doesn&apos;t appear, write to <a href="mailto:hello@weft.zip">hello@weft.zip</a>.
        </p>
      </main>
    </div>
  );
}

async function TeamRedirectBody() {
  // Resolving the slug reads cookies, so this is the part the <Suspense>
  // exists for. A redirect here is the happy path; the two fallbacks handle
  // signed-out and "no workspace" without us having to render a chooser on
  // /team (a chooser belongs in the workspace layout, not on the entry).
  const workspace = await currentWorkspaceSlug();
  if (workspace.kind === "signed-out") redirect("/login?next=/team");
  if (workspace.kind === "none") return <NoWorkspaceCard />;
  redirect(`/${workspace.slug}/team`);
}

function TeamRedirectFallback() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Your team</h1>
        <p className="wz-authSub wz-loading">Loading your workspace…</p>
      </main>
    </div>
  );
}

export default function Page() {
  if (!isWebEnabled()) return <NotDeployedCard />;
  return (
    <Suspense fallback={<TeamRedirectFallback />}>
      <TeamRedirectBody />
    </Suspense>
  );
}
