// lib/badge-facts.ts: reads the league and social badge facts from weft.zip's badge_facts RPC on the league timer,
// keeps them in ~/.weft, and reads them back for the game.
import fs from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signedIn: vi.fn() }));
vi.mock("./signed-in-client", () => ({ safeClient: () => null, signedIn: auth.signedIn }));

const { BADGE_FACTS_FILE, readBadgeFacts, syncBadgeFacts, toBadgeFacts } = await import("./badge-facts");

const clientWith = (data: unknown, error: { message: string; code?: string } | null = null) =>
  ({ rpc: vi.fn(() => Promise.resolve({ data, error })) }) as unknown as SupabaseClient;

afterEach(() => {
  fs.rmSync(BADGE_FACTS_FILE, { force: true });
  auth.signedIn.mockReset();
});

describe("toBadgeFacts", () => {
  it("keeps well-formed weeks and counts", () => {
    expect(toBadgeFacts({ weeks: [{ week: "2026-10-19", tier: 2, rank: 1, size: 9, done: true }, { tier: 1 }], referrals: 3, team: 5 })).toEqual({
      leagueWeeks: [{ week: "2026-10-19", tier: 2, rank: 1, size: 9, done: true }],
      referrals: 3,
      teamSize: 5,
    });
  });

  it("reads anything malformed as nothing", () => {
    expect(toBadgeFacts(null)).toEqual({ leagueWeeks: [], referrals: 0, teamSize: 0 });
    expect(toBadgeFacts({ weeks: [{ week: "2026-10-19", tier: "x", done: 1 }], referrals: Infinity })).toEqual({
      leagueWeeks: [{ week: "2026-10-19", tier: 0, rank: 0, size: 0, done: false }],
      referrals: 0,
      teamSize: 0,
    });
  });
});

describe("syncBadgeFacts", () => {
  it("does nothing signed out", async () => {
    expect(await syncBadgeFacts()).toBe(false);
    auth.signedIn.mockResolvedValue(false);
    expect(await syncBadgeFacts({ client: () => clientWith({}) })).toBe(false);
  });

  it("saves what the RPC returned, for readBadgeFacts", async () => {
    auth.signedIn.mockResolvedValue(true);
    expect(await syncBadgeFacts({ client: () => clientWith({ weeks: [], referrals: 1, team: 2 }) })).toBe(true);
    expect(readBadgeFacts()).toEqual({ leagueWeeks: [], referrals: 1, teamSize: 2 });
  });

  it("waits quietly while the RPC isn't deployed, and throws on other errors", async () => {
    auth.signedIn.mockResolvedValue(true);
    expect(await syncBadgeFacts({ client: () => clientWith(null, { message: "no fn", code: "PGRST202" }) })).toBe(false);
    await expect(syncBadgeFacts({ client: () => clientWith(null, { message: "boom" }) })).rejects.toThrow("boom");
  });
});

describe("readBadgeFacts", () => {
  it("is empty before any sync", () => {
    expect(readBadgeFacts()).toEqual({});
  });
});
