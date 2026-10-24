import { vi } from "vitest";

// Fakes for the coupons and referrals tests (lib/billing/admin/coupons.test.ts,
// lib/billing/referrals.test.ts). Harness files are excluded from coverage
// (vitest.config.ts), so everything here is scaffolding: the fake Stripe client's promotion
// codes and coupons, and the chainable Supabase service client the referrals read through.
//
// lib/billing/admin/admin.harness.ts is the same idea for the rest of the admin console; the two
// share the fakeAdminStripe shape by convention. If you change one, change the other.

export interface FakePromoClient {
  promotionCodes: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> };
  coupons: { retrieve: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  subscriptions: { update: ReturnType<typeof vi.fn> };
  customers: { createBalanceTransaction: ReturnType<typeof vi.fn> };
  checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
  prices: { list: ReturnType<typeof vi.fn> };
}

// A promotion code with its coupon expanded, the shape Stripe returns for expand: ["promotion.coupon"].
export function fakePromoCode(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo_1",
    code: "SAVE20",
    active: true,
    times_redeemed: 0,
    max_redemptions: null,
    expires_at: null,
    metadata: { app: "weft", kind: "coupon" },
    promotion: {
      type: "coupon",
      coupon: {
        id: "cou_1",
        name: "Save 20",
        percent_off: 20,
        amount_off: null,
        duration: "once",
        duration_in_months: null,
        metadata: {},
      },
    },
    ...overrides,
  };
}

// A Stripe client whose promotion codes, coupons and balance transactions are all mocks.
export function fakeCouponStripe(): FakePromoClient {
  return {
    promotionCodes: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue(fakePromoCode()),
      update: vi.fn().mockResolvedValue(fakePromoCode()),
      retrieve: vi.fn().mockResolvedValue(fakePromoCode()),
    },
    coupons: {
      retrieve: vi.fn().mockResolvedValue({ id: "weft-referral-20off-3mo" }),
      create: vi.fn().mockResolvedValue({ id: "weft-referral-20off-3mo" }),
    },
    subscriptions: { update: vi.fn().mockResolvedValue({}) },
    customers: { createBalanceTransaction: vi.fn().mockResolvedValue({ id: "cbtxn_1" }) },
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.test/c/cs_1" }) } },
    prices: { list: vi.fn().mockResolvedValue({ data: [] }) },
  };
}

// A promotion code that carries a workspace's referral, the kind a referred workspace types.
export function fakeReferralPromo(referrerOrgId: string, code = "WEFT-ACME") {
  return { id: "promo_1", code, metadata: { kind: "referral", referrer_org_id: referrerOrgId } };
}

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

// A table's answers: one result for every call, or a different result per operation (so an insert
// and the select after it answer differently).
export type FakeTable = Result[] | Result | Partial<Record<"select" | "insert" | "update" | "delete" | "upsert", Result[] | Result>>;

export interface FakeService {
  client: { from: ReturnType<typeof vi.fn> };
  // What was written, per table and operation.
  calls: { table: string; op: string; arg: unknown }[];
}

// The chainable Supabase service client the referrals read and write through. Each table's answers
// are given per operation, or as a queue consumed in order.
export function fakeService(tables: Record<string, FakeTable> = {}): FakeService {
  const used: Record<string, number> = {};
  const calls: { table: string; op: string; arg: unknown }[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    let op = "select";
    const entry = tables[table];
    const pick = (): Result => {
      const perOp = entry && typeof entry === "object" && !Array.isArray(entry) && ("select" in entry || "insert" in entry || "update" in entry || "delete" in entry || "upsert" in entry);
      const source: Result[] | Result | undefined = perOp ? (entry as Record<string, Result[] | Result | undefined>)[op] : (entry as Result[] | Result | undefined);
      if (Array.isArray(source)) {
        const i = used[`${table}:${op}`] ?? 0;
        used[`${table}:${op}`] = i + 1;
        return source[i] ?? source[source.length - 1] ?? { data: null, error: null };
      }
      return source ?? { data: null, error: null };
    };
    const then = (resolve: (v: unknown) => void) => Promise.resolve(pick()).then(resolve);
    for (const m of ["select", "eq", "in", "order", "limit"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.upsert = vi.fn((a: unknown) => {
      op = "upsert";
      calls.push({ table, op: "upsert", arg: a });
      return chain;
    });
    for (const m of ["insert", "update", "delete"]) {
      chain[m] = vi.fn((a: unknown) => {
        op = m;
        calls.push({ table, op: m, arg: a });
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(() => chain);
    chain.single = vi.fn(() => chain);
    Object.defineProperty(chain, "then", { value: then, configurable: true });
    return chain;
  });
  return { client: { from }, calls };
}
