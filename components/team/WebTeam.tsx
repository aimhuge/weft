"use client";

// The client-side wrapper app/[orgSlug]/team/page.tsx renders. A server
// page can't hand a function to a client component, so the page passes
// the org slug and the snapshot pieces; this file builds the TeamClient
// actions from the slug and passes the result down. The team components
// (Roster, InviteForm, PendingInvites, LeaveButton) take `actions` as a
// prop and never import from lib/team-actions.ts.

import type { TeamClientActions, TeamMember, TeamOrg, TeamRole, TeamSnapshot } from "@/lib/team-types";
import type { RoleOption } from "./InviteForm";
import type { PendingInviteRow } from "./PendingInvites";
import type { RosterMember } from "./Roster";
import { InviteForm } from "./InviteForm";
import { LeaveButton } from "./LeaveButton";
import { PendingInvites, inviteRow } from "./PendingInvites";
import { Projects } from "./Projects";
import { Roster } from "./Roster";
import { webTeamActions } from "./web-actions";

// "a member", "an owner": the role labels are words, so the vowel test is enough.
function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

export function WebTeam({
  orgSlug,
  snapshot,
}: {
  orgSlug: string;
  snapshot: TeamSnapshot;
}) {
  const actions: TeamClientActions = webTeamActions(orgSlug);
  const roster: RosterMember[] = snapshot.members.map((m) => ({
    userId: m.userId,
    email: m.email,
    displayName: m.name,
    role: m.role,
    roleLabel: snapshot.roleLabels[m.role],
    joinedAt: m.joinedAt,
    isYou: m.userId === snapshot.user.id,
  }));
  const roleOptions: RoleOption[] = snapshot.roleOptions.map((o) => ({ role: o.role, label: o.label, description: o.description }));
  const pending: PendingInviteRow[] = snapshot.pending.map((i) => inviteRow(i, snapshot.roleLabels));
  const isOwner = snapshot.role === "owner";
  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader wz-hero wz-heroGarage">
        <h1 className="wz-teamTitle">Team</h1>
        <p className="wz-teamSub">
          {roster.length} {roster.length === 1 ? "person" : "people"} in <strong>{snapshot.org.name}</strong>. You&apos;re signed in as {article(snapshot.roleLabels[snapshot.role])} {snapshot.roleLabels[snapshot.role].toLowerCase()}.
        </p>
      </header>

      <div className="wz-stats">
        <div className="wz-stat">
          <span className="wz-statLabel">Members</span>
          <span className="wz-statValue">{roster.length}</span>
        </div>
        <div className="wz-stat">
          <span className="wz-statLabel">Pending invites</span>
          <span className="wz-statValue">{pending.length}</span>
        </div>
        <div className="wz-stat">
          <span className="wz-statLabel">Your role</span>
          <span className="wz-statValue">{snapshot.roleLabels[snapshot.role]}</span>
        </div>
      </div>

      <section className="wz-teamSection">
        <h2 className="wz-teamSectionTitle">Members</h2>
        <Roster
          members={snapshot.members}
          canManage={snapshot.canManage}
          roleOptions={roleOptions}
          currentUserId={snapshot.user.id}
          actions={actions}
        />
      </section>

      {/* The projects, each with its 🔐 vault: shared, or which Mac has it, and Share secrets as a weft:// link to the
          desktop app, since a browser can't hold the vault's key (components/team/ProjectVault.tsx). */}
      <section className="wz-teamSection">
        <h2 className="wz-teamSectionTitle">Projects</h2>
        <Projects
          projects={snapshot.projects}
          canManage={snapshot.canManage}
          actions={actions}
          boardRepos={[]}
          members={snapshot.members.length}
          org={snapshot.org}
        />
      </section>

      {snapshot.canManage ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Invite a teammate</h2>
          <InviteForm roleOptions={roleOptions} actions={actions} />
        </section>
      ) : null}

      {snapshot.canManage && pending.length > 0 ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Pending invites</h2>
          <PendingInvites invites={pending} roleLabels={snapshot.roleLabels} actions={actions} />
        </section>
      ) : null}

      {!isOwner ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Leave this workspace</h2>
          <p className="wz-teamSub">
            You&apos;ll lose access to its boards, billing and shared vaults. You can be re-invited later.
          </p>
          <LeaveButton userId={snapshot.user.id} actions={actions} />
        </section>
      ) : null}

      <footer className="wz-teamFooter">
        Shared vaults keep each value sealed to your team&apos;s Macs: our servers hold only ciphertext, never a key.
      </footer>
    </div>
  );
}

// We re-export the page's prop type so the server page can pass typed data.
export type { TeamOrg, TeamRole, TeamSnapshot, TeamMember };
