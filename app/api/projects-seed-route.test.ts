import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/projects/seed: the project menu's Re-seed Backlog (lib/project-seed-run.ts).

const seedProject = vi.fn(() => Promise.resolve(2));
vi.mock("@/lib/project-seed-run", () => ({ seedProject }));

const route = await import("./projects/seed/route");

function post(body: unknown, token = "1") {
  return route.POST(
    new Request("http://localhost:3457/api/projects/seed", {
      method: "POST",
      headers: { host: "localhost:3457", "x-weft-token": token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => seedProject.mockClear());

describe("POST /api/projects/seed", () => {
  it("re-seeds the folder, forced, and answers how many cards it added", async () => {
    const res = await post({ path: "/tmp" });
    expect(seedProject).toHaveBeenCalledWith(expect.stringMatching(/tmp$/), { force: true });
    expect(await res.json()).toEqual({ added: 2 });
  });

  it("refuses no path and a request without the token", async () => {
    expect((await post({ path: " " })).status).toBe(400);
    expect((await post({ path: "/tmp" }, "")).status).toBe(403);
    expect(seedProject).not.toHaveBeenCalled();
  });
});
