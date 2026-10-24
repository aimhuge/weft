import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin console's billing routes: /api/admin/billing (the workspace list), /api/admin/billing/[orgId] (one
// workspace's picture and its changes) and /api/admin/coupons (the promotion codes and referrals). The gate and
// the work each route does are mocked, so this test pins the wiring: what the gate is asked, what the route reads
// off the request, and what the route answers.

const { adminGate, adminAnswer } = vi.hoisted(() => ({ adminGate: vi.fn(), adminAnswer: vi.fn() }));
vi.mock("@/lib/billing/admin/route-gate", () => ({ adminGate, adminAnswer }));

const { listOrgs, orgDetail } = vi.hoisted(() => ({ listOrgs: vi.fn(), orgDetail: vi.fn() }));
vi.mock("@/lib/billing/admin/snapshot", () => ({ listOrgs, orgDetail }));

const { runOrgOp } = vi.hoisted(() => ({ runOrgOp: vi.fn() }));
vi.mock("@/lib/billing/admin/dispatch", () => ({ runOrgOp }));

const { couponsView, runCouponOp } = vi.hoisted(() => ({ couponsView: vi.fn(), runCouponOp: vi.fn() }));
vi.mock("@/lib/billing/admin/coupon-ops", () => ({ couponsView, runCouponOp }));

const billingRoute = await import("./admin/billing/route");
const orgRoute = await import("./admin/billing/[orgId]/route");
const couponsRoute = await import("./admin/coupons/route");

const GATE = { service: { svc: true }, actorEmail: "ada@b.co", stripe: { id: "stripe", modes: () => ["live", "test"], defaultMode: () => "live" } };

const READ = { host: "127.0.0.1:3457", "x-weft-token": "1" };

function get(route: { GET: (req: Request, ctx?: unknown) => Promise<Response> }, path: string) {
  return route.GET(new Request(`http://127.0.0.1:3457${path}`, { headers: READ }));
}

function post(route: { POST: (req: Request, ctx?: unknown) => Promise<Response> }, path: string, body: unknown, ctx?: unknown) {
  return route.POST(new Request(`http://127.0.0.1:3457${path}`, { method: "POST", headers: READ, body: typeof body === "string" ? body : JSON.stringify(body) }), ctx);
}

const PARAMS = { params: Promise.resolve({ orgId: "org_1" }) };

// The org route needs its params; the others don't take any.
function postOrg(body: unknown) {
  return orgRoute.POST(new Request("http://127.0.0.1:3457/api/admin/billing/org_1", { method: "POST", headers: READ, body: typeof body === "string" ? body : JSON.stringify(body) }), PARAMS);
}

beforeEach(() => {
  vi.clearAllMocks();
  adminGate.mockResolvedValue(GATE);
  adminAnswer.mockImplementation(async (work: () => Promise<unknown>) => Response.json(await work()));
  listOrgs.mockResolvedValue([{ id: "org_1" }]);
  orgDetail.mockResolvedValue({ org: { id: "org_1" } });
  runOrgOp.mockResolvedValue({ ok: true });
  couponsView.mockResolvedValue({ mode: "live", coupons: [] });
  runCouponOp.mockResolvedValue({ ok: true });
});

describe("GET /api/admin/billing", () => {
  it("asks the gate for a read", async () => {
    await get(billingRoute, "/api/admin/billing");
    expect(adminGate).toHaveBeenCalledWith(expect.any(Request), false);
  });

  it("answers the workspace list, the keys and the default mode", async () => {
    const res = await get(billingRoute, "/api/admin/billing");
    expect(await res.json()).toEqual({ orgs: [{ id: "org_1" }], keys: ["live", "test"], defaultMode: "live" });
  });

  it("passes the search term on", async () => {
    await get(billingRoute, "/api/admin/billing?q=acme");
    expect(listOrgs).toHaveBeenCalledWith(GATE.service, "acme");
  });

  it("asks for an empty search when there is no ?q=", async () => {
    await get(billingRoute, "/api/admin/billing");
    expect(listOrgs).toHaveBeenCalledWith(GATE.service, "");
  });

  it("passes the gate's refusal straight through", async () => {
    const denied = Response.json({ error: "Forbidden host" }, { status: 403 });
    adminGate.mockResolvedValueOnce(denied);
    const res = await get(billingRoute, "/api/admin/billing");
    expect(res).toBe(denied);
    expect(listOrgs).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/billing/[orgId]", () => {
  it("asks the gate for a read and reads the org id off the params", async () => {
    await orgRoute.GET(new Request("http://127.0.0.1:3457/api/admin/billing/org_1", { headers: READ }), PARAMS);
    expect(adminGate).toHaveBeenCalledWith(expect.any(Request), false);
    expect(orgDetail).toHaveBeenCalledWith({ ...GATE, orgId: "org_1" });
  });

  it("answers the workspace's picture", async () => {
    const res = await orgRoute.GET(new Request("http://127.0.0.1:3457/api/admin/billing/org_1", { headers: READ }), PARAMS);
    expect(await res.json()).toEqual({ org: { id: "org_1" } });
  });

  it("passes the gate's refusal straight through", async () => {
    const denied = Response.json({ error: "Forbidden host" }, { status: 403 });
    adminGate.mockResolvedValueOnce(denied);
    const res = await orgRoute.GET(new Request("http://127.0.0.1:3457/api/admin/billing/org_1", { headers: READ }), PARAMS);
    expect(res).toBe(denied);
    expect(orgDetail).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/billing/[orgId]", () => {
  it("asks the gate for a write", async () => {
    await postOrg({ op: "comp" });
    expect(adminGate).toHaveBeenCalledWith(expect.any(Request), true);
  });

  it("runs the op against the workspace", async () => {
    await postOrg({ op: "comp", plan: "oss" });
    expect(runOrgOp).toHaveBeenCalledWith({ ...GATE, orgId: "org_1" }, { op: "comp", plan: "oss" });
  });

  it("answers the op's result", async () => {
    const res = await postOrg({ op: "comp" });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("treats a body that isn't JSON as no body at all", async () => {
    await postOrg("not json");
    expect(runOrgOp).toHaveBeenCalledWith({ ...GATE, orgId: "org_1" }, {});
  });

  it("passes the gate's refusal straight through", async () => {
    const denied = Response.json({ error: "Missing x-weft-token header" }, { status: 403 });
    adminGate.mockResolvedValueOnce(denied);
    const res = await postOrg({ op: "comp" });
    expect(res).toBe(denied);
    expect(runOrgOp).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/coupons", () => {
  it("asks the gate for a read", async () => {
    await get(couponsRoute, "/api/admin/coupons");
    expect(adminGate).toHaveBeenCalledWith(expect.any(Request), false);
  });

  it("asks for the mode in the query", async () => {
    await get(couponsRoute, "/api/admin/coupons?mode=test");
    expect(couponsView).toHaveBeenCalledWith(GATE, "test");
  });

  it("asks for no mode when there is none in the query", async () => {
    await get(couponsRoute, "/api/admin/coupons");
    expect(couponsView).toHaveBeenCalledWith(GATE, null);
  });

  it("answers the coupons view", async () => {
    const res = await get(couponsRoute, "/api/admin/coupons");
    expect(await res.json()).toEqual({ mode: "live", coupons: [] });
  });

  it("passes the gate's refusal straight through", async () => {
    const denied = Response.json({ error: "Forbidden host" }, { status: 403 });
    adminGate.mockResolvedValueOnce(denied);
    const res = await get(couponsRoute, "/api/admin/coupons");
    expect(res).toBe(denied);
    expect(couponsView).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/coupons", () => {
  it("asks the gate for a write", async () => {
    await post(couponsRoute, "/api/admin/coupons", { op: "create" });
    expect(adminGate).toHaveBeenCalledWith(expect.any(Request), true);
  });

  it("runs the op", async () => {
    await post(couponsRoute, "/api/admin/coupons", { op: "create", code: "SAVE20" });
    expect(runCouponOp).toHaveBeenCalledWith(GATE, { op: "create", code: "SAVE20" });
  });

  it("answers the op's result", async () => {
    const res = await post(couponsRoute, "/api/admin/coupons", { op: "create" });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("treats a body that isn't JSON as no body at all", async () => {
    await post(couponsRoute, "/api/admin/coupons", "not json");
    expect(runCouponOp).toHaveBeenCalledWith(GATE, {});
  });

  it("passes the gate's refusal straight through", async () => {
    const denied = Response.json({ error: "Missing x-weft-token header" }, { status: 403 });
    adminGate.mockResolvedValueOnce(denied);
    const res = await post(couponsRoute, "/api/admin/coupons", { op: "create" });
    expect(res).toBe(denied);
    expect(runCouponOp).not.toHaveBeenCalled();
  });
});
