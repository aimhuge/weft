// The Team page: the workspace's roster, the invite form (for managers), the
// pending-invites list (for managers), and a Leave button (for non-owners).
// The switcher is in the workspace layout (app/[orgSlug]/layout.tsx) so every
// /[orgSlug]/* page has it; this page is roster + invite.
//
// Data: listOrgMembers + (when the caller can manage members) listPendingInvites,
// both through the service client ctx.service — the @aimhuge/teams package
// documents that org_memberships and invitations RLS is locked down to the
// service role, so the cookie-bound client reads nothing here.
//
// The snapshot is plain data (lib/team-types.ts), built here on the server
// from the gate's ctx, and handed to the WebTeam client wrapper
// (components/team/WebTeam.tsx). The wrapper builds the TeamClientActions
// from the org slug and passes them to the team components (Roster,
// InviteForm, PendingInvites, LeaveButton). The team components themselves
// import nothing server-side, so they render in either weft.zip or the
// desktop's Settings page (lib/use-team.ts posts to the local forwarder
// there).
//
// Wrapped in <Suspense> (cacheComponents) because listOrgMembers and the
// listPendingInvites call go through a service client that proxy.ts didn't
// pre-warm — these reads are explicitly NOT under the prerender set, and a
// cookies()/await connection() would be required otherwise. The layout
// already wrapped itself in Suspense, so the page body could re-enter; the
// layout's fallback is the one a slow loader will see.
import type { Metadata } from "next";
import { Suspense } from "react";
import { WebTeam } from "@/components/team/WebTeam";
import { isWebEnabled } from "@/lib/home";
import { teamSnapshot } from "@/lib/team-ops";
import { requireTeam } from "@/lib/teams";
import { TeamTabs } from "./devices/TeamTabs";

export const metadata: Metadata = {
  title: "Team",
  description: "The people in your Weft workspace and the invites waiting on them.",
};

function NotDeployedCard({ slug }: { slug: string }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Team · {slug}</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

async function TeamPageBody({ orgSlug }: { orgSlug: string }) {
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/team`);
  // The same snapshot the JSON API returns (members, pending invites for managers, projects, the viewer's role in
  // each workspace), read through the service client because the tables' RLS is locked to the service role.
  // The tab strip above the roster: People (this page) and Devices (the machines this workspace can
  // share vaults with). The Devices tab leads to its own page, which is a server component like this one.
  return (
    <div className="wz-teamPage">
      <TeamTabs orgSlug={orgSlug} />
      <WebTeam orgSlug={orgSlug} snapshot={await teamSnapshot(ctx)} />
    </div>
  );
}

function TeamPageFallback() {
  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader wz-hero wz-heroGarage">
        <h1 className="wz-teamTitle">Team</h1>
        <p className="wz-teamSub">Loading the roster…</p>
      </header>
    </div>
  );
}

// The route params are request data under cacheComponents, so they're read inside the <Suspense>, not before it.
async function TeamPageFor({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  if (!isWebEnabled()) return <NotDeployedCard slug={orgSlug} />;
  return <TeamPageBody orgSlug={orgSlug} />;
}

export default function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  return (
    <Suspense fallback={<TeamPageFallback />}>
      <TeamPageFor params={params} />
    </Suspense>
  );
}