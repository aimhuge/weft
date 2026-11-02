import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workerShareCard } from "./card-share-worker";

// lib/card-share-worker.ts against a fake client that records the query: only a live row of one of the account's own
// workers' cards is found.
function fake(answer: { data: unknown; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const q = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), q),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
    not: (...a: unknown[]) => (calls.push(["not", ...a]), q),
    limit: (...a: unknown[]) => (calls.push(["limit", ...a]), q),
    maybeSingle: () => Promise.resolve(answer),
  };
  const client = { from: (table: string) => (calls.push(["from", table]), q) } as unknown as SupabaseClient;
  return { client, calls };
}

describe("workerShareCard", () => {
  it("finds the account's own live worker card, with its workspace and title", async () => {
    const { client, calls } = fake({ data: { org_id: "o-w", card: { title: "Ship it" } }, error: null });
    expect(await workerShareCard(client, "u1", "c1")).toEqual({ orgId: "o-w", title: "Ship it" });
    expect(calls).toEqual([
      ["from", "cloud_cards"],
      ["select", "org_id, card"],
      ["eq", "card_id", "c1"],
      ["eq", "owner_user", "u1"],
      ["eq", "deleted", false],
      ["not", "owner_worker", "is", null],
      ["limit", 1],
    ]);
  });

  it("reads a title it can't use as none", async () => {
    expect(await workerShareCard(fake({ data: { org_id: "o", card: { title: 3 } }, error: null }).client, "u", "c")).toEqual({ orgId: "o", title: "" });
    expect(await workerShareCard(fake({ data: { org_id: "o", card: null }, error: null }).client, "u", "c")).toEqual({ orgId: "o", title: "" });
  });

  it("is null when there's no such row, and throws what Supabase refused", async () => {
    expect(await workerShareCard(fake({ data: null, error: null }).client, "u", "c")).toBeNull();
    await expect(workerShareCard(fake({ data: null, error: { message: "denied" } }).client, "u", "c")).rejects.toThrow("denied");
  });
});
