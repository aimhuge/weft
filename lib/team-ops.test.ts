// The shared core both server actions (lib/team-actions.ts) and /api/teams
// call: teamSnapshot (the page render), runInvite (creating a member), and
// runTeamOp dispatch. The role-row mutations (runChangeRole, runRemove,
// runRevokeInvite) are in lib/team-ops-members.test.ts. The behavior —
// permissions, last-owner rule, self rules and every error message — is the
// same as the previous server-action version; the move only splits each op
// into its own function. Fixtures (USER, ORG, makeService) come from
// lib/team-ops.harness.ts; the @aimhuge/teams shim and the ./teams shim (for
// inviteMailer, isPlausibleEmail, normalizeEmail, roleOptions, createInvite,
// revokeInvite) are local to this file because module state is per-test
// file.
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({
  listOrgMembers: vi.fn(),
  listPendingInvites: vi.fn(),
  roleCan: vi.fn(),
  roleAtLeast: vi.fn(),
  roleLabel: vi.fn(),
  assignableRoles: vi.fn(),
}));

const teamsModMock = vi.hoisted(() => ({
  inviteMailer: vi.fn(),
  isPlausibleEmail: vi.fn(),
  normalizeEmail: vi.fn(),
  roleOptions: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("./teams", () => teamsModMock);

const projectsMock = vi.hoisted(() => ({
  listTeamProjects: vi.fn(),
  runLinkProject: vi.fn(),
  runUnlinkProject: vi.fn(),
}));
vi.mock("./team-projects", () => projectsMock);
const createMock = vi.hoisted(() => ({ runRenameTeam: vi.fn() }));
vi.mock("./team-create", () => createMock);
const deleteMock = vi.hoisted(() => ({ runDeleteTeam: vi.fn() }));
vi.mock("./team-delete", () => deleteMock);

import { runInvite, runTeamOp, teamSnapshot, TEAM_GATE_MESSAGE } from "./team-ops";
import { ORG, USER, actorAtLeast, makeService } from "./team-ops.harness";

const CTX = { user: USER, org: ORG, role: "owner" as const, orgs: [ORG], service: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.inviteMailer.mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) });
  teamsModMock.isPlausibleEmail.mockImplementation((s: string) => /.+@.+\..+/.test(s));
  teamsModMock.normalizeEmail.mockImplementation((s: string) => s.trim().toLowerCase());
  teamsModMock.roleOptions.mockImplementation((r: string) =>
    r === "owner" ? [{ role: "owner" }, { role: "admin" }, { role: "member" }] : r === "admin" ? [{ role: "admin" }, { role: "member" }] : [],
  );
  teamsMock.roleCan.mockImplementation((role: string, perm: string) => role !== "member" && perm === "members.manage");
  teamsMock.roleAtLeast.mockImplementation((actor: string, target: string) => actorAtLeast(actor, target));
  teamsMock.roleLabel.mockImplementation((r: string) => r.charAt(0).toUpperCase() + r.slice(1));
  teamsMock.assignableRoles.mockImplementation((r: string) => (r === "owner" ? ["owner", "admin", "member"] : r === "admin" ? ["admin", "member"] : []));
  teamsMock.listOrgMembers.mockResolvedValue([]);
  teamsMock.listPendingInvites.mockResolvedValue([]);
  projectsMock.listTeamProjects.mockResolvedValue([]);
  teamsModMock.createInvite.mockResolvedValue({ invitation: { id: "i1" }, alreadyPending: false });
});

// ─── teamSnapshot ────────────────────────────────────────────────────────

describe("teamSnapshot", () => {
  it("builds the core (user, org, role, orgs, roleOptions, roleLabels) from the ctx", async () => {
    const ctx = { ...CTX, service: { from: vi.fn() } as never };
    const snap = await teamSnapshot(ctx);
    expect(snap.user).toEqual({ id: USER.id, email: USER.email, name: USER.name, avatar: USER.avatar });
    expect(snap.org).toEqual({ id: ORG.id, slug: ORG.slug, name: ORG.name });
    expect(snap.role).toBe("owner");
    expect(snap.orgs).toEqual([{ id: ORG.id, slug: ORG.slug, name: ORG.name, role: "owner" }]);
    expect(snap.canManage).toBe(true);
    expect(snap.roleOptions.map((o) => o.role)).toEqual(["owner", "admin", "member"]);
    expect(snap.roleLabels).toEqual({ owner: "Owner", admin: "Admin", member: "Member" });
    expect(snap.members).toEqual([]);
    expect(snap.pending).toEqual([]);
    expect(snap.projects).toEqual([]);
  });

  it("carries the viewer's role on each org and the team's projects", async () => {
    const other = { id: "o2", slug: "beta", name: "Beta" };
    const project = { repo: "acme/site", addedAt: "t", addedBy: null };
    projectsMock.listTeamProjects.mockResolvedValue([project]);
    const ctx = { ...CTX, orgs: [ORG, other], orgRoles: { o1: "owner" as const, o2: "member" as const }, service: {} as never };
    const snap = await teamSnapshot(ctx);
    expect(snap.orgs).toEqual([{ ...ORG, role: "owner" }, { ...other, role: "member" }]);
    expect(snap.projects).toEqual([project]);
    // Without orgRoles the current org falls back to ctx.role and the rest carry none.
    const bare = await teamSnapshot({ ...CTX, orgs: [ORG, other] });
    expect(bare.orgs).toEqual([{ ...ORG, role: "owner" }, other]);
  });

  it("maps listOrgMembers rows into TeamMember (userId/email/name/role/joinedAt)", async () => {
    teamsMock.listOrgMembers.mockResolvedValue([
      { user_id: "u2", role: "admin", created_at: "2025-01-02T00:00:00Z", email: "two@x.co", display_name: "Two", last_login_at: null },
      { user_id: "u3", role: "member", created_at: "2025-01-03T00:00:00Z", email: null, display_name: null, last_login_at: null },
    ]);
    const ctx = { ...CTX, service: { from: vi.fn() } as never };
    const snap = await teamSnapshot(ctx);
    expect(snap.members).toEqual([
      { userId: "u2", email: "two@x.co", name: "Two", role: "admin", joinedAt: "2025-01-02T00:00:00Z" },
      { userId: "u3", email: null, name: null, role: "member", joinedAt: "2025-01-03T00:00:00Z" },
    ]);
  });

  it("lists pending invites only when canManage is true", async () => {
    // Non-manager: pending is an empty list even if listPendingInvites returns rows.
    const memberCtx = { ...CTX, role: "member" as const, service: { from: vi.fn() } as never };
    teamsMock.listPendingInvites.mockResolvedValue([
      { id: "i1", org_id: ORG.id, invited_email: "a@b.co", role: "admin", created_at: "t", expires_at: "e", accepted_at: null, accepted_user_id: null, accepted_email: null, revoked_at: null, invite_token: "tok", invited_by: null },
    ]);
    expect((await teamSnapshot(memberCtx)).pending).toEqual([]);
    // Manager: pending is included.
    teamsMock.listPendingInvites.mockResolvedValue([
      { id: "i1", org_id: ORG.id, invited_email: "a@b.co", role: "admin", created_at: "2025-02-01T00:00:00Z", expires_at: "2025-02-08T00:00:00Z", accepted_at: null, accepted_user_id: null, accepted_email: null, revoked_at: null, invite_token: "tok", invited_by: null },
    ]);
    const ownerCtx = { ...CTX, service: { from: vi.fn() } as never };
    const snap = await teamSnapshot(ownerCtx);
    expect(snap.pending).toEqual([{ id: "i1", email: "a@b.co", role: "admin", createdAt: "2025-02-01T00:00:00Z", expiresAt: "2025-02-08T00:00:00Z" }]);
  });

  it("canManage is false for a member-role viewer", async () => {
    const ctx = { ...CTX, role: "member" as const, service: { from: vi.fn() } as never };
    const snap = await teamSnapshot(ctx);
    expect(snap.canManage).toBe(false);
    expect(snap.roleOptions).toEqual([]);
  });
});

// ─── runInvite ───────────────────────────────────────────────────────────

describe("runInvite", () => {
  it("refuses when the actor lacks members.manage", async () => {
    const ctx = { ...CTX, role: "member" as const, service: { from: vi.fn() } as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: "You don't have permission to invite members." });
  });

  it("rejects an invalid email", async () => {
    teamsModMock.isPlausibleEmail.mockReturnValue(false);
    expect(await runInvite(CTX, "not-an-email", "member")).toEqual({ ok: false, message: "Enter a valid email address." });
  });

  it("rejects a role the actor cannot assign", async () => {
    const ctx = { ...CTX, role: "admin" as const, service: { from: vi.fn() } as never };
    teamsModMock.roleOptions.mockReturnValue([{ role: "admin" }, { role: "member" }]);
    expect(await runInvite(ctx, "x@y.com", "owner")).toEqual({ ok: false, message: "You can't assign the owner role." });
  });

  it("refuses a self-invite", async () => {
    expect(await runInvite(CTX, "JANE@Example.com", "member")).toEqual({ ok: false, message: "That's you." });
  });

  it("adds an existing member immediately", async () => {
    const svc = makeService({ profiles: [{ id: "u2" }], org_memberships: [{ user_id: "u2" }], org_subscriptions: [{ plan: "team", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "x@y.com", "member")).toEqual({ ok: true, message: "Already on the team." });
  });

  it("adds an existing profile to the org straight in (no email)", async () => {
    const svc = makeService({ profiles: [{ id: "u2" }], org_memberships: [], org_subscriptions: [{ plan: "pro", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "x@y.com", "admin")).toEqual({ ok: true, message: "Added x@y.com." });
  });

  it("reports an insert error when adding an existing profile fails", async () => {
    const svc = makeService({ profiles: [{ id: "u2" }], org_memberships: [], org_subscriptions: [{ plan: "pro", status: "active" }] }, {}, { org_memberships: { error: { message: "boom" } } });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "x@y.com", "admin")).toEqual({ ok: false, message: "Could not add member: boom" });
  });

  it("refuses to email when RESEND_API_KEY isn't set", async () => {
    teamsModMock.inviteMailer.mockReturnValue(null);
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "pro", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: "Email isn't set up on this Weft (RESEND_API_KEY)." });
    expect(teamsModMock.createInvite).not.toHaveBeenCalled();
  });

  it("creates a new invite and emails it when no profile exists", async () => {
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "pro", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: true, message: "Invite sent to new@example.com." });
    expect(teamsModMock.createInvite).toHaveBeenCalledWith(expect.objectContaining({ invitedEmail: "new@example.com", role: "member", appName: "Weft" }));
  });

  it("says 're-sent' when createInvite reports alreadyPending", async () => {
    teamsModMock.createInvite.mockResolvedValue({ invitation: { id: "i1" }, alreadyPending: true });
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "pro", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: true, message: "Invite re-sent… (new@example.com)" });
  });

  it("reports an error when createInvite throws", async () => {
    teamsModMock.createInvite.mockRejectedValue(new Error("Resend 500"));
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "pro", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: "Could not create invite: Resend 500" });
  });

  // The plan gate (lib/billing/plan-gate.ts): teams are paid, so a Free workspace is a team of one.
  it("refuses an invite on a Free workspace, before sending anything", async () => {
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "free", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: TEAM_GATE_MESSAGE, upgrade: "teams" });
    expect(teamsModMock.createInvite).not.toHaveBeenCalled();
  });

  it("refuses an invite when the workspace has no subscription row", async () => {
    const svc = makeService({ profiles: [] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: TEAM_GATE_MESSAGE, upgrade: "teams" });
    expect(teamsModMock.createInvite).not.toHaveBeenCalled();
  });

  it("refuses an invite on a Team workspace whose payment failed", async () => {
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "team", status: "past_due" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: TEAM_GATE_MESSAGE, upgrade: "teams" });
    expect(teamsModMock.createInvite).not.toHaveBeenCalled();
  });

  it("still says 'permission' first when a member on a Free workspace tries to invite", async () => {
    // The role check runs before the plan check, so the message names the thing role alone can fix.
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "free", status: "active" }] });
    const ctx = { ...CTX, role: "member" as const, service: svc.client as never };
    expect(await runInvite(ctx, "new@example.com", "member")).toEqual({ ok: false, message: "You don't have permission to invite members." });
  });
});

// ─── runTeamOp dispatch ──────────────────────────────────────────────────

describe("runTeamOp projects", () => {
  it("dispatches link-project and unlink-project", async () => {
    projectsMock.runLinkProject.mockResolvedValue({ ok: true });
    projectsMock.runUnlinkProject.mockResolvedValue({ ok: true, message: "x" });
    expect(await runTeamOp(CTX, { org: "acme", action: "link-project", repo: "a/b" })).toEqual({ ok: true });
    expect(projectsMock.runLinkProject).toHaveBeenCalledWith(CTX, "a/b");
    expect(await runTeamOp(CTX, { org: "acme", action: "unlink-project", repo: "a/b" })).toEqual({ ok: true, message: "x" });
    expect(projectsMock.runUnlinkProject).toHaveBeenCalledWith(CTX, "a/b");
  });

  it("dispatches rename", async () => {
    createMock.runRenameTeam.mockResolvedValue({ ok: true, message: "Renamed to B." });
    expect(await runTeamOp(CTX, { org: "acme", action: "rename", name: "B" })).toEqual({ ok: true, message: "Renamed to B." });
    expect(createMock.runRenameTeam).toHaveBeenCalledWith(CTX, "B");
  });

  it("dispatches delete", async () => {
    deleteMock.runDeleteTeam.mockResolvedValue({ ok: true, message: "Deleted Acme." });
    expect(await runTeamOp(CTX, { org: "acme", action: "delete", confirm: "Acme" })).toEqual({ ok: true, message: "Deleted Acme." });
    expect(deleteMock.runDeleteTeam).toHaveBeenCalledWith(CTX, "Acme");
  });
});

describe("runTeamOp", () => {
  it("dispatches by action to the matching runner", async () => {
    const svc = makeService({ profiles: [], org_subscriptions: [{ plan: "pro", status: "active" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runTeamOp(ctx, { org: "acme", action: "invite", email: "a@b.co", role: "member" })).toEqual({ ok: true, message: "Invite sent to a@b.co." });
    const svc2 = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: null } });
    const ctx2 = { ...CTX, service: svc2.client as never };
    expect(await runTeamOp(ctx2, { org: "acme", action: "role", userId: "u2", role: "admin" })).toEqual({ ok: true, message: "Role updated." });
    const svc3 = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: null } });
    const ctx3 = { ...CTX, service: svc3.client as never };
    expect(await runTeamOp(ctx3, { org: "acme", action: "remove", userId: "u2" })).toEqual({ ok: true, message: "Removed." });
    const svc4 = makeService({ invitations: [{ org_id: ORG.id }] });
    const ctx4 = { ...CTX, service: svc4.client as never };
    expect(await runTeamOp(ctx4, { org: "acme", action: "revoke", inviteId: "i1" })).toEqual({ ok: true, message: "Invite revoked." });
  });
});