import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/a/<id>/<missing>", () => {
  it("is a plain-text 404, not the HTML not-found page", async () => {
    const res = GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("Not found");
  });
});
