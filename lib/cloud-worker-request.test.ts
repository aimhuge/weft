import { describe, expect, it, vi } from "vitest";
import { backTo, CLOUD_REQUEST_TITLE, handleRequest, MAX_USE, parseRequest, requestPayload } from "./cloud-worker-request";

// lib/cloud-worker-request.ts: the home page's Cloud Workers request form, checked and sent the feedback dot's way.

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const post = (fields: Record<string, string> | null, headers: Record<string, string> = {}) =>
  new Request("https://weft.zip/api/cloud-workers/request", {
    method: "POST",
    headers,
    body: fields ? form(fields) : "not a form",
  });

describe("parseRequest", () => {
  it("takes what they'd use it for and an email, trimmed", () => {
    expect(parseRequest(form({ use: "  overnight refactors ", email: " a@b.co ", name: " Ada " }))).toEqual({
      use: "overnight refactors",
      email: "a@b.co",
      name: "Ada",
    });
  });

  it("leaves the name out when it's blank", () => {
    expect(parseRequest(form({ use: "x", email: "a@b.co" }))?.name).toBeNull();
  });

  it("clips a long answer", () => {
    expect(parseRequest(form({ use: "y".repeat(MAX_USE + 50), email: "a@b.co" }))?.use).toHaveLength(MAX_USE);
  });

  it("refuses a missing answer, a missing email or one that isn't an address", () => {
    expect(parseRequest(form({ email: "a@b.co" }))).toBeNull();
    expect(parseRequest(form({ use: "  ", email: "a@b.co" }))).toBeNull();
    expect(parseRequest(form({ use: "x" }))).toBeNull();
    expect(parseRequest(form({ use: "x", email: "nope" }))).toBeNull();
  });
});

describe("requestPayload", () => {
  it("is a feedback summary titled as a cloud worker request, from the person who asked", () => {
    const p = requestPayload({ use: "CI on my phone", email: "a@b.co", name: null });
    expect(p.summary.title).toBe(CLOUD_REQUEST_TITLE);
    expect(p.summary.body).toContain("CI on my phone");
    expect(p.from).toEqual({ name: null, email: "a@b.co" });
    expect(p.messages).toEqual([]);
  });
});

describe("backTo", () => {
  it("goes back to the same-origin page the form was on", () => {
    expect(backTo(post(null, { referer: "https://weft.zip/home?x=1" }), true).href).toBe("https://weft.zip/home#wz-cloudSent");
  });

  it("goes to the home page for another origin, a bad referer or none", () => {
    expect(backTo(post(null, { referer: "https://evil.example/home" }), false).href).toBe("https://weft.zip/#wz-cloudFailed");
    expect(backTo(post(null, { referer: "not a url" }), true).href).toBe("https://weft.zip/#wz-cloudSent");
    expect(backTo(post(null), true).href).toBe("https://weft.zip/#wz-cloudSent");
  });
});

describe("handleRequest", () => {
  it("sends a good request on and lands on the thanks line", async () => {
    const collect = vi.fn(() => Promise.resolve(204));
    const res = await handleRequest(post({ use: "x", email: "a@b.co" }, { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), collect);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://weft.zip/#wz-cloudSent");
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ summary: { title: CLOUD_REQUEST_TITLE, body: expect.any(String) as string } }), "1.2.3.4");
  });

  it("lands on the failure line when the collector refuses it", async () => {
    const res = await handleRequest(post({ use: "x", email: "a@b.co" }), () => Promise.resolve(429));
    expect(res.headers.get("location")).toBe("https://weft.zip/#wz-cloudFailed");
  });

  it("doesn't call the collector for a bad form or a body that isn't one", async () => {
    const collect = vi.fn(() => Promise.resolve(204));
    expect((await handleRequest(post({ use: "x" }), collect)).headers.get("location")).toContain("#wz-cloudFailed");
    expect((await handleRequest(post(null), collect)).headers.get("location")).toContain("#wz-cloudFailed");
    expect(collect).not.toHaveBeenCalled();
  });

  it("uses the real collector by default", async () => {
    const res = await handleRequest(post({ use: "x" }));
    expect(res.headers.get("location")).toContain("#wz-cloudFailed");
  });
});
