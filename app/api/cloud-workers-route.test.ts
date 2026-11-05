import { describe, expect, it, vi } from "vitest";

// /api/cloud-workers/request: the home page's Cloud Workers form, handed straight to lib/cloud-worker-request.ts.

const handleRequest = vi.fn(() => Promise.resolve(new Response(null, { status: 303 })));
vi.mock("@/lib/cloud-worker-request", () => ({ handleRequest }));
const route = await import("./cloud-workers/request/route");

describe("POST /api/cloud-workers/request", () => {
  it("hands the request on, with no localhost guard", async () => {
    const req = new Request("https://weft.zip/api/cloud-workers/request", { method: "POST" });
    expect((await route.POST(req)).status).toBe(303);
    expect(handleRequest).toHaveBeenCalledWith(req);
  });
});
