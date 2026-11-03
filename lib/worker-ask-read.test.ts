// What main reads before it signs an Allow on a worker card (lib/worker-ask-read.ts): the row as the worker published
// it, only for a card one of your workers owns, with the names the worker rebuilds the message from.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => ({}) }));
vi.mock("./worker-board", () => ({ requireSession: () => Promise.resolve({ uid: "u-1", org: "org-1" }) }));

const { readWorkerAsk } = await import("./worker-ask-read");

function client(data: unknown) {
  const filters: unknown[][] = [];
  const q = {
    select: () => q,
    eq: (...args: unknown[]) => (filters.push(args), q),
    maybeSingle: () => Promise.resolve({ data, error: null }),
  };
  return { client: { from: () => q } as unknown as SupabaseClient, filters };
}

const pending = { id: "p-1", toolName: "Bash", input: { command: "ls" } };
const row = { org_id: "org-1", owner_device: "worker:w1", owner_worker: "w1", owner_user: "u-1", card: { id: "c1", title: "Ship", pending } };

describe("readWorkerAsk", () => {
  it("reads your worker's card and its waiting request, in your workspace", async () => {
    const c = client(row);
    expect(await readWorkerAsk("c1", c.client)).toEqual({ orgId: "org-1", device: "worker:w1", workerId: "w1", card: { id: "c1", title: "Ship", pending } });
    expect(c.filters).toEqual([
      ["org_id", "org-1"],
      ["card_id", "c1"],
    ]);
    expect(await readWorkerAsk("c1", client({ ...row, card: { id: "c1" } }).client)).toMatchObject({ card: { pending: null } });
  });

  it.each([
    ["no row", null],
    ["a Mac's card", { ...row, owner_worker: null }],
    ["a teammate's worker", { ...row, owner_user: "u-2" }],
    ["a deleted card", { ...row, deleted: true }],
    ["a device that isn't its worker's", { ...row, owner_device: "mac-1" }],
  ])("is null for %s", async (_, data) => {
    expect(await readWorkerAsk("c1", client(data).client)).toBeNull();
  });
});
