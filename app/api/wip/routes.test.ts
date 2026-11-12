// A project menu's pull of a worker's uncommitted work (app/api/wip/route.ts); lib/wip-pull.test.ts covers the pull.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const guard = vi.hoisted(() => ({ elevated: null as Response | null }));
vi.mock("@/lib/guard", () => ({ elevated: () => guard.elevated, fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }) }));
const wip = vi.hoisted(() => ({ pullWip: vi.fn((): Promise<unknown> => Promise.resolve({ mac: "m1mini", changed: 2 })), pulledNote: vi.fn(() => "Pulled 2 files.") }));
vi.mock("@/lib/wip-pull", () => wip);

const route = await import("./route");
const post = (body: unknown) => route.POST(new Request("http://localhost/api/wip", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  guard.elevated = null;
  vi.clearAllMocks();
});

describe("POST /api/wip", () => {
  it("needs Weft's own window", async () => {
    guard.elevated = new Response("no", { status: 403 });
    expect((await post({ folder: "/repo", from: "worker://w1/repo" })).status).toBe(403);
    expect(wip.pullWip).not.toHaveBeenCalled();
  });

  it("needs the project and where from", async () => {
    expect((await post({ from: "worker://w1/repo" })).status).toBe(400);
    expect((await post({ folder: "/repo" })).status).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });

  it("pulls, and says what came", async () => {
    expect(await (await post({ folder: "/repo", from: "worker://w1/repo" })).json()).toEqual({ mac: "m1mini", changed: 2, note: "Pulled 2 files." });
    expect(wip.pullWip).toHaveBeenCalledWith("/repo", "worker://w1/repo", undefined, undefined);
  });

  it("says why it couldn't", async () => {
    wip.pullWip.mockRejectedValueOnce(new Error("That worker didn't answer. Is it online?"));
    const res = await post({ folder: "/repo", from: "worker://w1/repo" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That worker didn't answer. Is it online?" });
  });
});
