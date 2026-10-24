import { describe, expect, it, vi } from "vitest";

// POST /api/worktrees: the New thread dialog's Isolated switch warms the folder's worktree pool (lib/worktree-pool.ts).

const pool = vi.hoisted(() => ({ warmPool: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/worktree-pool", () => pool);

const route = await import("./worktrees/route");
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = WRITE) =>
  route.POST(new Request("http://localhost:3457/api/worktrees", { method: "POST", headers, body: JSON.stringify(body) }));

describe("POST /worktrees", () => {
  it("warms the folder's pool and answers at once", async () => {
    expect(await (await post({ cwd: "/Users/me/dev/weft" })).json()).toEqual({ ok: true });
    expect(pool.warmPool).toHaveBeenCalledWith("/Users/me/dev/weft");
  });

  it("turns away a relative or missing folder, and a request without the token", async () => {
    expect((await post({ cwd: "weft" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ cwd: "/x" }, { host: "localhost:3457" })).status).toBe(403);
    expect(pool.warmPool).toHaveBeenCalledTimes(1);
  });
});
