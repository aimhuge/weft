"use client";

// Settings → Teams' People: everyone on the team on one wrapping line, each by GitHub avatar and @login (name or
// email when they didn't sign in with GitHub), and "Invite…", which opens the invite form (an email or an @login),
// the suggestions from the team's GitHub org and its repos' collaborators (./ProjectPeople), and the pending
// invites. Roles and Remove live under Advanced (./Roster), so this stays one line until you invite someone.
import { useState } from "react";
import type { RoleOption, TeamClientActions, TeamMember, TeamRole, TeamSnapshot } from "@/lib/team-types";
import { memberLabel } from "@/lib/team-view";
import { InviteForm } from "./InviteForm";
import { PendingInvites, inviteRow } from "./PendingInvites";
import { ProjectPeople } from "./ProjectPeople";
import { BUTTON } from "./SettingsSection";

function Person({ member, you, owner }: { member: TeamMember; you: boolean; owner: boolean }) {
  const label = memberLabel(member);
  return (
    <li className="flex items-center gap-1.5 text-[13px] text-ink" title={member.email ?? undefined}>
      {member.login ? (
        <img src={`https://github.com/${member.login}.png?size=40`} alt="" width={20} height={20} className="rounded-full" />
      ) : (
        <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[11px] text-accent">
          {label.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
        </span>
      )}
      {label}
      {you || owner ? <span className="text-[12px] text-muted">({[you ? "you" : null, owner ? "owner" : null].filter(Boolean).join(", ")})</span> : null}
    </li>
  );
}

export function TeamPeople({
  team,
  actions,
  roleOptions,
  defaultRole,
  githubOrg,
  resolveLogin,
}: {
  team: TeamSnapshot;
  actions: TeamClientActions;
  roleOptions: RoleOption[];
  defaultRole?: TeamRole;
  // The team's own GitHub org, whose members are suggested; null for a team made without one.
  githubOrg: string | null;
  resolveLogin?: (login: string) => Promise<string | null>;
}) {
  const [inviting, setInviting] = useState(false);
  const pending = team.pending.map((i) => inviteRow(i, team.roleLabels));
  const repos = team.projects.map((p) => p.repo);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="People">
          {team.members.map((m) => (
            <Person key={m.userId} member={m} you={m.userId === team.user.id} owner={m.role === "owner"} />
          ))}
        </ul>
        {pending.length > 0 ? <span className="text-[12.5px] text-muted">{pending.length} invited</span> : null}
        {team.canManage ? (
          <button type="button" aria-expanded={inviting} onClick={() => setInviting(!inviting)} className={`${BUTTON} ml-auto`}>
            Invite…
          </button>
        ) : null}
      </div>
      {team.canManage && inviting ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <InviteForm roleOptions={roleOptions} defaultRole={defaultRole} actions={actions} resolveLogin={resolveLogin} />
          {repos.length > 0 || githubOrg ? (
            <ProjectPeople repos={repos} org={githubOrg ?? undefined} members={team.members} pending={team.pending} actions={actions} roleOptions={roleOptions} />
          ) : null}
          {pending.length > 0 ? <PendingInvites invites={pending} roleLabels={team.roleLabels} actions={actions} /> : null}
        </div>
      ) : null}
    </>
  );
}
