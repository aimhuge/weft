import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUKU_METER, type PlanId } from "./plans";

// lib/billing/puku-meter.ts: turns a user's plan into a Puku allowance answer, with a 60s per-user cache.
// billing and orgForUser are mocked so the test is independent of Supabase and Stripe.

// vi.hoisted runs before everything else (including vi.mock), so the factories below can close over these
// mocks without a temporal-dead-zone error.
const { orgForUser, subscription, balance, recordUsage } = vi.hoisted(() => ({
  orgForUser: vi.fn<(svc: unknown, userId: string) => Promise<{ id: string; slug: string; name: string } | null>>(),
  subscription: vi.fn<(svc: unknown, orgId: string) => Promise<{ plan: PlanId; status: string }>>(),
  balance: vi.fn<(svc: unknown, orgId: string, meter: string) => Promise<{ allowance: number; granted: number; spent: number; remaining: number }>>(),
  recordUsage: vi.fn<(svc: unknown, input: { orgId: string; meter: string; amount: number; refType: string; createdBy: string; createdVia: string }) => Promise<void>>(),
}));

vi.mock("./billing", () => ({
  billing: {
    subscription: (svc: unknown, orgId: string) => subscription(svc, orgId),
    balance: (svc: unknown, orgId: string, meter: string) => balance(svc, orgId, meter),
    recordUsage: (svc: unknown, input: { orgId: string; meter: string; amount: number; refType: string; createdBy: string; createdVia: string }) => recordUsage(svc, input),
  },
}));
vi.mock("./org", () => ({ orgForUser: (svc: unknown, userId: string) => orgForUser(svc, userId) }));

let pukuMeter: typeof import("./puku-meter")["pukuMeter"];
let resetMeterCache: typeof import("./puku-meter")["resetMeterCache"];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  vi.resetModules();
  ({ pukuMeter, resetMeterCache } = await import("./puku-meter"));
  orgForUser.mockReset();
  subscription.mockReset();
  balance.mockReset();
  recordUsage.mockReset();
  resetMeterCache();
});

afterEach(() => {
  vi.useRealTimers();
});

const service = {} as never;
const org = { id: "org-1", slug: "ada", name: "Ada" };

describe("pukuMeter.check", () => {
  it("returns null when the user has no workspace", async () => {
    orgForUser.mockResolvedValueOnce(null);
    const m = pukuMeter(service);
    expect(await m.check("u1")).toBeNull();
    expect(subscription).not.toHaveBeenCalled();
  });

  it("returns the Pro plan's remaining tokens for a metered subscription", async () => {
    orgForUser.mockResolvedValueOnce(org);
    subscription.mockResolvedValueOnce({ plan: "pro", status: "active" });
    balance.mockResolvedValueOnce({ allowance: 300_000_000, granted: 0, spent: 100, remaining: 299_999_900 });
    const m = pukuMeter(service);
    expect(await m.check("u1")).toEqual({ orgId: "org-1", remaining: 299_999_900 });
    expect(balance).toHaveBeenCalledWith(service, "org-1", PUKU_METER);
  });

  it("returns null when the plan has no Puku allowance (Free)", async () => {
    orgForUser.mockResolvedValueOnce(org);
    subscription.mockResolvedValueOnce({ plan: "free", status: "active" });
    const m = pukuMeter(service);
    expect(await m.check("u1")).toBeNull();
    expect(balance).not.toHaveBeenCalled();
  });

  it("returns null when balance says the plan has zero allowance and no grants (a paid plan in an unmetered status)", async () => {
    orgForUser.mockResolvedValueOnce(org);
    subscription.mockResolvedValueOnce({ plan: "pro", status: "past_due" });
    balance.mockResolvedValueOnce({ allowance: 0, granted: 0, spent: 0, remaining: 0 });
    const m = pukuMeter(service);
    expect(await m.check("u1")).toBeNull();
  });

  it("caches the result for 15s per user, then re-asks", async () => {
    orgForUser.mockResolvedValue(org);
    subscription.mockResolvedValue({ plan: "pro", status: "active" });
    balance.mockResolvedValue({ allowance: 100, granted: 0, spent: 0, remaining: 100 });
    const m = pukuMeter(service);
    await m.check("u1");
    await m.check("u1");
    expect(orgForUser).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-13T12:00:16Z"));
    await m.check("u1");
    expect(orgForUser).toHaveBeenCalledTimes(2);
  });

  it("takes each recorded charge off every cached answer for the workspace", async () => {
    orgForUser.mockResolvedValue(org);
    subscription.mockResolvedValue({ plan: "pro", status: "active" });
    balance.mockResolvedValue({ allowance: 100, granted: 0, spent: 0, remaining: 100 });
    recordUsage.mockResolvedValue(undefined);
    const m = pukuMeter(service);
    await m.check("u1");
    await m.check("u2");
    await m.record(org.id, "u1", 60);
    expect(await m.check("u2")).toEqual({ orgId: org.id, remaining: 40 });
    await m.record(org.id, "u2", 60);
    expect(await m.check("u1")).toEqual({ orgId: org.id, remaining: 0 });
    expect(balance).toHaveBeenCalledTimes(2);
  });

  it("resetMeterCache wipes the cache for tests", async () => {
    orgForUser.mockResolvedValue(org);
    subscription.mockResolvedValue({ plan: "pro", status: "active" });
    balance.mockResolvedValue({ allowance: 100, granted: 0, spent: 0, remaining: 100 });
    const m = pukuMeter(service);
    await m.check("u1");
    resetMeterCache();
    await m.check("u1");
    expect(orgForUser).toHaveBeenCalledTimes(2);
  });
});

describe("pukuMeter.record", () => {
  it("records input + output tokens as one charge against the workspace", async () => {
    const m = pukuMeter(service);
    await m.record("org-1", "u1", 1234);
    expect(recordUsage).toHaveBeenCalledWith(service, { orgId: "org-1", meter: PUKU_METER, amount: 1234, refType: "puku_request", createdBy: "u1", createdVia: "system" });
  });

  it("skips a zero- or negative-token charge", async () => {
    const m = pukuMeter(service);
    await m.record("org-1", "u1", 0);
    await m.record("org-1", "u1", -3);
    expect(recordUsage).not.toHaveBeenCalled();
  });
});