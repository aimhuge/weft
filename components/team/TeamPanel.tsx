"use client";

// The team picked in Settings → Teams' list, in the order a team is used: its Projects (each repo with its cards
// on this board), then its People (GitHub avatars and @logins, Invite…), then "Advanced", closed by default: roles
// and Remove (./Roster), who sees each project (./ProjectAccess) and Leave. Workers get a section once teams have
// them. The same Roster / InviteForm / PendingInvites / LeaveButton the weft.zip team page uses, through the
// `actions` the desktop posts to /api/account/team.
import { call } from "@/lib/client-api";
import type { GithubOrg } from "@/lib/github-orgs";
import { orgForTeam } from "@/lib/team-view";
import { ROLE_DESCRIPTIONS, type TeamClientActions, type TeamRole, type TeamSnapshot } from "@/lib/team-types";
import type { BoardProjects } from "@/lib/use-board-repos";
import { useOrgRepos } from "@/lib/use-github-orgs";
import type { RoleOption } from "./InviteForm";
import { LeaveButton } from "./LeaveButton";
import { ProjectAccessList } from "./ProjectAccess";
import { Projects } from "./Projects";
import { Roster } from "./Roster";
import { Section, SUBTLE } from "./SettingsSection";
import { TeamPeople } from "./TeamPeople";

// Invite as Member unless the list doesn't offer it; the list leads with Owner, too much to hand out by default.
function defaultInviteRole(opts: RoleOption[]): TeamRole | undefined {
  return opts.some((o) => o.role === "member") ? "member" : opts[0]?.role;
}

// An @login's public email, through gh on this Mac (GET /api/github/collaborators?login=).
const resolveLogin = (login: string) =>
  call<{ email: string | null }>("GET", `/api/github/collaborators?login=${encodeURIComponent(login)}`)
    .then((r) => r.email)
    .catch(() => null);

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function TeamPanel({
  team,
  actions,
  board,
  githubOrgs = [],
}: {
  team: TeamSnapshot;
  actions: TeamClientActions;
  board: BoardProjects;
  githubOrgs?: GithubOrg[];
}) {
  const isOwner = team.role === "owner";
  // Weft's own words for each role, even before weft.zip's copy of them is deployed.
  const roleOptions: RoleOption[] = team.roleOptions.map((o) => ({ role: o.role, label: o.label, description: ROLE_DESCRIPTIONS[o.role] }));
  const githubOrg = orgForTeam(team.org.slug, githubOrgs)?.login ?? null;
  const orgRepos = useOrgRepos(team.canManage ? githubOrg : null);
  const counts = [plural(team.projects.length, "project"), team.members.length === 1 ? "1 person" : `${team.members.length} people`];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 pt-3">
        <h3 className="text-[18px] font-semibold text-ink">{team.org.name}</h3>
        <span className="text-[13px] text-ink/80">{counts.join(" · ")}</span>
      </div>

      <Section title="Projects">
        <Projects projects={team.projects} canManage={team.canManage} actions={actions} boardRepos={[...orgRepos, ...board.repos]} cards={board.cards} org={team.org} members={team.members.length} />
      </Section>

      <Section title="People">
        <TeamPeople
          team={team}
          actions={actions}
          roleOptions={roleOptions}
          defaultRole={defaultInviteRole(roleOptions)}
          githubOrg={githubOrg}
          resolveLogin={resolveLogin}
        />
      </Section>

      <Section>
        <details>
          <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">Advanced: roles, project access{isOwner ? "" : ", leave"}</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Roster members={team.members} canManage={team.canManage} roleOptions={roleOptions} currentUserId={team.user.id} actions={actions} />
            {team.canManage ? <ProjectAccessList projects={team.projects} members={team.members} actions={actions} /> : null}
            {!isOwner ? (
              <div>
                <p className={`${SUBTLE} mb-3`}>
                  Leave {team.org.name}: you&apos;ll lose access to its boards, billing and shared vaults. You can be re-invited later.
                </p>
                <LeaveButton userId={team.user.id} actions={actions} />
              </div>
            ) : null}
          </div>
        </details>
      </Section>
    </>
  );
}
