import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// The audit log read back from your Weft account (lib/keychain-audit-record.ts): rows as log lines, with whose they are.
vi.mock("./account", async () => {
  const real = await vi.importActual<typeof import("./account")>("./account");
  return { toAccountUser: real.toAccountUser, accountClient: vi.fn() };
});

const { entryOf, readKeychainRecord } = await import("./keychain-audit-record");

const ROW = {
  id: "a",
  device_id: "mac1",
  seq: 4,
  occurred_at: "2026-10-26T00:00:00.000Z",
  created_at: "2026-10-26T00:00:03.000Z",
  kind: "vault" as const,
  action: "fill",
  outcome: "ok",
  actor: "thread",
  what: null,
  card: "c1",
  thread: "Set up Stripe webhooks",
  vault: "aimhuge/weft",
  names: ["STRIPE_SECRET_KEY"],
  environment: null,
  site: "dashboard.stripe.com",
  command: null,
  detail: null,
  via: "touch-id",
  repeat_count: 0,
};

type Options = { meta?: Record<string, string>; email?: string; signedIn?: boolean; rows?: unknown[]; error?: { message: string } | null };

function fake({ meta = { full_name: "Alex Miller" }, email = "alex@example.com", signedIn = true, rows = [ROW], error = null }: Options = {}) {
  const query = { select: vi.fn(), order: vi.fn(), limit: vi.fn() };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: rows, error });
  const user = { id: "u1", email, user_metadata: meta, app_metadata: {} };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: signedIn ? { user } : null } }) },
    from: vi.fn(() => query),
  };
  return { client: client as unknown as SupabaseClient, query, from: client.from };
}

describe("entryOf", () => {
  it("reads a row back as a log line with whose it is, its Mac and when it was saved", () => {
    expect(entryOf(ROW, "Alex Miller")).toEqual({
      id: "a",
      seq: 4,
      at: "2026-10-26T00:00:00.000Z",
      kind: "vault",
      action: "fill",
      outcome: "ok",
      by: "thread",
      device: "mac1",
      savedAt: "2026-10-26T00:00:03.000Z",
      card: "c1",
      thread: "Set up Stripe webhooks",
      vault: "aimhuge/weft",
      names: ["STRIPE_SECRET_KEY"],
      site: "dashboard.stripe.com",
      via: "touch-id",
      owner: "Alex Miller",
    });
  });

  it("drops empty fields and keeps a repeat count", () => {
    const line = entryOf({ ...ROW, names: null, thread: null, card: null, site: null, via: null, repeat_count: 3 }, null);
    expect(line).not.toHaveProperty("names");
    expect(line).not.toHaveProperty("owner");
    expect(line.count).toBe(3);
  });
});

describe("readKeychainRecord", () => {
  it("reads your newest lines under your name", async () => {
    const f = fake();
    const record = await readKeychainRecord(f.client, 50);
    expect(f.from).toHaveBeenCalledWith("keychain_events");
    expect(f.query.order).toHaveBeenCalledWith("occurred_at", { ascending: false });
    expect(f.query.limit).toHaveBeenCalledWith(50);
    expect(record.signedIn).toBe(true);
    expect(record.owner).toBe("Alex Miller");
    expect(record.entries[0]?.owner).toBe("Alex Miller");
  });

  it("falls back to the email's name, then none, and to no rows", async () => {
    expect((await readKeychainRecord(fake({ meta: {} }).client)).owner).toBe("alex");
    const nameless = await readKeychainRecord(fake({ meta: {}, email: "", rows: [] }).client);
    expect(nameless.owner).toBeNull();
    expect(nameless.entries).toEqual([]);
  });

  it("says you're signed out, and throws a failed read", async () => {
    expect(await readKeychainRecord(fake({ signedIn: false }).client)).toEqual({ signedIn: false, owner: null, entries: [] });
    await expect(readKeychainRecord(fake({ error: { message: "nope" } }).client)).rejects.toThrow("nope");
  });
});
