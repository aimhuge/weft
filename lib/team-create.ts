// Make a new workspace the caller owns (POST /api/teams {action:"create"} and the createTeam server action),
// or rename one they own ({action:"rename"} through runTeamOp, and the renameTeam server action).
// The slug mirrors private.org_slug_for: slugify, skip lib/reserved-slugs.ts names, -2, -3... on a clash.
import "server-only";
import { setCurrentOrg, slugify } from "@aimhuge/teams";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReservedWorkspaceSlug } from "./reserved-slugs";
import { TEAM_NAME_MAX, type NewTeamResult, type TeamActionResult } from "./team-types";
import type { TeamContext } from "./teams";
import { serviceClient, type WebUser } from "./web-session";

async function freeSlug(service: SupabaseClient, name: string): Promise<string> {
  const base = slugify(name).slice(0, 40).replace(/-+$/, "") || "workspace";
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (isReservedWorkspaceSlug(candidate)) continue;
    const { data } = await service.from("orgs").select("id").eq("slug", candidate).maybeSingle<{ id: string }>();
    if (!data) return candidate;
  }
}

const badName = (name: string) => name.length < 1 || name.length > TEAM_NAME_MAX;
const NAME_RULE = `Name the team in 1 to ${TEAM_NAME_MAX} characters.`;

export async function runCreateTeam(user: WebUser, nameRaw: string): Promise<NewTeamResult> {
  const name = nameRaw.trim();
  if (badName(name)) return { ok: false, message: NAME_RULE };
  const service = serviceClient();
  if (!service) return { ok: false, message: "Teams aren't set up on this Weft." };
  const slug = await freeSlug(service, name);
  const created: { data: { id: string } | null; error: { message: string } | null } = await service
    .from("orgs")
    .insert({ slug, name })
    .select("id")
    .single<{ id: string }>();
  const org = created.data;
  if (created.error || !org) return { ok: false, message: `Could not create team: ${created.error?.message ?? "unknown"}` };
  const { error: memberError } = await service.from("org_memberships").insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (memberError) {
    await service.from("orgs").delete().eq("id", org.id);
    return { ok: false, message: `Could not create team: ${memberError.message}` };
  }
  await setCurrentOrg(service, user.id, org.id);
  return { ok: true, message: `Created ${name}.`, slug };
}

// Only the name changes: the slug is in every link, invite and synced board, so it stays.
export async function runRenameTeam(ctx: TeamContext, nameRaw: string): Promise<TeamActionResult> {
  if (ctx.role !== "owner") return { ok: false, message: "Only an owner can rename the team." };
  const name = nameRaw.trim();
  if (badName(name)) return { ok: false, message: NAME_RULE };
  const { error } = await ctx.service.from("orgs").update({ name }).eq("id", ctx.org.id);
  if (error) return { ok: false, message: `Could not rename the team: ${error.message}` };
  return { ok: true, message: `Renamed to ${name}.` };
}
