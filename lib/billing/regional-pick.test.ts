import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/regional-pick.ts: which regional Pro price a workspace's Checkout sells. The billing profile read
// is mocked: a profile that can't be read just means the IP decides on its own.

const { profile } = vi.hoisted(() => ({ profile: vi.fn() }));
vi.mock("./billing", () => ({ billing: { profile } }));

async function load() {
  vi.resetModules();
  return import("./regional-pick");
}

beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({ country: null });
});

const service = {} as never;

describe("regionalPick", () => {
  it("falls back to the IP when the billing profile can't be read", async () => {
    profile.mockRejectedValueOnce(new Error("no profile"));
    const { regionalPick } = await load();
    expect(await regionalPick(service, "org1", "AF")).toEqual({
      tier: "low",
      variant: "regional_low",
      monthlyCents: 500,
    });
  });

  it("uses the billing profile's country when it qualifies", async () => {
    profile.mockResolvedValueOnce({ country: "BD" });
    const { regionalPick } = await load();
    expect(await regionalPick(service, "org1", "US")).toEqual({
      tier: "lowerMiddle",
      variant: "regional_lower_middle",
      monthlyCents: 1000,
    });
  });

  it("returns null when neither the IP nor the profile country qualifies", async () => {
    profile.mockResolvedValueOnce({ country: "US" });
    const { regionalPick } = await load();
    expect(await regionalPick(service, "org1", "GB")).toBeNull();
  });

  it("returns null when the IP is missing and the profile has no country", async () => {
    const { regionalPick } = await load();
    expect(await regionalPick(service, "org1", null)).toBeNull();
    expect(await regionalPick(service, "org1", undefined)).toBeNull();
  });

  it("names the IP country header Vercel sends", async () => {
    const { IP_COUNTRY_HEADER } = await load();
    expect(IP_COUNTRY_HEADER).toBe("x-vercel-ip-country");
  });
});
