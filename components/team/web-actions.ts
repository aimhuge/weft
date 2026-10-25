"use client";

// Bridge between the team components (Roster / InviteForm / PendingInvites
// / LeaveButton) and lib/team-actions.ts. The team components take
// `actions: TeamClientActions` so the same code path serves weft.zip and
// the desktop's Settings → Team. The desktop goes through lib/use-team.ts
// (which posts to /api/account/team); weft.zip's server page passes an
// actions object built here, which closes over the org slug and calls the
// server actions directly. Server actions are async and the team page is
// a server component, so this file is marked "use client" and rendered
// inside the WebTeam client wrapper (app/[orgSlug]/team/page.tsx).

import { upgradeOnGate } from "@/lib/use-upgrade";
import type { NewTeamResult, TeamActionResult, TeamClientActions, TeamRole } from "@/lib/team-types";
import {
  addProject as serverAddProject,
  changeMemberRole as serverChangeMemberRole,
  inviteMember as serverInviteMember,
  createTeam as serverCreateTeam,
  removeMember as serverRemoveMember,
  removeProject as serverRemoveProject,
  renameTeam as serverRenameTeam,
  deleteTeam as serverDeleteTeam,
  revokeInvite as serverRevokeInvite,
  setProjectAccess as serverSetProjectAccess,
} from "@/lib/team-actions";

// Build a TeamClientActions for an org on weft.zip. Each function closes
// over the org slug; the page passes the result to its "use client"
// children.
export function webTeamActions(orgSlug: string): TeamClientActions {
  return {
    async invite(email: string, role: TeamRole): Promise<TeamActionResult> {
      // The server action in lib/team-actions.ts accepts the plain args
      // (agent S1 is moving it from FormData to these). The result is
      // already { ok, message? }.
      // A paywall's refusal (an invite on Free) also opens the upgrade dialog.
      return serverInviteMember(orgSlug, email, role).then(upgradeOnGate);
    },
    async changeRole(userId: string, role: TeamRole): Promise<TeamActionResult> {
      return serverChangeMemberRole(orgSlug, userId, role);
    },
    async remove(userId: string): Promise<TeamActionResult> {
      return serverRemoveMember(orgSlug, userId);
    },
    async revoke(inviteId: string): Promise<TeamActionResult> {
      return serverRevokeInvite(orgSlug, inviteId);
    },
    async addProject(repo: string): Promise<TeamActionResult> {
      return serverAddProject(orgSlug, repo);
    },
    async removeProject(repo: string): Promise<TeamActionResult> {
      return serverRemoveProject(orgSlug, repo);
    },
    async setProjectAccess(repo: string, userId: string, grant: boolean): Promise<TeamActionResult> {
      return serverSetProjectAccess(orgSlug, repo, userId, grant);
    },
    // The result's slug is the new workspace; the caller navigates to /<slug>/team.
    async createTeam(name: string): Promise<NewTeamResult> {
      return serverCreateTeam(name);
    },
    async renameTeam(slug: string, name: string): Promise<TeamActionResult> {
      return serverRenameTeam(slug, name);
    },
    async deleteTeam(slug: string, confirm: string): Promise<TeamActionResult> {
      return serverDeleteTeam(slug, confirm);
    },
  };
}
