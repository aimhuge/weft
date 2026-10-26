import { beforeEach, describe, expect, it, vi } from "vitest";

// The growth read (lib/growth-read.ts): the new users, new teams and payments that happened since a time, and
// the headline numbers for the daily summary.
//
// The rows live in production Supabase and the service key lives on the Mac, so the read happens here. The
// service client is a fake: the RPC answers what the test says it answers.

const fake = vi.hoisted(() => ({
  client: null as { rpc: ReturnType<typeof vi.fn> } | null,
}));

vi.mock("./web-session", () => ({
  serviceClient: () => fake.client,
}));

const { growthEvents, growthOverview } = await import("./growth-read");

// A client whose rpc answers with the given data (or error).
const answering = (data: unknown, error: unknown = null) => {
  fake.client = { rpc: vi.fn(() => Promise.resolve({ data, error })) };
  return fake.client;
};

beforeEach(() => {
  fake.client = null;
});

describe("growthEvents", () => {
  it("asks for everything since the time it was given", async () => {
    const client = answering([{ kind: "user", id: "u1", email: "a@b.c", at: "2026-10-20T10:00:00Z" }]);
    const since = new Date("2026-10-20T00:00:00Z");
    const events = await growthEvents(since, { SUPABASE_SECRET_KEY: "key" });
    expect(client.rpc).toHaveBeenCalledWith("growth_events", { since: "2026-10-20T00:00:00.000Z" });
    expect(events).toHaveLength(1);
  });

  it("answers nothing without the service key", async () => {
    fake.client = null;
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: undefined })).toEqual([]);
  });

  it("answers nothing when the read fails", async () => {
    answering(null, { message: "no such function" });
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: "key" })).toEqual([]);
  });

  it("answers nothing when the answer is not a list", async () => {
    answering({ rows: [] });
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: "key" })).toEqual([]);
  });

  it("drops a row that is not shaped like a growth event", async () => {
    answering([
      { kind: "user", id: "u1", email: "a@b.c", at: "2026-10-20T10:00:00Z" },
      null,
      "nope",
      { kind: "user", id: "u2" },
      { kind: "user", id: "u3", at: 5 },
      { kind: "user", at: "2026-10-20T10:00:00Z" },
    ]);
    // Only the row that has what a user event needs survives.
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: "key" })).toEqual([
      { kind: "user", id: "u1", email: "a@b.c", at: "2026-10-20T10:00:00Z" },
    ]);
  });

  it("keeps a row that has the fields its kind needs", async () => {
    answering([
      { kind: "user", id: "u1", email: null, at: "2026-10-20T10:00:00Z" },
      { kind: "team", id: "t1", name: "Acme", slug: "acme", members: 2, at: "2026-10-20T10:00:00Z" },
      {
        kind: "payment",
        id: "p1",
        event: "invoice.paid",
        org: "AimHuge",
        slug: "aimhuge",
        actor: null,
        plan: "pro",
        status: "active",
        amount_cents: 2000,
        currency: "usd",
        seats: 1,
        at: "2026-10-20T10:00:00Z",
      },
    ]);
    const events = await growthEvents(new Date(), { SUPABASE_SECRET_KEY: "key" });
    expect(events.map((e) => e.kind)).toEqual(["user", "team", "payment"]);
  });

  it("drops a team row with no name, and a payment row with no org", async () => {
    answering([
      { kind: "team", id: "t1", slug: "acme", members: 2, at: "2026-10-20T10:00:00Z" },
      { kind: "payment", id: "p1", event: "invoice.paid", slug: "aimhuge", at: "2026-10-20T10:00:00Z" },
    ]);
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: "key" })).toEqual([]);
  });

  it("drops a row of a kind it has never heard of", async () => {
    answering([{ kind: "planet", id: "x1", at: "2026-10-20T10:00:00Z" }]);
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: "key" })).toEqual([]);
  });
});

describe("growthOverview", () => {
  const numbers = {
    accounts: 12,
    new_7d: 3,
    new_30d: 9,
    signed_in_7d: 5,
    signed_in_30d: 8,
    never_signed_in: 2,
    workspaces: 6,
    invites_pending: 1,
    syncing_accounts: 4,
    synced_cards: 21,
    paying_workspaces: 2,
  };

  it("reads the headline numbers", async () => {
    const client = answering(numbers);
    expect(await growthOverview({ SUPABASE_SECRET_KEY: "key" })).toEqual(numbers);
    expect(client.rpc).toHaveBeenCalledWith("growth_overview");
  });

  it("answers nothing without the service key", async () => {
    fake.client = null;
    expect(await growthOverview({ SUPABASE_SECRET_KEY: undefined })).toBeNull();
  });

  it("answers nothing when the read fails", async () => {
    answering(null, { message: "boom" });
    expect(await growthOverview({ SUPABASE_SECRET_KEY: "key" })).toBeNull();
  });

  it("answers nothing when the answer is missing", async () => {
    answering(null);
    expect(await growthOverview({ SUPABASE_SECRET_KEY: "key" })).toBeNull();
  });

  it("answers nothing when the answer is not an object", async () => {
    answering("nope");
    expect(await growthOverview({ SUPABASE_SECRET_KEY: "key" })).toBeNull();
  });

  it("counts a field that is not a number as zero", async () => {
    answering({ ...numbers, accounts: "twelve", new_7d: null });
    const overview = await growthOverview({ SUPABASE_SECRET_KEY: "key" });
    expect(overview?.accounts).toBe(0);
    expect(overview?.new_7d).toBe(0);
    expect(overview?.workspaces).toBe(6);
  });

  it("counts a field the answer leaves out as zero", async () => {
    answering({ accounts: 12 });
    const overview = await growthOverview({ SUPABASE_SECRET_KEY: "key" });
    expect(overview?.accounts).toBe(12);
    expect(overview?.new_30d).toBe(0);
    expect(overview?.paying_workspaces).toBe(0);
  });
});
