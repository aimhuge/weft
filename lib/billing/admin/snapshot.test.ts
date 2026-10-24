import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/snapshot.ts: what the admin console reads — the workspace list (with each one's plan) and one
// workspace's whole billing picture. The members and charges reads are mocked, so the test pins what a read that
// fails looks like: the panel shows what it could read and says what it couldn't.

const { loadRow } = vi.hoisted(() => ({ loadRow: vi.fn() }));
vi.mock("./context", () => ({ loadRow }));

const { listMembers } = vi.hoisted(() => ({ listMembers: vi.fn() }));
vi.mock("./members", () => ({ listMembers }));

const { listCharges } = vi.hoisted(() => ({ listCharges: vi.fn() }));
vi.mock("./refunds", () => ({ listCharges }));

const { detectMode } = vi.hoisted(() => ({ detectMode: vi.fn() }));
// AdminBillingError stays real: the refusals it carries are part of the contract.
vi.mock("./stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-keys")>();
  return { ...actual, detectMode, adminStripe: vi.fn(() => null) };
});

import { AdminBillingError } from "./stripe-keys";
import { listOrgs, orgDetail } from "./snapshot";
import type { SupabaseClient } from "@supabase/supabase-js";

type Result = { data?: unknown; error?: { message: string } | null };

// The orgs table, and the other tables the panel reads, each answer on their own. The filters the
// read built with them are kept, so a test can see what was searched for.
function makeService(tables: Record<string, Result>) {
  const ors: string[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const entry = tables[table] ?? { data: null, error: null };
    const then = (resolve: (v: unknown) => void) => Promise.resolve(entry).then(resolve);
    for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = vi.fn(() => chain);
    chain.or = vi.fn((filter: string) => {
      ors.push(filter);
      return chain;
    });
    chain.maybeSingle = vi.fn(() => chain);
    chain.single = vi.fn(() => chain);
    Object.defineProperty(chain, "then", { value: then, configurable: true });
    return chain;
  });
  return { from, ors };
}

// The fake service client as the reads see it: a real SupabaseClient, with a chain that answers
// the tables this fake knows about.
function asService(service: { from: unknown }): SupabaseClient {
  return service as unknown as SupabaseClient;
}

const STRIPE = {
  modes: () => ["live", "test"],
  defaultMode: () => "live",
  client: (mode: string) => ({ id: mode }),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  loadRow.mockResolvedValue(null);
  listMembers.mockResolvedValue([]);
  listCharges.mockResolvedValue([]);
  detectMode.mockResolvedValue({ mode: "none", deleted: false, checked: [], detail: null });
});

describe("listOrgs", () => {
  it("lists the workspaces with their plan", async () => {
    const service = makeService({
      orgs: { data: [{ id: "org_1", slug: "acme", name: "Acme" }], error: null },
      org_subscriptions: { data: [{ org_id: "org_1", plan: "pro", status: "active", seats: 3, provider_customer_id: "cus_1", provider_subscription_id: "sub_1" }], error: null },
    });
    const orgs = await listOrgs(asService(service), "");
    expect(orgs).toEqual([{ id: "org_1", slug: "acme", name: "Acme", plan: "pro", status: "active", seats: 3, hasStripeIds: true }]);
  });

  it("reads a workspace with no subscription as a free one", async () => {
    const service = makeService({
      orgs: { data: [{ id: "org_1", slug: "acme", name: "Acme" }], error: null },
      org_subscriptions: { data: [], error: null },
    });
    const orgs = await listOrgs(asService(service), "");
    expect(orgs[0]).toEqual({ id: "org_1", slug: "acme", name: "Acme", plan: "free", status: "active", seats: 1, hasStripeIds: false });
  });

  it("knows a workspace has only a customer id", async () => {
    const service = makeService({
      orgs: { data: [{ id: "org_1", slug: "acme", name: "Acme" }], error: null },
      org_subscriptions: { data: [{ org_id: "org_1", plan: "free", status: "active", seats: 1, provider_customer_id: "cus_1", provider_subscription_id: null }], error: null },
    });
    const orgs = await listOrgs(asService(service), "");
    expect(orgs[0]!.hasStripeIds).toBe(true);
  });

  it("copes with the subscriptions query giving no rows at all", async () => {
    const service = makeService({
      orgs: { data: [{ id: "org_1", slug: "acme", name: "Acme" }], error: null },
      org_subscriptions: { data: null, error: null },
    });
    const orgs = await listOrgs(asService(service), "");
    expect(orgs[0]!.plan).toBe("free");
    expect(orgs[0]!.hasStripeIds).toBe(false);
  });

  it("searches by slug or name when asked", async () => {
    const service = makeService({
      orgs: { data: [], error: null },
      org_subscriptions: { data: [], error: null },
    });
    await listOrgs(asService(service), " acme ");
    expect(service.ors).toEqual(["slug.ilike.%acme%,name.ilike.%acme%"]);
  });

  it("doesn't search when the term is blank", async () => {
    const service = makeService({
      orgs: { data: [], error: null },
      org_subscriptions: { data: [], error: null },
    });
    await listOrgs(asService(service), "   ");
    expect(service.ors).toEqual([]);
  });

  it("answers nothing when there are no workspaces", async () => {
    const service = makeService({ orgs: { data: [], error: null } });
    expect(await listOrgs(asService(service), "")).toEqual([]);
  });

  it("answers nothing when the orgs query gives no rows at all", async () => {
    const service = makeService({ orgs: { data: null, error: null } });
    expect(await listOrgs(asService(service), "")).toEqual([]);
  });

  it("throws when the orgs query fails", async () => {
    const service = makeService({ orgs: { data: null, error: { message: "table gone" } } });
    await expect(listOrgs(asService(service), "")).rejects.toThrow(AdminBillingError);
    await expect(listOrgs(asService(service), "")).rejects.toThrow(/table gone/);
  });
});

describe("orgDetail", () => {
  const ctx = (service: unknown, overrides: Record<string, unknown> = {}) =>
    ({
      service,
      orgId: "org_1",
      actorEmail: "ada@b.co",
      stripe: STRIPE,
      ...overrides,
    }) as never;

  it("refuses a workspace that isn't there", async () => {
    const service = makeService({ orgs: { data: null, error: null } });
    await expect(orgDetail(ctx(service))).rejects.toThrow(/No such workspace/);
  });

  it("reads the workspace's whole picture", async () => {
    const service = makeService({
      orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null },
      org_invoices: { data: [{ number: "WFT-1", status: "paid" }], error: null },
      org_billing_events: { data: [{ kind: "admin.comp" }], error: null },
      referral_codes: { data: { code: "WEFT-ACME", promotion_codes: { live: "promo_1" } }, error: null },
    });
    const detail = await orgDetail(ctx(service));
    expect(detail.org).toEqual({ id: "org_1", slug: "acme", name: "Acme" });
    expect(detail.invoices).toEqual([{ number: "WFT-1", status: "paid" }]);
    expect(detail.events).toEqual([{ kind: "admin.comp" }]);
    expect(detail.referral).toEqual({ code: "WEFT-ACME", promotion_codes: { live: "promo_1" } });
    expect(detail.errors).toEqual([]);
    expect(detail.keys).toEqual(["live", "test"]);
    expect(detail.defaultMode).toBe("live");
  });

  it("answers empty lists when the tables have no rows", async () => {
    const service = makeService({
      orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null },
      org_invoices: { data: null, error: null },
      org_billing_events: { data: null, error: null },
      referral_codes: { data: null, error: null },
    });
    const detail = await orgDetail(ctx(service));
    expect(detail.invoices).toEqual([]);
    expect(detail.events).toEqual([]);
    expect(detail.referral).toBeNull();
  });

  it("doesn't load the charges when the workspace can't be charged", async () => {
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(listCharges).not.toHaveBeenCalled();
    expect(detail.charges).toEqual([]);
  });

  it("doesn't load the charges when the mode isn't live or test", async () => {
    detectMode.mockResolvedValue({ mode: "unknown", deleted: false, checked: ["live"], detail: "no key" });
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    await orgDetail(ctx(service));
    expect(listCharges).not.toHaveBeenCalled();
  });

  it("doesn't load the charges when the workspace has no customer", async () => {
    detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
    loadRow.mockResolvedValue({ provider_customer_id: null, provider_subscription_id: "sub_1" });
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    await orgDetail(ctx(service));
    expect(listCharges).not.toHaveBeenCalled();
  });

  it("loads the charges when the workspace can be charged", async () => {
    detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: "sub_1" });
    listCharges.mockResolvedValue([{ id: "ch_1", amountCents: 100 }]);
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(listCharges).toHaveBeenCalledTimes(1);
    expect(detail.charges).toEqual([{ id: "ch_1", amountCents: 100 }]);
  });

  it("keeps the panel up when the members read fails", async () => {
    listMembers.mockRejectedValue(new Error("members table is locked"));
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(detail.members).toEqual([]);
    expect(detail.errors).toEqual(["members table is locked"]);
  });

  it("keeps the panel up when the charges read fails", async () => {
    detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: "sub_1" });
    listCharges.mockRejectedValue(new Error("stripe said no"));
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(detail.charges).toEqual([]);
    expect(detail.errors).toEqual(["stripe said no"]);
  });

  it("records a non-Error failure as its string", async () => {
    listMembers.mockRejectedValue("just a string");
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(detail.errors).toEqual(["just a string"]);
  });

  it("lists both failures", async () => {
    detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: "sub_1" });
    listMembers.mockRejectedValue(new Error("members table is locked"));
    listCharges.mockRejectedValue(new Error("stripe said no"));
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(detail.errors).toEqual(["members table is locked", "stripe said no"]);
  });

  it("reads the row and the mode", async () => {
    detectMode.mockResolvedValue({ mode: "test", deleted: false, checked: ["test"], detail: null });
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: null });
    const service = makeService({ orgs: { data: { id: "org_1", slug: "acme", name: "Acme" }, error: null } });
    const detail = await orgDetail(ctx(service));
    expect(detail.row).toEqual({ provider_customer_id: "cus_1", provider_subscription_id: null });
    expect(detail.mode).toEqual({ mode: "test", deleted: false, checked: ["test"], detail: null });
    expect(detectMode).toHaveBeenCalledWith(STRIPE, { customerId: "cus_1", subscriptionId: null });
  });
});
