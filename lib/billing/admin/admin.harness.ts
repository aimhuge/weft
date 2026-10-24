import type Stripe from "stripe";
import { vi, type Mock } from "vitest";
import type { AdminStripe, StripeMode } from "./stripe-keys";

// Shared fakes for the admin-console tests (lib/billing/admin/*.test.ts). Harness files are
// excluded from coverage (vitest.config.ts), so everything here is scaffolding: a fake Stripe
// client, a fake AdminStripe, and a chainable Supabase service client.
//
// Each test file still holds its own vi.hoisted mocks and vi.mock calls — module state is
// per-test file — so what is shared here is only the shapes, not the state.

// The Stripe calls the console makes. Each mock is typed with its signature, so a test that
// resolves or rejects it is checked against what Stripe would answer.
export interface FakeStripeClient {
  customers: { retrieve: Mock<(id: string) => Promise<{ id: string; deleted: boolean }>> };
  subscriptions: {
    retrieve: Mock<(id: string) => Promise<ReturnType<typeof fakeSubscription>>>;
    update: Mock<(id: string, patch: Record<string, unknown>) => Promise<ReturnType<typeof fakeSubscription>>>;
    cancel: Mock<(id: string) => Promise<{ id: string; status: string }>>;
  };
  prices: { list: Mock<(query: Record<string, unknown>) => Promise<{ data: { id: string }[] }>> };
  charges: { list: Mock<(query: Record<string, unknown>) => Promise<{ data: unknown[] }>>; retrieve: Mock<(id: string) => Promise<ReturnType<typeof fakeCharge>>> };
  refunds: { create: Mock<(body: Record<string, unknown>) => Promise<{ id: string }>> };
}

// A Stripe client whose every method is a mock. Each method's default resolves to a plausible
// empty answer; a test overrides the one it cares about.
export function fakeStripeClient(): FakeStripeClient {
  return {
    customers: { retrieve: vi.fn<(id: string) => Promise<{ id: string; deleted: boolean }>>().mockResolvedValue({ id: "cus_1", deleted: false }) },
    subscriptions: {
      retrieve: vi.fn<(id: string) => Promise<ReturnType<typeof fakeSubscription>>>().mockResolvedValue(fakeSubscription()),
      update: vi
        .fn<(id: string, patch: Record<string, unknown>) => Promise<ReturnType<typeof fakeSubscription>>>()
        .mockImplementation((_id: string, patch: Record<string, unknown>) => Promise.resolve(fakeSubscription(patch))),
      cancel: vi.fn<(id: string) => Promise<{ id: string; status: string }>>().mockResolvedValue({ id: "sub_1", status: "canceled" }),
    },
    prices: { list: vi.fn<(query: Record<string, unknown>) => Promise<{ data: { id: string }[] }>>().mockResolvedValue({ data: [] }) },
    charges: {
      list: vi.fn<(query: Record<string, unknown>) => Promise<{ data: unknown[] }>>().mockResolvedValue({ data: [] }),
      retrieve: vi.fn<(id: string) => Promise<ReturnType<typeof fakeCharge>>>().mockResolvedValue(fakeCharge()),
    },
    refunds: { create: vi.fn<(body: Record<string, unknown>) => Promise<{ id: string }>>().mockResolvedValue({ id: "re_1" }) },
  };
}

// A Stripe subscription on a Weft price, shaped the way the admin console reads it: the period
// lives on the item, not the subscription.
export function fakeSubscription(patch: Record<string, unknown> = {}) {
  const item = {
    id: "si_1",
    quantity: 3,
    current_period_start: 1_760_000_000,
    current_period_end: 1_767_000_000,
    price: {
      id: "price_pro_monthly",
      unit_amount: 2000,
      lookup_key: "weft_pro_monthly_2000",
      metadata: { plan: "pro", interval: "monthly" },
    },
  };
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    items: { data: [item] },
    ...patch,
  };
}

// A Stripe charge.
export function fakeCharge(patch: Record<string, unknown> = {}) {
  return {
    id: "ch_1",
    amount: 5000,
    amount_refunded: 0,
    currency: "usd",
    status: "succeeded",
    refunded: false,
    description: "Pro, monthly",
    created: 1_760_000_000,
    receipt_url: "https://pay.stripe.com/receipts/ch_1",
    customer: "cus_1",
    ...patch,
  };
}

// The AdminStripe the console holds: the modes there is a key for, a client per mode, and the
// deployment's own mode. The mocks are typed with AdminStripe's own signatures, so a fake can
// stand in for the real holder wherever the console asks for one.
export interface FakeAdminStripe extends AdminStripe {
  modes: Mock<() => StripeMode[]>;
  client: Mock<(mode: StripeMode) => Stripe | null>;
  defaultMode: Mock<() => StripeMode | null>;
}

export function fakeAdminStripe(clients: Partial<Record<StripeMode, FakeStripeClient>> = {}): FakeAdminStripe {
  const modeClients: Record<string, FakeStripeClient> = { ...clients };
  return {
    modes: vi.fn<() => StripeMode[]>(() => Object.keys(modeClients) as StripeMode[]),
    // The fake client is not a real Stripe instance; the console only calls the methods it
    // names, and this cast is where that gap is bridged. A mode with no client answers null,
    // the way a mode with no key does.
    client: vi.fn<(mode: StripeMode) => Stripe | null>((mode: StripeMode) => {
      const client = modeClients[mode];
      return client ? (client as unknown as Stripe) : null;
    }),
    defaultMode: vi.fn<() => StripeMode | null>(() => "live"),
  };
}

// The chainable Supabase service client the admin ops read through. `rowsByTable` pins the rows a
// select returns (the first one, like maybeSingle) and `writesByTable` the error a write returns.
// A table registered with this answers with null data — an empty read in the shape the caller
// has to guard, rather than an empty array.
export const NULL_DATA = Symbol("null-data");

// The arguments of a mock's first call, or a throw when it was never called. Tests reach into
// `mock.calls[0]` a lot; this keeps the "it was called" check in one place.
export function firstCall<T extends unknown[]>(mock: { mock: { calls: T[] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Expected the mock to have been called, but it wasn't.");
  return call;
}

export function fakeService(
  rowsByTable: Record<string, unknown[] | typeof NULL_DATA> = {},
  errorsByTable: Record<string, { message: string }> = {},
  writesByTable: Record<string, { error: { message: string } | null; data?: unknown }> = {},
): { client: { from: ReturnType<typeof vi.fn> }; calls: { table: string; op: string; args: unknown[] }[] } {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  // Rows deleted through the fake come out of the count a later read sees, the way the real
  // database would report it.
  const deleted = new Map<string, number>();
  const from = vi.fn((table: string) => {
    const rows = rowsByTable[table] ?? [];
    const isNull = rows === NULL_DATA;
    const err = errorsByTable[table] ?? null;
    const write = writesByTable[table] ?? { error: null };
    const chain: Record<string, unknown> = {};
    const then = (resolve: (v: unknown) => void) => {
      const isWrite = chain.__write === true;
      // A select returns every row; maybeSingle/single narrows it to the first.
      const single = chain.__single === true;
      const count = isNull ? null : Math.max(0, rows.length - (deleted.get(table) ?? 0));
      const data = isNull ? null : single ? (rows[0] ?? null) : rows;
      return Promise.resolve(
        isWrite
          ? { data: write.data ?? null, error: write.error, count }
          : { data, error: err, count },
      ).then(resolve);
    };
    for (const m of ["select", "eq", "in", "ilike", "is", "maybeSingle", "single", "order", "limit"]) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push({ table, op: m, args });
        if (m === "maybeSingle" || m === "single") chain.__single = true;
        return chain;
      });
    }
    for (const m of ["insert", "update", "delete", "upsert"]) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push({ table, op: m, args });
        chain.__write = true;
        if (m === "delete") deleted.set(table, (deleted.get(table) ?? 0) + 1);
        return chain;
      });
    }
    Object.defineProperty(chain, "then", { value: then, configurable: true });
    return chain;
  });
  return { client: { from }, calls };
}

// The org's subscription row, as stored.
export function fakeSubscriptionRow(patch: Record<string, unknown> = {}) {
  return {
    org_id: "org_1",
    plan: "pro",
    status: "active",
    billing_interval: "monthly",
    seats: 1,
    unit_amount_cents: 2000,
    current_period_end: "2026-12-01T00:00:00.000Z",
    cancel_at_period_end: false,
    trial_end: null,
    provider: "stripe",
    provider_customer_id: "cus_1",
    provider_subscription_id: "sub_1",
    ...patch,
  };
}
