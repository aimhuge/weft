// The member-mutating behavior of lib/team-ops.ts: runChangeRole, runRemove,
// and runRevokeInvite — the three ops that operate on a row already inside
// the org. runInvite (creating one) and the snapshot+dispatch tests live in
// lib/team-ops.test.ts; together they cover every TeamOp's success and
// failure mode. The harness (USER, ORG, makeService) is shared via
// lib/team-ops.harness.ts; module state is per-test file, so the vi.mock
// setup is duplicated.
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({
  roleCan: vi.fn(),
  roleAtLeast: vi.fn(),
}));

const teamsModMock = vi.hoisted(() => ({
  roleOptions: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("./teams", () => teamsModMock);
// Team's Stripe quantity follows the roster (lib/billing/seats.ts, tested beside it); here only that it's asked.
const seatsMock = vi.hoisted(() => ({ syncTeamSeatsQuietly: vi.fn() }));
vi.mock("./billing/seats", () => seatsMock);

import { runChangeRole, runRemove, runRevokeInvite } from "./team-ops";
import { ORG, USER, actorAtLeast, makeService } from "./team-ops.harness";

const CTX = { user: USER, org: ORG, role: "owner" as const, orgs: [ORG], service: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.roleOptions.mockImplementation((r: string) =>
    r === "owner" ? [{ role: "owner" }, { role: "admin" }, { role: "member" }] : r === "admin" ? [{ role: "admin" }, { role: "member" }] : [],
  );
  teamsMock.roleCan.mockImplementation((role: string, perm: string) => role !== "member" && perm === "members.manage");
  teamsMock.roleAtLeast.mockImplementation((actor: string, target: string) => actorAtLeast(actor, target));
  teamsModMock.revokeInvite.mockResolvedValue(undefined);
});

// ─── runChangeRole ───────────────────────────────────────────────────────

describe("runChangeRole", () => {
  it("refuses when the actor lacks members.manage", async () => {
    const ctx = { ...CTX, role: "member" as const, service: { from: vi.fn() } as never };
    expect(await runChangeRole(ctx, "u2", "admin")).toEqual({ ok: false, message: "You don't have permission to change roles." });
  });

  it("rejects a missing user id", async () => {
    expect(await runChangeRole(CTX, "", "admin")).toEqual({ ok: false, message: "Missing member id." });
  });

  it("rejects changing your own role", async () => {
    expect(await runChangeRole(CTX, USER.id, "admin")).toEqual({ ok: false, message: "You can't change your own role. Hand the workspace to someone else first." });
  });

  it("rejects a role the actor cannot assign", async () => {
    const ctx = { ...CTX, role: "admin" as const, service: { from: vi.fn() } as never };
    teamsModMock.roleOptions.mockReturnValue([{ role: "admin" }, { role: "member" }]);
    expect(await runChangeRole(ctx, "u2", "owner")).toEqual({ ok: false, message: "You can't assign the owner role." });
  });

  it("rejects a target that isn't a member", async () => {
    const svc = makeService({ org_memberships: [] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runChangeRole(ctx, "u2", "admin")).toEqual({ ok: false, message: "That person isn't a member of this workspace." });
  });

  it("rejects re-rolling a target at or above the actor", async () => {
    teamsMock.roleAtLeast.mockReturnValue(false);
    const svc = makeService({ org_memberships: [{ role: "owner" }] });
    const ctx = { ...CTX, role: "admin" as const, service: svc.client as never };
    expect(await runChangeRole(ctx, "u2", "admin")).toEqual({ ok: false, message: "You can't change the role of someone at or above your own." });
  });

  it("refuses to demote the only owner", async () => {
    // First call to org_memberships returns the target's current role; the second (count) returns 1.
    let orgMembershipCalls = 0;
    const from = vi.fn((table: string) => {
      if (table !== "org_memberships") throw new Error(`unexpected table ${table}`);
      orgMembershipCalls += 1;
      const isCount = orgMembershipCalls === 2;
      const chain: Record<string, unknown> = {};
      const then = (resolve: (v: unknown) => void) =>
        Promise.resolve(isCount ? { data: null, error: null, count: 1 } : { data: { role: "owner" }, error: null }).then(resolve);
      for (const m of ["select", "eq", "in", "is", "maybeSingle", "single", "order", "limit"]) chain[m] = vi.fn(() => chain);
      Object.defineProperty(chain, "then", { value: then, configurable: true });
      return chain;
    });
    const ctx = { ...CTX, service: { from } as never };
    expect(await runChangeRole(ctx, "u2", "admin")).toEqual({ ok: false, message: "You can't demote the workspace's only owner. Promote someone else first." });
  });

  it("updates the role and returns ok on success", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: null } });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runChangeRole(ctx, "u2", "admin")).toEqual({ ok: true, message: "Role updated." });
  });

  it("reports an error when the update fails", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: { message: "boom" } } });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runChangeRole(ctx, "u2", "admin")).toEqual({ ok: false, message: "Could not change role: boom" });
  });
});

// ─── runRemove ───────────────────────────────────────────────────────────

describe("runRemove", () => {
  it("rejects a missing user id", async () => {
    expect(await runRemove(CTX, "")).toEqual({ ok: false, message: "Missing member id." });
  });

  it("refuses a member-role actor from removing someone else", async () => {
    const ctx = { ...CTX, role: "member" as const, service: { from: vi.fn() } as never };
    expect(await runRemove(ctx, "u2")).toEqual({ ok: false, message: "You don't have permission to remove members." });
  });

  it("rejects a target that isn't a member", async () => {
    const svc = makeService({ org_memberships: [] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRemove(ctx, "u2")).toEqual({ ok: false, message: "That person isn't a member of this workspace." });
  });

  it("rejects removing someone at or above the actor", async () => {
    teamsMock.roleAtLeast.mockReturnValue(false);
    const svc = makeService({ org_memberships: [{ role: "owner" }] });
    const ctx = { ...CTX, role: "admin" as const, service: svc.client as never };
    expect(await runRemove(ctx, "u2")).toEqual({ ok: false, message: "You can't remove someone at or above your own role." });
  });

  it("refuses to let the only owner leave", async () => {
    let orgMembershipCalls = 0;
    const from = vi.fn((table: string) => {
      if (table !== "org_memberships") throw new Error(`unexpected table ${table}`);
      orgMembershipCalls += 1;
      const isCount = orgMembershipCalls === 2;
      const chain: Record<string, unknown> = {};
      const then = (resolve: (v: unknown) => void) =>
        Promise.resolve(isCount ? { data: null, error: null, count: 1 } : { data: { role: "owner" }, error: null }).then(resolve);
      for (const m of ["select", "eq", "in", "is", "maybeSingle", "single", "order", "limit"]) chain[m] = vi.fn(() => chain);
      Object.defineProperty(chain, "then", { value: then, configurable: true });
      return chain;
    });
    const ctx = { ...CTX, service: { from } as never };
    expect(await runRemove(ctx, USER.id)).toEqual({ ok: false, message: "You can't leave the workspace as its only owner. Promote someone else first." });
  });

  it("lets the actor remove someone else", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: null } });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRemove(ctx, "u2")).toEqual({ ok: true, message: "Removed." });
    expect(seatsMock.syncTeamSeatsQuietly).toHaveBeenCalledWith(svc.client, ORG, USER.email);
  });

  it("lets the actor leave a workspace they're a member of", async () => {
    const svc = makeService({ org_memberships: [{ role: "admin" }] }, {}, { org_memberships: { error: null } });
    const ctx = { ...CTX, role: "admin" as const, service: svc.client as never };
    expect(await runRemove(ctx, USER.id)).toEqual({ ok: true, message: "You left the workspace." });
    expect(seatsMock.syncTeamSeatsQuietly).toHaveBeenCalledTimes(1);
  });

  it("reports an error when the delete fails", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: { message: "boom" } } });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRemove(ctx, "u2")).toEqual({ ok: false, message: "Could not remove member: boom" });
  });
});

// ─── runRevokeInvite ─────────────────────────────────────────────────────

describe("runRevokeInvite", () => {
  it("refuses when the actor lacks members.manage", async () => {
    const ctx = { ...CTX, role: "member" as const, service: { from: vi.fn() } as never };
    expect(await runRevokeInvite(ctx, "i1")).toEqual({ ok: false, message: "You don't have permission to revoke invites." });
  });

  it("rejects a missing invite id", async () => {
    expect(await runRevokeInvite(CTX, "")).toEqual({ ok: false, message: "Missing invite id." });
  });

  it("refuses to revoke an invite from another org", async () => {
    const svc = makeService({ invitations: [{ org_id: "o2" }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRevokeInvite(ctx, "i1")).toEqual({ ok: false, message: "That invite isn't from this workspace." });
    expect(teamsModMock.revokeInvite).not.toHaveBeenCalled();
  });

  it("refuses when the invite row is missing", async () => {
    const svc = makeService({ invitations: [] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRevokeInvite(ctx, "i1")).toEqual({ ok: false, message: "That invite isn't from this workspace." });
  });

  it("revokes the invite on success", async () => {
    const svc = makeService({ invitations: [{ org_id: ORG.id }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRevokeInvite(ctx, "i1")).toEqual({ ok: true, message: "Invite revoked." });
    expect(teamsModMock.revokeInvite).toHaveBeenCalledWith(svc.client, "i1");
  });

  it("reports an error when revokeInvite throws", async () => {
    teamsModMock.revokeInvite.mockRejectedValue(new Error("nope"));
    const svc = makeService({ invitations: [{ org_id: ORG.id }] });
    const ctx = { ...CTX, service: svc.client as never };
    expect(await runRevokeInvite(ctx, "i1")).toEqual({ ok: false, message: "Could not revoke invite: nope" });
  });
});