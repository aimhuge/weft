import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/members.ts: the workspace's people, from the admin console. Team's seat count
// follows the roster — each change re-counts and moves the Stripe subscription's quantity — and the
// console never removes a workspace's last owner.

const { changeSubscription } = vi.hoisted(() => ({ changeSubscription: vi.fn() }));
vi.mock("./subscription-ops", () => ({ changeSubscription }));

import { fakeAdminStripe, fakeService, fakeStripeClient, fakeSubscriptionRow, NULL_DATA } from "./admin.harness";

async function load() {
  vi.resetModules();
  return import("./members");
}

// An admin context whose service client answers per table. A table registered with NULL_DATA
// answers with null data, the shape the caller has to guard.
function ctxWith(
  rowsByTable: Record<string, unknown[] | typeof NULL_DATA> = {},
  errorsByTable: Record<string, { message: string }> = {},
  writesByTable: Record<string, { error: { message: string } | null }> = {},
) {
  const { client, calls } = fakeService(rowsByTable, errorsByTable, writesByTable);
  const stripe = fakeAdminStripe({ live: fakeStripeClient() });
  return {
    ctx: { service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe as never },
    service: client,
    calls,
  };
}

// A membership row, as the console reads it.
function member(userId: string, role: string) {
  return { user_id: userId, role, created_at: "2026-01-01T00:00:00.000Z" };
}

beforeEach(() => {
  vi.clearAllMocks();
  changeSubscription.mockResolvedValue(undefined);
});

describe("listMembers", () => {
  it("is empty for a workspace with no people", async () => {
    const { listMembers } = await load();
    const { ctx } = ctxWith({ org_memberships: [] });
    expect(await listMembers(ctx)).toEqual([]);
  });

  it("lists the roster with their profiles", async () => {
    const { listMembers } = await load();
    const { ctx } = ctxWith({
      org_memberships: [member("u1", "owner"), member("u2", "member")],
      profiles: [{ id: "u1", email: "jane@example.com", name: "Jane" }],
    });
    expect(await listMembers(ctx)).toEqual([
      { userId: "u1", email: "jane@example.com", name: "Jane", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" },
      { userId: "u2", email: null, name: null, role: "member", joinedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("throws the database's message on an error", async () => {
    const { listMembers } = await load();
    const { ctx } = ctxWith({}, { org_memberships: { message: "permission denied" } });
    await expect(listMembers(ctx)).rejects.toThrow("permission denied");
  });

  it("is empty when the read comes back with nothing", async () => {
    const { listMembers } = await load();
    const { ctx } = ctxWith({ org_memberships: NULL_DATA });
    expect(await listMembers(ctx)).toEqual([]);
  });

  it("has no profile for a member the profiles table doesn't know", async () => {
    const { listMembers } = await load();
    const { ctx } = ctxWith({ org_memberships: [member("u1", "owner")], profiles: NULL_DATA });
    expect(await listMembers(ctx)).toEqual([
      { userId: "u1", email: null, name: null, role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("syncSeats", () => {
  it("does nothing for a workspace that isn't on Team", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({ org_subscriptions: [fakeSubscriptionRow({ plan: "pro" })] });
    expect(await syncSeats(ctx)).toBeNull();
    expect(changeSubscription).not.toHaveBeenCalled();
  });

  it("does nothing for a Team row with no subscription", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", provider_subscription_id: null })],
    });
    expect(await syncSeats(ctx)).toBeNull();
  });

  it("does nothing when the seat count hasn't moved", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 3 })],
      org_memberships: [member("u1", "owner"), member("u2", "member"), member("u3", "member")],
    });
    expect(await syncSeats(ctx)).toEqual({ seats: 3 });
    expect(changeSubscription).not.toHaveBeenCalled();
  });

  it("moves the seat count to match the roster", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 2, billing_interval: "yearly" })],
      org_memberships: [member("u1", "owner"), member("u2", "member"), member("u3", "member")],
    });
    expect(await syncSeats(ctx)).toEqual({ seats: 3 });
    expect(changeSubscription).toHaveBeenCalledWith(ctx, {
      plan: "team",
      interval: "yearly",
      seats: 3,
      proration: "create_prorations",
    });
  });

  it("counts a monthly Team row as monthly", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 2, billing_interval: "monthly" })],
      org_memberships: [member("u1", "owner"), member("u2", "member"), member("u3", "member")],
    });
    await syncSeats(ctx);
    expect(changeSubscription).toHaveBeenCalledWith(ctx, expect.objectContaining({ interval: "monthly", seats: 3 }));
  });

  it("counts a workspace with no roster as one seat", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 1 })],
      org_memberships: [],
    });
    expect(await syncSeats(ctx)).toEqual({ seats: 1 });
  });

  it("counts one seat when the roster comes back with no count", async () => {
    const { syncSeats } = await load();
    const { ctx } = ctxWith({
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 1 })],
      org_memberships: NULL_DATA,
    });
    expect(await syncSeats(ctx)).toEqual({ seats: 1 });
    expect(changeSubscription).not.toHaveBeenCalled();
  });
});

describe("addMember", () => {
  it("refuses an email that isn't one", async () => {
    const { addMember } = await load();
    const { ctx } = ctxWith();
    await expect(addMember(ctx, { email: "nope" })).rejects.toThrow(/Give the person's email/);
  });

  it("refuses an email that isn't a string at all", async () => {
    const { addMember } = await load();
    const { ctx } = ctxWith();
    await expect(addMember(ctx, { email: 42 })).rejects.toThrow(/Give the person's email/);
  });

  it("refuses an unknown role", async () => {
    const { addMember } = await load();
    const { ctx } = ctxWith();
    await expect(addMember(ctx, { email: "jane@example.com", role: "boss" })).rejects.toThrow(/Role must be one of/);
  });

  it("refuses a person with no Weft account", async () => {
    const { addMember } = await load();
    const { ctx } = ctxWith({ profiles: [] });
    await expect(addMember(ctx, { email: "jane@example.com" })).rejects.toThrow(/No Weft account for jane@example.com/);
  });

  it("throws the database's message when the upsert fails", async () => {
    const { addMember } = await load();
    const { ctx } = ctxWith(
      { profiles: [{ id: "u1" }] },
      {},
      { org_memberships: { error: { message: "upsert failed" } } },
    );
    await expect(addMember(ctx, { email: "jane@example.com" })).rejects.toThrow("upsert failed");
  });

  it("adds the person and keeps the seats in step", async () => {
    const { addMember } = await load();
    const { ctx, calls } = ctxWith({
      profiles: [{ id: "u1" }],
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 1 })],
      org_memberships: [member("u1", "owner"), member("u2", "member")],
    });
    expect(await addMember(ctx, { email: "Jane@Example.com" })).toEqual({ userId: "u1", seats: { seats: 2 } });
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("org_memberships");
    expect(upsert?.args[0]).toEqual({ org_id: "org_1", user_id: "u1", role: "member" });
  });

  it("takes the role it was given", async () => {
    const { addMember } = await load();
    const { ctx, calls } = ctxWith({ profiles: [{ id: "u1" }] });
    await addMember(ctx, { email: "jane@example.com", role: "admin" });
    expect(calls.find((c) => c.op === "upsert")?.args[0]).toEqual({ org_id: "org_1", user_id: "u1", role: "admin" });
  });
});

describe("removeMember", () => {
  it("refuses someone who isn't in the workspace", async () => {
    const { removeMember } = await load();
    const { ctx } = ctxWith({ org_memberships: [member("u1", "owner")] });
    await expect(removeMember(ctx, { userId: "u2" })).rejects.toThrow(/isn't in this workspace/);
  });

  it("refuses a user id that isn't a string at all", async () => {
    const { removeMember } = await load();
    const { ctx } = ctxWith({ org_memberships: [member("u1", "owner")] });
    await expect(removeMember(ctx, { userId: 7 })).rejects.toThrow(/isn't in this workspace/);
  });

  it("refuses to remove the last owner", async () => {
    const { removeMember } = await load();
    const { ctx } = ctxWith({ org_memberships: [member("u1", "owner"), member("u2", "member")] });
    await expect(removeMember(ctx, { userId: "u1" })).rejects.toThrow(/That's the last owner/);
  });

  it("removes an owner when there's another one", async () => {
    const { removeMember } = await load();
    const { ctx } = ctxWith({ org_memberships: [member("u1", "owner"), member("u2", "owner")] });
    expect(await removeMember(ctx, { userId: "u1" })).toEqual({ seats: null });
  });

  it("throws the database's message when the delete fails", async () => {
    const { removeMember } = await load();
    const { ctx } = ctxWith(
      { org_memberships: [member("u1", "owner"), member("u2", "member")] },
      {},
      { org_memberships: { error: { message: "delete failed" } } },
    );
    await expect(removeMember(ctx, { userId: "u2" })).rejects.toThrow("delete failed");
  });

  it("removes the person and keeps the seats in step", async () => {
    const { removeMember } = await load();
    const { ctx, calls } = ctxWith({
      org_memberships: [member("u1", "owner"), member("u2", "member")],
      org_subscriptions: [fakeSubscriptionRow({ plan: "team", seats: 2 })],
    });
    expect(await removeMember(ctx, { userId: "u2" })).toEqual({ seats: { seats: 1 } });
    expect(calls.find((c) => c.op === "delete")?.table).toBe("org_memberships");
  });
});
