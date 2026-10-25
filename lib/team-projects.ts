// A team's projects: the GitHub repos ("owner/name") linked to a workspace (public.org_projects). Split out of
// lib/team-ops.ts, which dispatches link-project / unlink-project here. Owners and admins link and unlink;
// who else sees each project is lib/team-project-access.ts.
import "server-only";
import { roleCan } from "@aimhuge/teams";
import type { TeamContext } from "./teams";
import { REPO_PATTERN, type TeamActionResult, type TeamProject } from "./team-types";

type ProjectRow = { repo: string; created_at: string; added_by: string | null };

// The workspace's projects, sorted by repo.
export async function listTeamProjects(ctx: TeamContext): Promise<Omit<TeamProject, "access">[]> {
  const { data } = await ctx.service
    .from("org_projects")
    .select("repo, created_at, added_by")
    .eq("org_id", ctx.org.id)
    .order("repo", { ascending: true });
  const rows = (data ?? []) as ProjectRow[];
  return rows
    .map((r) => ({ repo: r.repo, addedAt: r.created_at, addedBy: r.added_by }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

// Link a repo to the workspace. Idempotent: linking one that is already there says so and changes nothing.
export async function runLinkProject(ctx: TeamContext, repoRaw: string): Promise<TeamActionResult> {
  if (!roleCan(ctx.role, "members.manage")) return { ok: false, message: "You don't have permission to link projects." };
  const repo = repoRaw.trim();
  if (!REPO_PATTERN.test(repo)) return { ok: false, message: "Use the owner/name form, like acme/site." };
  const { data: existing } = await ctx.service
    .from("org_projects")
    .select("repo")
    .eq("org_id", ctx.org.id)
    .eq("repo", repo)
    .maybeSingle<{ repo: string }>();
  if (existing) return { ok: true, message: "Already linked." };
  const { error } = await ctx.service.from("org_projects").insert({ org_id: ctx.org.id, repo, added_by: ctx.user.id });
  if (error) return { ok: false, message: `Could not link project: ${error.message}` };
  return { ok: true, message: `Linked ${repo}.` };
}

// Unlink a repo. Idempotent too: deleting a row that isn't there is fine.
export async function runUnlinkProject(ctx: TeamContext, repoRaw: string): Promise<TeamActionResult> {
  if (!roleCan(ctx.role, "members.manage")) return { ok: false, message: "You don't have permission to unlink projects." };
  const repo = repoRaw.trim();
  if (!REPO_PATTERN.test(repo)) return { ok: false, message: "Use the owner/name form, like acme/site." };
  const { error } = await ctx.service.from("org_projects").delete().eq("org_id", ctx.org.id).eq("repo", repo);
  if (error) return { ok: false, message: `Could not unlink project: ${error.message}` };
  return { ok: true, message: `Unlinked ${repo}.` };
}
