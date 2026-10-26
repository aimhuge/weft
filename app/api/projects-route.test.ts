// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The /projects route's PATCH: a project chip is pinned or hidden from the board, and the route passes on
// only the marks the client sent, so one field never clears the other.

vi.mock("@/lib/settings", () => ({
  listProjects: vi.fn(() => []),
  touchProject: vi.fn(),
  removeProject: vi.fn(),
  markProject: vi.fn(),
}));

const projectsRoute = await import("./projects/route");
const settings = await import("@/lib/settings");

// A write route: the guard checks the host and the x-weft-token header before the handler sees the request.
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(body: unknown) {
  return new Request("http://localhost:3457/api/projects", {
    method: "PATCH",
    headers: WRITE,
    body: JSON.stringify(body),
  });
}

describe("PATCH /projects", () => {
  it("pins or hides a project, passing on only the marks sent", async () => {
    const res = await projectsRoute.PATCH(req({ path: "/p", pinned: true, hidden: "yes" }));
    expect(res.status).toBe(200);
    expect(settings.markProject).toHaveBeenCalledWith("/p", { pinned: true });
    await projectsRoute.PATCH(req({ path: "/p", hidden: false }));
    expect(settings.markProject).toHaveBeenLastCalledWith("/p", { hidden: false });
  });

  it("400s a missing folder", async () => {
    expect((await projectsRoute.PATCH(req({ pinned: true }))).status).toBe(400);
  });
});
