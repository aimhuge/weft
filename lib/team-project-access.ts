// Project-level access inside a team (public.org_project_members). Owners and admins see every linked project and
// grant the rest; a member sees only the projects they were granted. Split out of lib/team-projects.ts beside
// link/unlink: lib/team-ops.ts reads the snapshot's projects here and dispatches project-access ops here.
import "server-only";
import { roleCan } from "@aimhuge/teams";
import type { TeamContext } from "./teams";
import { listTeamProjects } from "./team-projects";
import { REPO_PATTERN, type TeamActionResult, type TeamProject } from "./team-types";

type GrantRow = { repo: string; user_id: string };

// Every grant in the workspace, as repo → the members who may see it.
async function grantsByRepo(ctx: TeamContext): Promise<Map<string, string[]>> {
  const { data } = await ctx.service.from("org_project_members").select("repo, user_id").eq("org_id", ctx.org.id);
  const byRepo = new Map<string, string[]>();
  for (const row of (data ?? []) as GrantRow[]) byRepo.set(row.repo, [...(byRepo.get(row.repo) ?? []), row.user_id]);
  return byRepo;
}

// The projects this viewer may see, each with who's been granted it. Those who manage the team see every project
// and every grant; a member sees only their own projects, and not who else is on them.
export async function listVisibleProjects(ctx: TeamContext): Promise<TeamProject[]> {
  const [projects, grants] = await Promise.all([listTeamProjects(ctx), grantsByRepo(ctx)]);
  if (roleCan(ctx.role, "members.manage")) return projects.map((p) => ({ ...p, access: grants.get(p.repo) ?? [] }));
  return projects.filter((p) => grants.get(p.repo)?.includes(ctx.user.id)).map((p) => ({ ...p, access: [] }));
}

// Why a grant can't go ahead, or null when it can: the project must be linked and the person a member (owners and
// admins see every project already, so there's nothing to grant them).
async function grantRefusal(ctx: TeamContext, repo: string, userId: string): Promise<string | null> {
  const [{ data: project }, { data: member }] = await Promise.all([
    ctx.service.from("org_projects").select("repo").eq("org_id", ctx.org.id).eq("repo", repo).maybeSingle<{ repo: string }>(),
    ctx.service.from("org_memberships").select("role").eq("org_id", ctx.org.id).eq("user_id", userId).maybeSingle<{ role: string }>(),
  ]);
  if (!project) return "That project isn't linked to this team.";
  if (!member) return "That person isn't a member of this workspace.";
  if (member.role !== "member") return "Owners and admins see every project already.";
  return null;
}

// Give a member access to a project, or take it away. Idempotent both ways: granting twice or revoking what isn't
// there succeeds and changes nothing.
export async function runSetProjectAccess(ctx: TeamContext, repoRaw: string, userId: string, grant: boolean): Promise<TeamActionResult> {
  if (!roleCan(ctx.role, "members.manage")) return { ok: false, message: "You don't have permission to change project access." };
  const repo = repoRaw.trim();
  if (!REPO_PATTERN.test(repo)) return { ok: false, message: "Use the owner/name form, like acme/site." };
  if (!userId) return { ok: false, message: "Missing member id." };
  if (!grant) {
    const { error } = await ctx.service.from("org_project_members").delete().eq("org_id", ctx.org.id).eq("repo", repo).eq("user_id", userId);
    if (error) return { ok: false, message: `Could not remove access: ${error.message}` };
    return { ok: true, message: `Removed access to ${repo}.` };
  }
  const refusal = await grantRefusal(ctx, repo, userId);
  if (refusal) return { ok: false, message: refusal };
  const { error } = await ctx.service
    .from("org_project_members")
    .upsert({ org_id: ctx.org.id, repo, user_id: userId, granted_by: ctx.user.id }, { onConflict: "org_id,repo,user_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: `Could not grant access: ${error.message}` };
  return { ok: true, message: `Granted access to ${repo}.` };
}
