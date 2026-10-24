import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/oss-grant.ts: granting Open Source at sign-in, and from the billing page's button. The billing
// binding, the workspace lookup and the GitHub read are mocked, so the test pins the decision (skip / grant /
// not eligible) without touching Supabase or GitHub.

const { subscription, saveSubscription, billingService, orgForUser, openSourceRepo } = vi.hoisted(() => ({
  subscription: vi.fn(),
  saveSubscription: vi.fn(),
  billingService: vi.fn(),
  orgForUser: vi.fn(),
  openSourceRepo: vi.fn(),
}));
vi.mock("./billing", () => ({ billing: { subscription, saveSubscription }, billingService }));
vi.mock("./org", () => ({ orgForUser }));
vi.mock("./oss", () => ({ openSourceRepo }));

async function load() {
  vi.resetModules();
  return import("./oss-grant");
}

const getUserById = vi.fn();
const service = { auth: { admin: { getUserById } } } as never;
const NOW = new Date("2026-10-13T12:00:00.000Z");
const ORG = { id: "org1", slug: "ada", name: "Ada" };

function sub(over: Record<string, unknown> = {}) {
  return { plan: "free", status: "active", trialEnd: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserById.mockReset();
  subscription.mockResolvedValue(sub());
  saveSubscription.mockResolvedValue({});
  orgForUser.mockResolvedValue(ORG);
  openSourceRepo.mockResolvedValue(null);
  billingService.mockReturnValue(service);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("githubLogin", () => {
  it("reads user_metadata.user_name", async () => {
    const { githubLogin } = await load();
    expect(githubLogin({ user_metadata: { user_name: "ada" } })).toBe("ada");
  });

  it("returns null for an empty name", async () => {
    const { githubLogin } = await load();
    expect(githubLogin({ user_metadata: { user_name: "" } })).toBeNull();
  });

  it("returns null when the metadata has no user_name", async () => {
    const { githubLogin } = await load();
    expect(githubLogin({ user_metadata: {} })).toBeNull();
  });

  it("returns null when there is no user at all", async () => {
    const { githubLogin } = await load();
    expect(githubLogin(null)).toBeNull();
    expect(githubLogin(undefined)).toBeNull();
  });

  it("returns null when user_metadata is null", async () => {
    const { githubLogin } = await load();
    expect(githubLogin({ user_metadata: null })).toBeNull();
  });

  it("returns null when user_name is not a string", async () => {
    const { githubLogin } = await load();
    expect(githubLogin({ user_metadata: { user_name: 42 } })).toBeNull();
  });
});

describe("checkOpenSource", () => {
  it("skips a sign-in with no GitHub login", async () => {
    const { checkOpenSource } = await load();
    expect(await checkOpenSource(service, "u1", null, { now: NOW })).toEqual({ kind: "skipped", reason: "no-login" });
    expect(orgForUser).not.toHaveBeenCalled();
  });

  it("skips a user with no workspace", async () => {
    orgForUser.mockResolvedValueOnce(null);
    const { checkOpenSource } = await load();
    expect(await checkOpenSource(service, "u1", "ada", { now: NOW })).toEqual({ kind: "skipped", reason: "no-workspace" });
    expect(openSourceRepo).not.toHaveBeenCalled();
  });

  it("skips a paying workspace", async () => {
    subscription.mockResolvedValueOnce(sub({ plan: "pro", status: "active" }));
    const { checkOpenSource } = await load();
    expect(await checkOpenSource(service, "u1", "ada", { now: NOW })).toEqual({ kind: "skipped", reason: "paid" });
    expect(openSourceRepo).not.toHaveBeenCalled();
  });

  it("skips a grant with more than 30 days left", async () => {
    subscription.mockResolvedValueOnce(sub({ plan: "oss", status: "active", trialEnd: "2026-12-01T00:00:00.000Z" }));
    const { checkOpenSource } = await load();
    expect(await checkOpenSource(service, "u1", "ada", { now: NOW })).toEqual({ kind: "skipped", reason: "not-due" });
    expect(openSourceRepo).not.toHaveBeenCalled();
  });

  it("checks a grant that ends within 30 days", async () => {
    subscription.mockResolvedValueOnce(sub({ plan: "oss", status: "active", trialEnd: "2026-11-01T00:00:00.000Z" }));
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { checkOpenSource } = await load();
    const result = await checkOpenSource(service, "u1", "ada", { now: NOW });
    expect(result.kind).toBe("granted");
    expect(openSourceRepo).toHaveBeenCalledWith("ada", expect.objectContaining({ now: NOW }));
  });

  it("checks a lapsed education grant", async () => {
    subscription.mockResolvedValueOnce(sub({ plan: "edu", status: "active", trialEnd: "2026-01-01T00:00:00.000Z" }));
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { checkOpenSource } = await load();
    const result = await checkOpenSource(service, "u1", "ada", { now: NOW });
    expect(result.kind).toBe("granted");
    expect(openSourceRepo).toHaveBeenCalled();
  });

  it("checks a free workspace", async () => {
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { checkOpenSource } = await load();
    const result = await checkOpenSource(service, "u1", "ada", { now: NOW });
    expect(result.kind).toBe("granted");
    expect(openSourceRepo).toHaveBeenCalled();
  });

  it("reports not-eligible when the user maintains no qualifying repo", async () => {
    openSourceRepo.mockResolvedValueOnce(null);
    const { checkOpenSource } = await load();
    expect(await checkOpenSource(service, "u1", "ada", { now: NOW })).toEqual({ kind: "not-eligible" });
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("grants the workspace when the user maintains a qualifying repo", async () => {
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { checkOpenSource } = await load();
    const result = await checkOpenSource(service, "u1", "ada", { now: NOW });
    expect(result).toEqual({
      kind: "granted",
      repo: "ada/loom",
      outcome: { granted: true, plan: "oss", periodEnd: "2027-10-13T12:00:00.000Z" },
    });
    expect(saveSubscription).toHaveBeenCalledWith(
      service,
      "org1",
      expect.objectContaining({ plan: "oss", trialEnd: "2027-10-13T12:00:00.000Z" }),
    );
  });

  it("defaults to now when the deps carry no date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
      const { checkOpenSource } = await load();
      const result = await checkOpenSource(service, "u1", "ada");
      expect(result.kind).toBe("granted");
      expect(openSourceRepo).toHaveBeenCalledWith("ada", expect.objectContaining({ now: NOW }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checkOpenSourceFor", () => {
  it("reads the login from the user's auth record and runs the check", async () => {
    getUserById.mockResolvedValueOnce({ data: { user: { user_metadata: { user_name: "ada" } } } });
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { checkOpenSourceFor } = await load();
    const result = await checkOpenSourceFor(service, "u1", { now: NOW });
    expect(getUserById).toHaveBeenCalledWith("u1");
    expect(result).toMatchObject({ kind: "granted", repo: "ada/loom" });
  });

  it("skips when the auth record has no GitHub login", async () => {
    getUserById.mockResolvedValueOnce({ data: { user: null } });
    const { checkOpenSourceFor } = await load();
    expect(await checkOpenSourceFor(service, "u1", { now: NOW })).toEqual({ kind: "skipped", reason: "no-login" });
  });
});

describe("openSourceAfterSignIn", () => {
  const github = { userId: "u1", login: "ada", token: "gh-token" };

  it("returns null when there is no service client", async () => {
    const { openSourceAfterSignIn } = await load();
    expect(await openSourceAfterSignIn(github, { service: null })).toBeNull();
  });

  it("uses the default service client from billingService when none is given", async () => {
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { openSourceAfterSignIn } = await load();
    const result = await openSourceAfterSignIn(github);
    expect(billingService).toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "granted", repo: "ada/loom" });
    expect(openSourceRepo).toHaveBeenCalledWith("ada", expect.objectContaining({ token: "gh-token" }));
  });

  it("returns the check's answer on success", async () => {
    openSourceRepo.mockResolvedValueOnce({ full_name: "ada/loom" });
    const { openSourceAfterSignIn } = await load();
    const result = await openSourceAfterSignIn(github, { service, now: NOW });
    expect(result).toMatchObject({ kind: "granted", repo: "ada/loom" });
    expect(orgForUser).toHaveBeenCalledWith(service, "u1");
  });

  it("returns null and logs when the check throws an Error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    orgForUser.mockRejectedValueOnce(new Error("boom"));
    const { openSourceAfterSignIn } = await load();
    expect(await openSourceAfterSignIn(github, { service, now: NOW })).toBeNull();
    expect(error).toHaveBeenCalledWith("[billing/oss] sign-in check failed: boom");
  });

  it("returns null and logs when the check throws something that isn't an Error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    orgForUser.mockRejectedValueOnce("just a string");
    const { openSourceAfterSignIn } = await load();
    expect(await openSourceAfterSignIn(github, { service, now: NOW })).toBeNull();
    expect(error).toHaveBeenCalledWith("[billing/oss] sign-in check failed: just a string");
  });
});
