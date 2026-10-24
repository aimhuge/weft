import { describe, expect, it, vi } from "vitest";

// lib/billing/admin/site.ts: the deployed Weft's origin, for the URLs Stripe sends a customer back to.

import { siteOrigin } from "./site";

describe("siteOrigin", () => {
  it("is weft.zip when nothing is configured", () => {
    expect(siteOrigin({})).toBe("https://weft.zip");
  });

  it("uses NEXT_PUBLIC_SITE_URL when it is set", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://weft.example" })).toBe("https://weft.example");
  });

  it("drops trailing slashes", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://weft.example///" })).toBe("https://weft.example");
  });

  it("falls back to weft.zip on an empty variable", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "" })).toBe("https://weft.zip");
  });

  it("falls back to weft.zip when the variable is null", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: undefined })).toBe("https://weft.zip");
  });

  it("reads process.env by default", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://from-env.example");
    expect(siteOrigin()).toBe("https://from-env.example");
    vi.unstubAllEnvs();
  });
});
