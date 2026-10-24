import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { LimitEntry } from "./limit-board";

const account = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("./account", () => ({ accountClient: account.client }));
vi.mock("./game-server", () => ({
  gameState: vi.fn(() => ({ limitHits: { fiveHour: 3, sevenDay: 1, fastest: { fiveHour: { ms: 3600000, at: Date.UTC(2026, 9, 20) } } } })),
}));

const { limitBoardView, NOT_DEPLOYED, syncLimits } = await import("./limit-board-sync");

const ENTRY: LimitEntry = { fiveMs: 600000, fiveAt: "2026-10-20T00:00:00.000Z", weekMs: null, weekAt: null, fiveHits: 4, weekHits: 0 };
const ROW = { rank: 1, user_id: "u1", name: "Alex", avatar_url: null, username: "fotoflo", value: 600000, at: "2026-10-20T00:00:00Z", is_me: true };

function fake({ session = true, submitError = null as string | null, code = undefined as string | undefined, rows = [ROW] as unknown[] | null, boardError = null as string | null } = {}) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === "limit_submit" ? { error: submitError ? { message: submitError, code } : null } : { data: rows, error: boardError ? { message: boardError } : null },
    ),
  );
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: session ? {} : null } }) }, rpc };
  return { client: client as unknown as SupabaseClient, rpc };
}

describe("syncLimits", () => {
  it("posts the records when signed in", async () => {
    const { client, rpc } = fake();
    expect(await syncLimits({ client: () => client, entry: () => ENTRY })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("limit_submit", { p_five_ms: 600000, p_five_at: ENTRY.fiveAt, p_week_ms: null, p_week_at: null, p_five_hits: 4, p_week_hits: 0 });
  });

  it("does nothing signed out or without accounts", async () => {
    const { client, rpc } = fake({ session: false });
    expect(await syncLimits({ client: () => client })).toBe(false);
    expect(await syncLimits({ client: () => null })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads its own game state by default, and names a missing migration", async () => {
    const { client, rpc } = fake({ submitError: "no fn", code: "PGRST202" });
    await expect(syncLimits({ client: () => client })).rejects.toThrow(NOT_DEPLOYED);
    expect(rpc).toHaveBeenCalledWith("limit_submit", expect.objectContaining({ p_five_ms: 3600000, p_five_hits: 3, p_week_hits: 1 }));
    account.client.mockReturnValueOnce(null);
    expect(await syncLimits()).toBe(false);
  });
});

describe("limitBoardView", () => {
  it("posts, then reads the board", async () => {
    const { client, rpc } = fake();
    const view = await limitBoardView("five_hour", { client: () => client, entry: () => ENTRY });
    expect(rpc).toHaveBeenLastCalledWith("limit_board", { p_board: "five_hour" });
    expect(view).toMatchObject({ state: "ready", board: "five_hour", rows: [{ name: "Alex", value: 600000, isMe: true }] });
    expect(await limitBoardView("seven_day", { client: () => fake({ rows: null }).client, entry: () => ENTRY })).toEqual({ state: "ready", board: "seven_day", rows: [] });
  });

  it("is signed-out without a session", async () => {
    expect(await limitBoardView("five_hour", { client: () => fake({ session: false }).client })).toEqual({ state: "signed-out" });
    expect(await limitBoardView("five_hour", { client: () => null })).toEqual({ state: "signed-out" });
  });

  it("turns errors into an error view", async () => {
    expect(await limitBoardView("five_hour", { client: () => fake({ boardError: "boom" }).client, entry: () => ENTRY })).toEqual({ state: "error", error: "boom" });
    expect(await limitBoardView("five_hour", { client: () => fake({ submitError: "nope" }).client, entry: () => ENTRY })).toEqual({ state: "error", error: "nope" });
    const throwing = () => {
      // A non-Error throw, for the String(err) branch.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "odd";
    };
    expect(await limitBoardView("five_hour", { client: () => fake().client, entry: throwing })).toEqual({ state: "error", error: "odd" });
  });
});
