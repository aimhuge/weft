import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const store = vi.hoisted(() => ({ getCard: vi.fn(), updateCard: vi.fn() }));
vi.mock("./store", () => store);

import { noteTakeovers, takeoversFrom, takeoversOf, TAKEOVER_LIMIT } from "./team-takeover-marks";

type Result = { data: unknown; error: { code?: string; message: string } | null };

// A Supabase query builder that records each filter and answers `result`.
function client(result: Result) {
  const calls: [string, ...unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = (...args: unknown[]) => (calls.push([m, ...args]), b);
  b.then = (ok: (r: Result) => unknown) => Promise.resolve(result).then(ok);
  return { calls, c: { from: (table: string) => (calls.push(["from", table]), b) } as never };
}

const row = (card: string, by: string, at: string) => ({ org_id: "org", card_id: card, by_user: by, at });

beforeEach(() => {
  store.getCard.mockReset();
  store.updateCard.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
});

describe("takeoversOf", () => {
  it("reads a workspace's takeovers newest first and keeps each card's newest", async () => {
    const { c, calls } = client({ data: [row("a", "alex", "t2"), row("a", "sam", "t1"), row("b", "sam", "t1")], error: null });
    const out = await takeoversOf(c, "org");
    expect(calls).toEqual([["from", "cloud_card_takeovers"], ["select", "org_id, card_id, by_user, at"], ["eq", "org_id", "org"], ["order", "at", { ascending: false }], ["limit", TAKEOVER_LIMIT]]);
    expect([...out.values()].map((r) => [r.card_id, r.by_user])).toEqual([["a", "alex"], ["b", "sam"]]);
  });

  it("has none when the table isn't there yet, quietly", async () => {
    const { c } = client({ data: null, error: { code: "42P01", message: "missing" } });
    expect((await takeoversOf(c, "org")).size).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns on any other error and has none", async () => {
    const { c } = client({ data: null, error: { code: "500", message: "down" } });
    expect((await takeoversOf(c, "org")).size).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("takeoversFrom", () => {
  it("reads nothing with no workspace", async () => {
    const { c, calls } = client({ data: [], error: null });
    expect(await takeoversFrom(c, "me", [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reads your cards' takeovers in those workspaces, newest per card", async () => {
    const { c, calls } = client({ data: [row("a", "alex", "t2"), row("a", "sam", "t1")], error: null });
    expect(await takeoversFrom(c, "me", ["org"])).toEqual([row("a", "alex", "t2")]);
    expect(calls).toContainEqual(["eq", "owner_user", "me"]);
    expect(calls).toContainEqual(["in", "org_id", ["org"]]);
  });

  it("has none on an error", async () => {
    const { c } = client({ data: null, error: { code: "PGRST205", message: "missing" } });
    expect(await takeoversFrom(c, "me", ["org"])).toEqual([]);
    const bad = client({ data: null, error: { message: "down" } });
    expect(await takeoversFrom(bad.c, "me", ["org"])).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("noteTakeovers", () => {
  it("marks each local card the first time, and skips one already marked or not here", () => {
    store.getCard.mockImplementation((id: string) =>
      id === "a" ? ({ id } as Card) : id === "b" ? ({ id, takenOverBy: { name: "Sam", at: "t1" } } as Card) : undefined,
    );
    noteTakeovers([row("a", "alex", "t2"), row("b", "sam", "t1"), row("c", "sam", "t1")], (u) => (u === "alex" ? "Alex" : "Sam"));
    expect(store.updateCard.mock.calls).toEqual([["a", { takenOverBy: { name: "Alex", at: "t2" } }]]);
  });
});
