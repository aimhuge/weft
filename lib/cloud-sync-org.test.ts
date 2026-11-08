// The personal-workspace lookup behind every flush (lib/cloud-sync.ts resolveOrgId, through syncOrgId): a workspace
// found is kept, and "no workspace yet" is asked again a minute on, so one made later syncs without a restart.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSyncOrg, NO_ORG_RECHECK_MS, syncOrgId } from "./cloud-sync";

type Answer = { data: { org_id: string } | null; error: { message: string } | null };

function fakeClient(answer: () => Answer) {
  const lookups: unknown[][] = [];
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => (lookups.push(args), chain),
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(answer()),
  };
  return { client: { from: () => chain } as never, asked: () => lookups.length / 2 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  forgetSyncOrg();
});

afterEach(() => vi.useRealTimers());

describe("syncOrgId", () => {
  it("asks for the user's oldest owned workspace and keeps it", async () => {
    const f = fakeClient(() => ({ data: { org_id: "o1" }, error: null }));
    expect(await syncOrgId(f.client, "u1")).toBe("o1");
    vi.advanceTimersByTime(NO_ORG_RECHECK_MS * 10);
    expect(await syncOrgId(f.client, "u1")).toBe("o1");
    expect(f.asked()).toBe(1);
  });

  it("keeps a 'no workspace' answer for a minute, then asks again and finds one made since", async () => {
    let org: string | null = null;
    const f = fakeClient(() => ({ data: org ? { org_id: org } : null, error: null }));
    expect(await syncOrgId(f.client, "u1")).toBeNull();
    org = "o2";
    vi.advanceTimersByTime(NO_ORG_RECHECK_MS - 1);
    expect(await syncOrgId(f.client, "u1")).toBeNull();
    expect(f.asked()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(await syncOrgId(f.client, "u1")).toBe("o2");
    expect(f.asked()).toBe(2);
    vi.advanceTimersByTime(NO_ORG_RECHECK_MS);
    expect(await syncOrgId(f.client, "u1")).toBe("o2");
    expect(f.asked()).toBe(2);
  });

  it("keeps each user's answer apart", async () => {
    const f = fakeClient(() => ({ data: null, error: null }));
    await syncOrgId(f.client, "u1");
    await syncOrgId(f.client, "u2");
    expect(f.asked()).toBe(2);
  });

  it("forgetSyncOrg drops a 'no workspace' answer too", async () => {
    const f = fakeClient(() => ({ data: null, error: null }));
    await syncOrgId(f.client, "u1");
    forgetSyncOrg();
    await syncOrgId(f.client, "u1");
    expect(f.asked()).toBe(2);
  });

  it("throws a failed lookup and remembers nothing", async () => {
    let fail = true;
    const f = fakeClient(() => (fail ? { data: null, error: { message: "down" } } : { data: { org_id: "o3" }, error: null }));
    await expect(syncOrgId(f.client, "u1")).rejects.toEqual({ message: "down" });
    fail = false;
    expect(await syncOrgId(f.client, "u1")).toBe("o3");
  });
});
