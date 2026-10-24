// The workspace shell shared by every /[orgSlug]/… page on weft.zip: a thin
// header (workspace name, a switcher when the user belongs to more than one,
// nav to Team and Billing, the signed-in identity, a Sign-out form) above the
// page body. The gate that resolves the slug and verifies membership is here
// too — `requireTeam` throws (redirects to /login or notFound()) before any
// child page runs, so each /[orgSlug]/* page can trust `ctx` without checking
// it again.
//
// Wrapped in <Suspense> for cacheComponents: requireTeam reads cookies() to
// read the Supabase session, and a cookies() call outside a Suspense
// boundary blocks the route from prerendering. The /team redirect in
// app/team/page.tsx has the same wrapper, with the same reasoning.
//
// In `next dev` (no VERCEL / WEFT_HOME) we render the same no-op card the
// /login and /team pages do. The team pages don't have a desktop equivalent;
// the board's account flow is the way in.
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { requireTeam, type TeamContext } from "@/lib/teams";
import { WorkspaceHeader } from "@/components/team/WorkspaceHeader";
import UpgradeDialog from "@/components/UpgradeDialog";
import { upgradeCheckout } from "@/lib/billing-actions";
import "@/components/team/team.css";

function NotDeployedCard({ slug }: { slug: string }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Workspace: {slug}</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

async function WorkspaceShellBody({ orgSlug, children }: { orgSlug: string; children: React.ReactNode }) {
  // requireTeam redirects to /login?next=… on a signed-out visitor, and
  // notFound()s on a denied / unconfigured access — both of which throw, so
  // a successful return hands the child the resolved context.
  const ctx: TeamContext = await requireTeam(orgSlug, `/${orgSlug}/team`);
  return (
    <div className="wz-app wz-workspace">
      <WorkspaceHeader ctx={{ user: ctx.user, org: ctx.org, role: ctx.role, orgs: ctx.orgs }} />
      <main className="wz-workspaceMain">{children}</main>
      {/* The upgrade dialog a paywall here opens (an invite on Free), checking out through this workspace's action. */}
      <UpgradeDialog checkout={upgradeCheckout.bind(null, orgSlug)} />
    </div>
  );
}

function WorkspaceShellFallback() {
  return (
    <div className="wz-app wz-workspace">
      <aside className="wz-workspaceHeader" aria-busy="true">
        <div className="wz-workspaceHome">
          <span className="wz-workspaceWordmark">Weft</span>
        </div>
        <div className="wz-skeleton" />
        <div className="wz-workspaceNav">
          <div className="wz-skeleton" />
          <div className="wz-skeleton" />
          <div className="wz-skeleton" />
        </div>
      </aside>
      <main className="wz-workspaceMain">
        <div className="wz-workspaceLoading wz-loading">Loading your workspace…</div>
      </main>
    </div>
  );
}

// The route params are request data under cacheComponents, so they're read inside the <Suspense>, not before it.
async function WorkspaceShell({ params, children }: { params: Promise<{ orgSlug: string }>; children: React.ReactNode }) {
  const { orgSlug } = await params;
  if (!isWebEnabled()) return <NotDeployedCard slug={orgSlug} />;
  return <WorkspaceShellBody orgSlug={orgSlug}>{children}</WorkspaceShellBody>;
}

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next 16 hands route params as a Promise; see the use-cache / page docs in
  // node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md.
  params: Promise<{ orgSlug: string }>;
}) {
  return (
    <Suspense fallback={<WorkspaceShellFallback />}>
      <WorkspaceShell params={params}>{children}</WorkspaceShell>
    </Suspense>
  );
}
