// weft.zip's ICE servers (lib/web-ice.ts): TURN only for a signed-in owner of a live worker, a few times a minute.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownsWorker, resetWebIceLimits, WEB_ICE_PER_MINUTE, webIce } from "./web-ice";

const TURN = { iceServers: [{ urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" }], turn: true };

// cloud_workers as supabase-js chains the owner read; records the filters it was given.
function db(rows: unknown[] | null, error: unknown = null) {
  const asked: unknown[] = [];
  const supabase = {
    from: (table: string) => (asked.push(table), {
      select: (cols: string) => (asked.push(cols), {
        eq: (col: string, id: string) => (asked.push([col, id]), {
          is: (c: string, v: null) => (asked.push([c, v]), { limit: (n: number) => (asked.push(n), Promise.resolve({ data: rows, error })) }),
        }),
      }),
    }),
  };
  return { supabase, asked };
}

beforeEach(() => resetWebIceLimits());

describe("ownsWorker", () => {
  it("looks for an unrevoked worker the visitor owns", async () => {
    const { supabase, asked } = db([{ id: "w1" }]);
    await expect(ownsWorker(supabase as never, "u1")).resolves.toBe(true);
    expect(asked).toEqual(["cloud_workers", "id", ["owner_user", "u1"], ["revoked_at", null], 1]);
  });

  it("is false with none, no data or an error", async () => {
    await expect(ownsWorker(db([]).supabase as never, "u1")).resolves.toBe(false);
    await expect(ownsWorker(db(null).supabase as never, "u1")).resolves.toBe(false);
    await expect(ownsWorker(db([{ id: "w1" }], { message: "x" }).supabase as never, "u1")).resolves.toBe(false);
  });
});

describe("webIce", () => {
  it("mints for an owner", async () => {
    const mint = vi.fn(() => Promise.resolve(TURN));
    await expect(webIce({ supabase: db([{ id: "w1" }]).supabase, user: { id: "u1" } }, 0, mint)).resolves.toEqual({ status: 200, body: TURN });
  });

  it("asks a signed-out visitor to sign in, and refuses one who owns no worker, minting nothing", async () => {
    const mint = vi.fn(() => Promise.resolve(TURN));
    expect((await webIce({ supabase: db([]).supabase, user: null }, 0, mint)).status).toBe(401);
    expect((await webIce({ supabase: db([]).supabase, user: { id: "u1" } }, 0, mint)).status).toBe(403);
    expect(mint).not.toHaveBeenCalled();
  });

  it("caps each account per minute, before reading or minting", async () => {
    const mint = vi.fn(() => Promise.resolve(TURN));
    const owner = { supabase: db([{ id: "w1" }]).supabase, user: { id: "u1" } };
    for (let i = 0; i < WEB_ICE_PER_MINUTE; i++) expect((await webIce(owner, 1_000, mint)).status).toBe(200);
    await expect(webIce(owner, 1_000, mint)).resolves.toEqual({ status: 429, body: { error: "Too many requests." }, retryAfter: 60 });
    expect(mint).toHaveBeenCalledTimes(WEB_ICE_PER_MINUTE);
    expect((await webIce({ ...owner, user: { id: "u2" } }, 1_000, mint)).status).toBe(200);
    expect((await webIce(owner, 61_000, mint)).status).toBe(200);
  });

  it("mints with the server's own TURN key by default", async () => {
    vi.resetModules();
    vi.doMock("./rtc-ice", () => ({ mintIce: () => Promise.resolve(TURN) }));
    const fresh = await import("./web-ice");
    await expect(fresh.webIce({ supabase: db([{ id: "w1" }]).supabase, user: { id: "u1" } })).resolves.toEqual({ status: 200, body: TURN });
    vi.doUnmock("./rtc-ice");
  });
});
