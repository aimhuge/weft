"use client";

// The team picked in Settings → Teams' list: its name and counts, then its Projects, Members, invite form,
// pending invites and Leave, each in its own card. The same Roster / InviteForm / PendingInvites /
// LeaveButton the weft.zip team page uses, through the `actions` the desktop posts to /api/account/team.
import { InviteForm, type RoleOption } from "./InviteForm";
import { LeaveButton } from "./LeaveButton";
import { PendingInvites, inviteRow } from "./PendingInvites";
import { Projects } from "./Projects";
import { Roster } from "./Roster";
import { Section, SUBTLE } from "./SettingsSection";
import { ROLE_DESCRIPTIONS, type TeamClientActions, type TeamRole, type TeamSnapshot } from "@/lib/team-types";

// The role <select> in the roster only needs {role, label}. We hand the
// invite form the full RoleOption list (with descriptions).
function compactRoleOptions(opts: { role: TeamRole; label: string }[]): RoleOption[] {
  return opts.map((o) => ({ role: o.role, label: o.label, description: "" }));
}

// Invite as Member unless the list doesn't offer it; the list leads with Owner, too much to hand out by default.
function defaultInviteRole(opts: RoleOption[]): TeamRole | undefined {
  return opts.some((o) => o.role === "member") ? "member" : opts[0]?.role;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function TeamPanel({ team, actions, boardRepos }: { team: TeamSnapshot; actions: TeamClientActions; boardRepos: string[] }) {
  const isOwner = team.role === "owner";
  // Weft's own words for each role, even before weft.zip's copy of them is deployed.
  const roleOptions: RoleOption[] = team.roleOptions.map((o) => ({ role: o.role, label: o.label, description: ROLE_DESCRIPTIONS[o.role] }));
  const compact = compactRoleOptions(roleOptions);
  const pending = team.pending.map((i) => inviteRow(i, team.roleLabels));
  const counts = [
    plural(team.members.length, "member"),
    pending.length > 0 ? `${pending.length} invited` : null,
    plural(team.projects.length, "project"),
  ].filter(Boolean);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 pt-3">
        <h3 className="text-[18px] font-semibold text-ink">{team.org.name}</h3>
        <span className="text-[13px] text-ink/80">{counts.join(" · ")}</span>
      </div>

      <Section title="Projects">
        <Projects
          projects={team.projects}
          canManage={team.canManage}
          actions={actions}
          boardRepos={boardRepos}
          roleOptions={roleOptions}
          members={team.members}
          pending={team.pending}
          org={team.org}
        />
      </Section>

      <Section title="Members">
        <Roster members={team.members} canManage={team.canManage} roleOptions={compact} currentUserId={team.user.id} actions={actions} />
      </Section>

      {team.canManage ? (
        <Section title={`Invite to ${team.org.name}`}>
          <InviteForm roleOptions={roleOptions} defaultRole={defaultInviteRole(roleOptions)} actions={actions} />
        </Section>
      ) : null}

      {team.canManage && pending.length > 0 ? (
        <Section title="Pending invites">
          <PendingInvites invites={pending} roleLabels={team.roleLabels} actions={actions} />
        </Section>
      ) : null}

      {!isOwner ? (
        <Section title={`Leave ${team.org.name}`}>
          <p className={`${SUBTLE} mb-3`}>
            You&apos;ll lose access to its boards, billing and shared vaults. You can be re-invited later.
          </p>
          <LeaveButton userId={team.user.id} actions={actions} />
        </Section>
      ) : null}
    </>
  );
}
