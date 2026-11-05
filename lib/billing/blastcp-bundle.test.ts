import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscription } = vi.hoisted(() => ({ subscription: vi.fn() }));
vi.mock("./billing", () => ({ billing: { subscription } }));

import { blastcpAnswer, blastcpBundle } from "./blastcp-bundle";

// lib/billing/blastcp-bundle.ts: the BlastCP tier a Weft plan gives one person, which BlastCP reads and applies.

const LIVE = { status: "active" as const, trialEnd: null };
const FUTURE = "2099-01-01T00:00:00.000Z";

describe("blastcpBundle", () => {
  it("gives every Team member Creator: each is a paid seat", () => {
    for (const role of ["owner", "admin", "member", null]) expect(blastcpBundle({ ...LIVE, plan: "team" }, role)).toBe("creator");
  });

  it("gives Pro's owners Creator, and the people they invite Free", () => {
    expect(blastcpBundle({ ...LIVE, plan: "pro" }, "owner")).toBe("creator");
    expect(blastcpBundle({ ...LIVE, plan: "pro" }, "admin")).toBe("free");
    expect(blastcpBundle({ ...LIVE, plan: "pro" }, "member")).toBe("free");
  });

  it("gives a live Open Source or Education grant's owner Creator", () => {
    expect(blastcpBundle({ plan: "oss", status: "active", trialEnd: FUTURE }, "owner")).toBe("creator");
    expect(blastcpBundle({ plan: "edu", status: "active", trialEnd: FUTURE }, "owner")).toBe("creator");
  });

  it("drops a lapsed grant to Free", () => {
    expect(blastcpBundle({ plan: "oss", status: "active", trialEnd: "2020-01-01T00:00:00.000Z" }, "owner")).toBe("free");
    expect(blastcpBundle({ plan: "edu", status: "active", trialEnd: null }, "owner")).toBe("free");
  });

  it("gives Free on Free", () => {
    expect(blastcpBundle({ ...LIVE, plan: "free" }, "owner")).toBe("free");
  });

  it("counts trialing, and gives Free while a payment fails or after a cancel", () => {
    expect(blastcpBundle({ plan: "team", status: "trialing", trialEnd: null }, "member")).toBe("creator");
    for (const status of ["past_due", "canceled", "incomplete"] as const) {
      expect(blastcpBundle({ plan: "team", status, trialEnd: null }, "owner")).toBe("free");
    }
  });
});

describe("blastcpAnswer", () => {
  function service(rows: unknown[] | null, error: { message: string } | null = null) {
    const eq = vi.fn(() => Promise.resolve({ data: rows, error }));
    return { client: { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) } as never, eq };
  }
  const sub = (plan: string, end: string, extra: Record<string, unknown> = {}) => ({ plan, status: "active", trialEnd: null, currentPeriodEnd: end, ...extra });

  beforeEach(() => vi.clearAllMocks());

  it("gives Free with no workspace that gives Creator", async () => {
    subscription.mockResolvedValue(sub("free", "2026-11-01T00:00:00.000Z"));
    const svc = service([{ org_id: "o1", role: "owner" }]);
    expect(await blastcpAnswer(svc.client, "u1")).toEqual({ tier: "free", until: null });
    expect(svc.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("takes the best workspace, and the latest end among those giving Creator", async () => {
    subscription.mockImplementation((_s: unknown, orgId: string) =>
      Promise.resolve(
        { o1: sub("free", "2026-12-01T00:00:00.000Z"), o2: sub("team", "2026-11-05T00:00:00.000Z"), o3: sub("pro", "2026-11-20T00:00:00.000Z") }[orgId],
      ),
    );
    const svc = service([{ org_id: "o1", role: "owner" }, { org_id: "o2", role: "member" }, { org_id: "o3", role: "owner" }]);
    expect(await blastcpAnswer(svc.client, "u1")).toEqual({ tier: "creator", until: "2026-11-20T00:00:00.000Z" });
  });

  it("dates a grant by its end, not its rolling period", async () => {
    subscription.mockResolvedValue(sub("oss", "2026-11-01T00:00:00.000Z", { trialEnd: "2027-06-01T00:00:00.000Z" }));
    expect(await blastcpAnswer(service([{ org_id: "o1", role: "owner" }]).client, "u1")).toEqual({ tier: "creator", until: "2027-06-01T00:00:00.000Z" });
  });

  it("gives Free to someone in no workspace", async () => {
    expect(await blastcpAnswer(service(null).client, "u1")).toEqual({ tier: "free", until: null });
    expect(subscription).not.toHaveBeenCalled();
  });

  it("throws when memberships can't be read", async () => {
    await expect(blastcpAnswer(service(null, { message: "down" }).client, "u1")).rejects.toThrow("down");
  });
});
