import { describe, expect, it, vi } from "vitest";

// /api/worktrees: the New thread dialog's isolate menu warms the folder's worktree pool (lib/worktree-pool.ts) with
// POST, and lists its repo's branches with GET.

const pool = vi.hoisted(() => ({ warmPool: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/worktree-pool", () => pool);
const wt = vi.hoisted(() => ({
  repoRootOf: vi.fn((cwd: string) => Promise.resolve(cwd === "/nogit" ? undefined : "/repo")),
  listBranches: vi.fn(() => Promise.resolve([{ name: "main", at: 2, worktree: "/repo" }, { name: "feat/x", at: 1 }])),
}));
vi.mock("@/lib/worktrees", () => wt);

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

describe("GET /worktrees", () => {
  const get = (q: string, headers: Record<string, string> = { host: "localhost:3457", "x-weft-token": "1" }) =>
    route.GET(new Request(`http://localhost:3457/api/worktrees${q}`, { headers }));

  it("lists the repo's branches, and none outside git", async () => {
    expect(await (await get("?cwd=%2Frepo%2Fweb")).json()).toEqual({ root: "/repo", branches: [{ name: "main", at: 2, worktree: "/repo" }, { name: "feat/x", at: 1 }] });
    expect(await (await get("?cwd=%2Fnogit")).json()).toEqual({ root: null, branches: [] });
  });

  it("turns away a missing folder and a request without the token", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?cwd=%2Frepo", { host: "localhost:3457" })).status).toBe(403);
  });
});
