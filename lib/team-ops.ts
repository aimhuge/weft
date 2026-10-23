// The team snapshot and member-mutating operations, shared by weft.zip's
// server actions (lib/team-actions.ts) and the /api/teams JSON route. The
// package's `requireOrg` and "use cache"-bound server actions are broken
// under Next 16 (docs/architecture/teams.md), so we re-implement the gate
// in lib/teams.ts and these ops run against the same TeamContext. The
// behavior — permissions, last-owner rule, self rules, and every error
// message — is identical to the previous server-action version; the move
// only splits each op into its own function so the route can call them
// directly without going through a "use server" boundary.
import "server-only";
import { listOrgMembers, listPendingInvites, roleAtLeast, roleCan, roleLabel } from "@aimhuge/teams";
import type { TeamContext } from "./teams";
import { createInvite, inviteMailer, isPlausibleEmail, normalizeEmail, revokeInvite as revokeInviteRow, roleOptions } from "./teams";
import { runRenameTeam } from "./team-create";
import { runDeleteTeam } from "./team-delete";
import { listTeamProjects, runLinkProject, runUnlinkProject } from "./team-projects";
import { workspaceCanHaveMembers } from "./billing/plan-gate";
import type { TeamActionResult, TeamInvite, TeamMember, TeamOp, TeamOrg, TeamSnapshot, TeamUser } from "./team-types";

// What a Free workspace is told when it tries to bring someone in. One string so the invite op and the team
// page's upsell can't drift apart. It names Pro, not Team: Pro already carries the seats, so it is the
// cheaper way to unlock this, and the wording does not tell a Pro subscriber to buy a bigger plan.
export const TEAM_GATE_MESSAGE = "Teams are part of Pro. Upgrade this workspace to invite members — or to Team, at $9 a seat.";

// A two-line answer: both server actions and the API wrap a result in
// { ok, message? }. The plain helper keeps the call sites from re-typing
// the shape (and the eslint "no-unnecessary-condition" pass is happier with
// one place to audit).
function ok(message: string): TeamActionResult {
  return { ok: true, message };
}
function fail(message: string): TeamActionResult {
  return { ok: false, message };
}

// What every TeamSnapshot starts with: the viewer, the org, their role,
// the rest of their workspaces, and the management bit. Pulled out so
// teamSnapshot can compose it with the member/invite reads below.
function snapshotCore(ctx: TeamContext) {
  const user: TeamUser = {
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    avatar: ctx.user.avatar,
  };
  const org: TeamOrg = { id: ctx.org.id, slug: ctx.org.slug, name: ctx.org.name };
  const orgs: TeamOrg[] = ctx.orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, role: ctx.orgRoles?.[o.id] ?? (o.id === ctx.org.id ? ctx.role : undefined) }));
  const canManage = roleCan(ctx.role, "members.manage");
  // roleOptions gives the assignable roles for THIS actor (an owner sees
  // all three, an admin sees admin+member, a member sees none); roleLabels
  // is the unfiltered map so the read-only roster can label every row.
  const roleOptionsList = roleOptions(ctx.role).map((o) => ({ role: o.role, label: o.label, description: o.description }));
  const roleLabels = { owner: roleLabel("owner"), admin: roleLabel("admin"), member: roleLabel("member") };
  return { user, org, role: ctx.role, orgs, canManage, roleOptions: roleOptionsList, roleLabels };
}

// The "this email already has a Weft account" branch of inviteMember. Two
// outcomes: they're already a member of THIS org (say so), or they're a
// member of Weft but not of this org (add them straight in, no email —
// they already opted in by signing up, so the seat is the only thing
// they're taking). Returns the action's verdict, or null to fall through
// to the "no account yet" invite-by-email path. The caller (server action
// or API route) revalidates the team page on success.
async function addExistingAccount(
  ctx: TeamContext,
  profile: { id: string },
  role: TeamContext["role"],
  email: string,
): Promise<TeamActionResult | null> {
  const { data: existingMember } = await ctx.service
    .from("org_memberships")
    .select("user_id")
    .eq("org_id", ctx.org.id)
    .eq("user_id", profile.id)
    .maybeSingle<{ user_id: string }>();
  if (existingMember) return ok("Already on the team.");
  const { error } = await ctx.service
    .from("org_memberships")
    .insert({ org_id: ctx.org.id, user_id: profile.id, role });
  if (error) return fail(`Could not add member: ${error.message}`);
  return ok(`Added ${email}.`);
}

// The whole snapshot the team page renders. members + (when canManage)
// pending invites, in parallel. RLS is off on `org_memberships` and
// `invitations`, so the service client is required; the cookie-bound
// client reads nothing here.
export async function teamSnapshot(ctx: TeamContext): Promise<TeamSnapshot> {
  const core = snapshotCore(ctx);
  const [members, pending, projects] = await Promise.all([
    listOrgMembers(ctx.service, ctx.org.id),
    core.canManage ? listPendingInvites(ctx.service, ctx.org.id) : Promise.resolve([]),
    listTeamProjects(ctx),
  ]);
  const memberRows: TeamMember[] = members.map((m) => ({
    userId: m.user_id,
    email: m.email,
    name: m.display_name,
    role: m.role,
    joinedAt: m.created_at,
  }));
  const inviteRows: TeamInvite[] = pending.map((i) => ({
    id: i.id,
    email: i.invited_email,
    role: i.role,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }));
  return { ...core, members: memberRows, pending: inviteRows, projects };
}

// ─── invite ──────────────────────────────────────────────────────────────

// Everything an invite can be turned away for before it costs anything: the
// actor's role, the address, the role being assigned, and the self-invite. All
// synchronous and free, so they run before the plan read and the profile
// lookup. Returns the normalized email to invite, or the failure to show.
function checkInvite(
  ctx: TeamContext,
  emailRaw: string,
  role: TeamContext["role"],
): { email: string } | TeamActionResult {
  if (!roleCan(ctx.role, "members.manage")) return fail("You don't have permission to invite members.");
  if (!isPlausibleEmail(emailRaw)) return fail("Enter a valid email address.");
  const allowed = roleOptions(ctx.role).map((o) => o.role);
  if (!allowed.includes(role)) return fail(`You can't assign the ${role} role.`);
  const email = normalizeEmail(emailRaw);
  // Self-invite is a no-op; say so instead of pretending.
  if (ctx.user.email && normalizeEmail(ctx.user.email) === email) return fail("That's you.");
  return { email };
}

// Tells a { email } (ok) from a TeamActionResult (a failure). "email" is in one
// and not the other, so the presence of the key is the discriminant.
function isInviteFailure(r: { email: string } | TeamActionResult): r is TeamActionResult {
  return !("email" in r);
}

// Invite by email. If the address already has a profile, add them straight
// in (no email); otherwise mint a pending invite and email it. The mailer
// is required for the "no account yet" path; without it the action returns
// a clear error rather than a silently-dropped invite.
export async function runInvite(ctx: TeamContext, emailRaw: string, role: TeamContext["role"]): Promise<TeamActionResult> {
  const checked = checkInvite(ctx, emailRaw, role);
  if (isInviteFailure(checked)) return checked;
  const { email } = checked;
  // Teams are paid: a Free workspace stays a team of one. After the free
  // checks, and before the profile lookup and the mailer, so a locked
  // workspace costs nothing and never sends a half-accepted invite. The role
  // check above still comes first, so a member is told about their role, not
  // the plan.
  if (!(await workspaceCanHaveMembers(ctx.service, ctx.org.id))) return fail(TEAM_GATE_MESSAGE);
  // Look up an existing profile by normalized email. The publishable key
  // can't read profiles here (RLS scopes it to the cookie's user), so this
  // goes through the service client.
  const { data: existingProfile } = await ctx.service
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle<{ id: string }>();
  if (existingProfile) {
    const result = await addExistingAccount(ctx, existingProfile, role, email);
    if (result) return result;
  }
  // No account yet: the email is the only way in. Refuse cleanly if the
  // mailer isn't set up — the alternative is a silent drop, which would
  // confuse the inviter.
  const mailer = inviteMailer();
  if (!mailer) return fail("Email isn't set up on this Weft (RESEND_API_KEY).");
  try {
    const { alreadyPending } = await createInvite({
      service: ctx.service,
      orgId: ctx.org.id,
      orgName: ctx.org.name,
      orgSlug: ctx.org.slug,
      invitedEmail: email,
      role,
      invitedBy: ctx.user.id,
      inviterEmail: ctx.user.email,
      email: mailer,
      appName: "Weft",
    });
    return ok(alreadyPending ? `Invite re-sent… (${email})` : `Invite sent to ${email}.`);
  } catch (err) {
    return fail(`Could not create invite: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

// ─── change role ─────────────────────────────────────────────────────────

// Re-role an existing member. The actor can only set roles they could
// assign themselves (assignableRoles) and only touch members whose current
// role is at or below the actor's (roleAtLeast). An owner can't be demoted
// away from being the last owner.
export async function runChangeRole(ctx: TeamContext, userId: string, newRole: TeamContext["role"]): Promise<TeamActionResult> {
  if (!roleCan(ctx.role, "members.manage")) return fail("You don't have permission to change roles.");
  if (!userId) return fail("Missing member id.");
  if (userId === ctx.user.id) return fail("You can't change your own role. Hand the workspace to someone else first.");
  const allowed = roleOptions(ctx.role).map((o) => o.role);
  if (!allowed.includes(newRole)) return fail(`You can't assign the ${newRole} role.`);
  const { data: target } = await ctx.service
    .from("org_memberships")
    .select("role")
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return fail("That person isn't a member of this workspace.");
  if (!roleAtLeast(ctx.role, target.role as TeamContext["role"])) {
    return fail("You can't change the role of someone at or above your own.");
  }
  // Never leave the org with zero owners: count the remaining owners if
  // we're about to demote one.
  if (target.role === "owner" && newRole !== "owner") {
    const { count } = await ctx.service
      .from("org_memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) return fail("You can't demote the workspace's only owner. Promote someone else first.");
  }
  const { error } = await ctx.service
    .from("org_memberships")
    .update({ role: newRole })
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId);
  if (error) return fail(`Could not change role: ${error.message}`);
  return ok("Role updated.");
}

// ─── remove (or self-leave) ──────────────────────────────────────────────

// Remove a member, or yourself (leave). Self-leave is always allowed unless
// it would strand the workspace with no owners. Clearing
// `profiles.current_org_id` keeps the switcher from pointing at an org the
// user is no longer in.
export async function runRemove(ctx: TeamContext, userId: string): Promise<TeamActionResult> {
  if (!userId) return fail("Missing member id.");
  const isSelf = userId === ctx.user.id;
  if (!isSelf && !roleCan(ctx.role, "members.manage")) {
    return fail("You don't have permission to remove members.");
  }
  const { data: target } = await ctx.service
    .from("org_memberships")
    .select("role")
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return fail("That person isn't a member of this workspace.");
  // The actor must be at least as senior as the target — but only when the
  // actor isn't leaving themselves.
  if (!isSelf && !roleAtLeast(ctx.role, target.role as TeamContext["role"])) {
    return fail("You can't remove someone at or above your own role.");
  }
  // Last owner check applies to self-leave too: a sole owner can't leave
  // without first handing the workspace to someone else.
  if (target.role === "owner") {
    const { count } = await ctx.service
      .from("org_memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) return fail("You can't leave the workspace as its only owner. Promote someone else first.");
  }
  const { error } = await ctx.service
    .from("org_memberships")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId);
  if (error) return fail(`Could not remove member: ${error.message}`);
  // Clear the active-workspace pointer if it named this org. Best-effort:
  // the membership is already gone, so the worst case is a switcher that
  // points at a workspace the user can no longer open, which the gate
  // will heal.
  await ctx.service.from("profiles").update({ current_org_id: null }).eq("id", userId).eq("current_org_id", ctx.org.id);
  return ok(isSelf ? "You left the workspace." : "Removed.");
}

// ─── revoke invite ───────────────────────────────────────────────────────

// Revoke a pending invite. The invite must belong to the same org as the
// ctx (membership writes would let a malicious actor revoke invites for an
// org they don't belong to otherwise — they can't, because the gate already
// filters by orgSlug, but the belt-and-braces check is cheap).
export async function runRevokeInvite(ctx: TeamContext, inviteId: string): Promise<TeamActionResult> {
  if (!roleCan(ctx.role, "members.manage")) return fail("You don't have permission to revoke invites.");
  if (!inviteId) return fail("Missing invite id.");
  const { data: invite } = await ctx.service.from("invitations").select("org_id").eq("id", inviteId).maybeSingle();
  if (!invite || invite.org_id !== ctx.org.id) return fail("That invite isn't from this workspace.");
  try {
    await revokeInviteRow(ctx.service, inviteId);
  } catch (err) {
    return fail(`Could not revoke invite: ${err instanceof Error ? err.message : "unknown"}`);
  }
  return ok("Invite revoked.");
}

// Dispatch a TeamOp to the right run* helper. The op is the request body's
// validated shape (lib/team-ops.ts is the only place the wire-format maps
// to a function). Anything not handled here is a programmer error, not a
// 4xx — the route's parser already rejected unknown shapes.
export async function runTeamOp(ctx: TeamContext, op: TeamOp): Promise<TeamActionResult> {
  switch (op.action) {
    case "invite":
      return runInvite(ctx, op.email, op.role);
    case "role":
      return runChangeRole(ctx, op.userId, op.role);
    case "remove":
      return runRemove(ctx, op.userId);
    case "revoke":
      return runRevokeInvite(ctx, op.inviteId);
    case "link-project":
      return runLinkProject(ctx, op.repo);
    case "unlink-project":
      return runUnlinkProject(ctx, op.repo);
    case "rename":
      return runRenameTeam(ctx, op.name);
    case "delete":
      return runDeleteTeam(ctx, op.confirm);
    default: {
      // Unreachable as long as TeamOp's union covers every action the
      // route parses; if a new variant is added without a runner, this
      // fails loudly instead of silently returning undefined.
      const exhaustive: never = op;
      throw new Error(`Unknown team op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
