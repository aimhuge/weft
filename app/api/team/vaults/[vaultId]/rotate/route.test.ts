// The rotate route: POST /api/team/vaults/<vaultId>/rotate.
//
// The gate and the writer are mocked at their boundaries, the way
// app/api/team/vaults/[vaultId]/recovery/route.test.ts does it: a fake team gate and a fake
// applyRotate. What these tests care about is the wire — which status a caller gets, what the
// writer was handed, and what never leaves.
//
// The rules under test, in one line each:
//   - only an admin may rotate (a rotate takes a teammate's access away)
//   - a vault from another workspace is a 404, the same as one that doesn't exist
//   - a malformed body is a 400, and nothing is written
//   - the plan handed to the writer is the body's plan, with the vault id from the URL
//   - a refused plan is a 400 with the reason
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const bearerUser = vi.hoisted(() => vi.fn());
const webUser = vi.hoisted(() => vi.fn());
const teamAccessFor = vi.hoisted(() => vi.fn());
const bearerSupabase = vi.hoisted(() => vi.fn());
const webClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web-session", () => ({ bearerUser, webUser, bearerSupabase, webClient }));
vi.mock("@/lib/teams", () => ({ teamAccessFor }));

// The writer the route calls, with the shape of its arguments so the test can read what it was
// handed without an `any` in the way.
type ApplyRotateArgs = [unknown, unknown, unknown];
const applyRotate = vi.hoisted(() => vi.fn<(...args: ApplyRotateArgs) => Promise<unknown>>());
vi.mock("@/lib/team-vault-rotate", () => ({ applyRotate }));

const route = await import("./route");

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };

// The service client the route's queries use: one vault in this workspace, one in another.
const VAULTS = [
  { id: "v1", org_id: "o1", current_key_version: 1 },
  { id: "v2", org_id: "o2", current_key_version: 1 },
];

function makeDb() {
  const db: Record<string, Record<string, unknown>[]> = { vaults: VAULTS.map((v) => ({ ...v })) };
  const from = vi.fn((table: string) => {
    const rows = db[table] ?? [];
    const eqs: [string, unknown][] = [];
    let single = false;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((k: string, v: unknown) => {
      eqs.push([k, v]);
      return chain;
    });
    chain.in = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => {
      single = true;
      return chain;
    });
    chain.single = vi.fn(() => {
      single = true;
      return chain;
    });
    Object.defineProperty(chain, "then", {
      value: (resolve: (v: unknown) => void) => {
        const found = rows.filter((r) => eqs.every(([k, val]) => r[k] === val));
        return Promise.resolve({ data: single ? (found[0] ?? null) : found, error: null, count: found.length }).then(resolve);
      },
      configurable: true,
    });
    return chain;
  });
  return { client: { from } };
}

type Db = ReturnType<typeof makeDb>;

function ctxWith(db: Db, role: "owner" | "admin" | "member" = "owner") {
  return { user: USER, org: ORG, role, orgs: [ORG], service: db.client as never };
}

// The body a desktop sends: the plan main computed. Sealed boxes, ciphertext, names.
function planBody(over: Record<string, unknown> = {}) {
  return {
    org: "acme",
    removedDeviceId: "device-gone",
    keyVersion: 2,
    previousKeyVersion: 1,
    grants: [{ deviceId: "device-admin", wrappedKey: "sealed-admin" }],
    secrets: [{ name: "API_KEY", environment: "development", ciphertext: "ct", nonce: "n", rowVersion: 4 }],
    namesToRotate: ["API_KEY"],
    ...over,
  };
}

function req(body: unknown): Request {
  return new Request("https://weft.example/api/team/vaults/v1/rotate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer jwt.tok.en" },
    body: JSON.stringify(body),
  });
}

function ctx(vaultId = "v1") {
  return { params: Promise.resolve({ vaultId }) };
}

let db: Db;

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb();
  bearerUser.mockResolvedValue(USER);
  webUser.mockResolvedValue(USER);
  teamAccessFor.mockResolvedValue({ kind: "ok", ctx: ctxWith(db) });
  bearerSupabase.mockReturnValue(db.client);
  webClient.mockResolvedValue(db.client);
  applyRotate.mockResolvedValue({ ok: true, keyVersion: 2, namesToRotate: ["API_KEY"] });
});

describe("POST /api/team/vaults/<id>/rotate", () => {
  it("writes the plan and answers with the new key version", async () => {
    const res = await route.POST(req(planBody()), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, keyVersion: 2, namesToRotate: ["API_KEY"] });
    expect(applyRotate).toHaveBeenCalledTimes(1);
  });

  it("hands the writer the body's plan, with the vault id from the URL", async () => {
    await route.POST(req(planBody()), ctx());
    const [service, plan, actor] = applyRotate.mock.calls[0]!;
    expect(service).toBe(db.client);
    expect(plan).toEqual({
      vaultId: "v1",
      keyVersion: 2,
      previousKeyVersion: 1,
      revokedDeviceId: "device-gone",
      grants: [{ deviceId: "device-admin", wrappedKey: "sealed-admin" }],
      secrets: [{ name: "API_KEY", environment: "development", ciphertext: "ct", nonce: "n", rowVersion: 4 }],
      namesToRotate: ["API_KEY"],
    });
    expect(actor).toEqual({ userId: "u1", email: "jane@example.com" });
  });

  it("is 403 for a member: a rotate takes a teammate's access away", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "ok", ctx: ctxWith(db, "member") });
    const res = await route.POST(req(planBody()), ctx());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 404 for a non-member, so membership can't be probed", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    const res = await route.POST(req(planBody()), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 401 when signed out", async () => {
    bearerUser.mockResolvedValueOnce(null);
    webUser.mockResolvedValueOnce(null);
    const res = await route.POST(req(planBody()), ctx());
    expect(res.status).toBe(401);
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 404 for a vault from another workspace", async () => {
    const res = await route.POST(req(planBody()), ctx("v2"));
    expect(res.status).toBe(404);
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 404 for a vault that isn't there", async () => {
    const res = await route.POST(req(planBody()), ctx("v-nope"));
    expect(res.status).toBe(404);
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 400 for a malformed body, and nothing is written", async () => {
    const res = await route.POST(req({ org: "acme" }), ctx());
    expect(res.status).toBe(400);
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 400 for a body that isn't JSON at all", async () => {
    const res = await route.POST(
      new Request("https://weft.example/api/team/vaults/v1/rotate", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(applyRotate).not.toHaveBeenCalled();
  });

  it("is 400 with the reason when the writer refuses the plan", async () => {
    applyRotate.mockResolvedValueOnce({ ok: false, error: "That vault is already on key version 3." });
    const res = await route.POST(req(planBody()), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That vault is already on key version 3." });
  });

  it("never answers with a sealed box or a ciphertext", async () => {
    const res = await route.POST(req(planBody()), ctx());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("sealed-admin");
    expect(text).not.toContain("ct");
  });
});
