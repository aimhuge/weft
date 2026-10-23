import { describe, expect, it } from "vitest";
import { isLocalHost, posthogConfig } from "./analytics-gate";
import { serverPosthogConfig } from "./analytics-server";

describe("posthogConfig", () => {
  it("needs both the token and the host", () => {
    expect(posthogConfig("phc_x", "https://us.i.posthog.com")).toEqual({ token: "phc_x", host: "https://us.i.posthog.com" });
    expect(posthogConfig("phc_x", "")).toBeNull();
    expect(posthogConfig(undefined, "https://us.i.posthog.com")).toBeNull();
  });
});

describe("isLocalHost", () => {
  it("treats every way a Mac reaches its own board as local", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "::1", "", "weft.localhost"]) expect(isLocalHost(host)).toBe(true);
  });

  it("lets weft.zip and preview deploys through", () => {
    expect(isLocalHost("weft.zip")).toBe(false);
    expect(isLocalHost("weft-git-main.vercel.app")).toBe(false);
  });
});

describe("serverPosthogConfig", () => {
  const keys = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_x", NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com" };

  it("stays off on a Mac even with the keys set", () => {
    expect(serverPosthogConfig(keys)).toBeNull();
  });

  it("turns on for the deployed Weft with both keys", () => {
    expect(serverPosthogConfig({ ...keys, VERCEL: "1" })).toEqual({ token: "phc_x", host: "https://us.i.posthog.com" });
    expect(serverPosthogConfig({ VERCEL: "1" })).toBeNull();
  });
});
