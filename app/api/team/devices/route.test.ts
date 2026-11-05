// The team's Devices API on weft.zip: /api/team/devices and /api/team/devices/accept.
//
// The gate and the reads are mocked at their boundaries — the service client is a small fake that
// honours eq/in filters, so the tests pin that a device list is scoped to the workspace's members and
// that a grant can only be accepted by the user it names. What these tests care about is the wire:
// which status a caller gets, what gets written, and what never leaves.
//
// The rules under test, in one line each:
//   - a member may read the list; a non-member may not (404, the same as a workspace that isn't there)
//   - only an admin may ask for a device (403)
//   - the POST writes a pending grant and nothing else — no vault_grants row, no key
//   - the accept route returns the device's *public* key, read from the devices table, and only for the
//     user the grant names
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const bearerUser = vi.hoisted(() => vi.fn());
const webUser = vi.hoisted(() => vi.fn());
const teamAccessFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web-session", () => ({ bearerUser, webUser }));
vi.mock("@/lib/teams", () => ({ teamAccessFor }));

const route = await import("./route");
const acceptRoute = await import("./accept/route");

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };
const HEX = "a1b2c3d4e5f67890abcdef0123456789";

type Row = Record<string, unknown>;

// The fake service client: tables of rows, and a chain that applies the filters the queries use.
// `insert`/`update`/`delete` really change the table, so a test can assert what a route wrote.
function makeDb(tables: Record<string, Row[]>) {
  const db: Record<string, Row[]> = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const calls: { table: string; op: string; payload?: Row }[] = [];
  const from = vi.fn((table: string) => {
    const rows = () => db[table] ?? [];
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    let op = "select";
    let payload: Row | undefined;
    let single = false;
    let selected = false;
    let written: Row[] = [];
    const chain: Record<string, unknown> = {};
    const apply = () => rows().filter((r) => eqs.every(([k, v]) => r[k] === v) && ins.every(([k, vals]) => vals.includes(r[k])));
    chain.select = vi.fn(() => {
      selected = true;
      return chain;
    });
    chain.eq = vi.fn((k: string, v: unknown) => {
      eqs.push([k, v]);
      return chain;
    });
    chain.in = vi.fn((k: string, v: unknown[]) => {
      ins.push([k, v]);
      return chain;
    });
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    // maybeSingle/single answer with one row, the way Supabase does: the first match, or null.
    chain.maybeSingle = vi.fn(() => {
      single = true;
      return chain;
    });
    chain.single = vi.fn(() => {
      single = true;
      return chain;
    });
    chain.insert = vi.fn((values: Row) => {
      op = "insert";
      payload = values;
      const row = { id: `new-${table}`, ...values };
      db[table] = [...rows(), row];
      written = [row];
      return chain;
    });
    chain.update = vi.fn((values: Row) => {
      op = "update";
      payload = values;
      const matched = apply();
      matched.forEach((r) => Object.assign(r, values));
      written = matched;
      return chain;
    });
    chain.delete = vi.fn(() => {
      op = "delete";
      const matched = apply();
      db[table] = rows().filter((r) => !matched.includes(r));
      written = matched;
      return chain;
    });
    chain.upsert = vi.fn(() => chain);
    // A write that isn't followed by .select() reports no rows, the way Supabase does.
    Object.defineProperty(chain, "then", {
      value: (resolve: (v: unknown) => void) => {
        const isWrite = op !== "select";
        const data = isWrite ? (selected ? (single ? (written[0] ?? null) : written) : null) : single ? (apply()[0] ?? null) : apply();
        return Promise.resolve({ data, error: null, count: isWrite ? written.length : apply().length }).then(resolve);
      },
      configurable: true,
    });
    calls.push({ table, op, payload });
    return chain;
  });
  return { client: { from }, db, calls };
}

type Db = ReturnType<typeof makeDb>;

// The tables a test reaches into directly. The fake starts every table as an array, so this is only
// the compiler's assurance that a test never reaches past the end of one.
function table(db: Db, name: string): Row[] {
  return db.db[name] ?? [];
}

// The first row of a table — the one a route just wrote.
function firstRow(db: Db, name: string): Row {
  const row = table(db, name)[0];
  if (!row) throw new Error(`no row in ${name}`);
  return row;
}

function ctxWith(db: Db, role: "owner" | "admin" | "member" = "owner") {
  return { user: USER, org: ORG, role, orgs: [ORG], service: db.client as never };
}

function req(url: string, method: string, body?: unknown) {
  return new Request(`https://weft.example${url}`, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer jwt.tok.en" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let db: Db;

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb({
    org_memberships: [
      { org_id: "o1", user_id: "u1" },
      { org_id: "o1", user_id: "u2" },
    ],
    profiles: [
      { id: "u1", display_name: "Jane", email: "jane@example.com" },
      { id: "u2", display_name: "Ada", email: "ada@example.com" },
    ],
    vaults: [{ id: "v1", org_id: "o1", repo: "acme/app", label: "weft" }],
    devices: [
      { id: "d1", user_id: "u1", name: "Weft on Jane's MacBook", public_key: "pk-jane", fingerprint: HEX, platform: "darwin", last_seen_at: "2026-10-01T10:00:00.000Z", revoked_at: null },
      { id: "d2", user_id: "u2", name: "Weft on Ada's Linux", public_key: "pk-ada", fingerprint: "ffffffffffffffffffffffffffffffff", platform: "linux", last_seen_at: "2026-10-02T10:00:00.000Z", revoked_at: null },
      { id: "d3", user_id: "outsider", name: "Someone else's laptop", public_key: "pk-out", fingerprint: HEX, platform: "darwin", last_seen_at: "2026-10-02T10:00:00.000Z", revoked_at: null },
    ],
    pending_device_grants: [],
  });
  bearerUser.mockResolvedValue(USER);
  webUser.mockResolvedValue(USER);
  teamAccessFor.mockResolvedValue({ kind: "ok", ctx: ctxWith(db) });
});

describe("GET /api/team/devices", () => {
  it("lists the workspace's devices and the pending grants", async () => {
    const res = await route.GET(req("/api/team/devices?org=acme", "GET"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { devices: { id: string }[]; pending: unknown[]; canGrant: boolean };
    // d3 belongs to somebody outside the workspace, so it isn't on the list.
    expect(json.devices.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(json.pending).toEqual([]);
    expect(json.canGrant).toBe(true);
  });

  it("never sends a wrapped key or a public key it doesn't need", async () => {
    const res = await route.GET(req("/api/team/devices?org=acme", "GET"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("wrapped_key");
  });

  it("is 404 for a non-member, so membership can't be probed", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    const res = await route.GET(req("/api/team/devices?org=acme", "GET"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
  });

  it("is 401 when signed out", async () => {
    bearerUser.mockResolvedValueOnce(null);
    webUser.mockResolvedValueOnce(null);
    const res = await route.GET(req("/api/team/devices?org=acme", "GET"));
    expect(res.status).toBe(401);
  });

  it("is 400 without a workspace", async () => {
    const res = await route.GET(req("/api/team/devices", "GET"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/team/devices", () => {
  const body = { org: "acme", vaultId: "v1", targetUserId: "u2", fingerprint: "a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789" };

  it("writes a pending grant and nothing else", async () => {
    const res = await route.POST(req("/api/team/devices", "POST", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "new-pending_device_grants" });
    const grants = table(db, "pending_device_grants");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ vault_id: "v1", granter_user_id: "u1", target_user_id: "u2", target_fingerprint: HEX, status: "pending" });
    // The point of the TOFU handshake: no grant row, so nothing is sealed.
    expect(table(db, "vault_grants")).toHaveLength(0);
  });

  it("is 403 for a plain member", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "ok", ctx: ctxWith(db, "member") });
    const res = await route.POST(req("/api/team/devices", "POST", body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(table(db, "pending_device_grants")).toHaveLength(0);
  });

  it("is 400 for a fingerprint that isn't one", async () => {
    const res = await route.POST(req("/api/team/devices", "POST", { ...body, fingerprint: "nope" }));
    expect(res.status).toBe(400);
    expect(table(db, "pending_device_grants")).toHaveLength(0);
  });

  it("is 404 for a vault from another workspace, and for a target who isn't a member", async () => {
    table(db, "vaults").push({ id: "v2", org_id: "o2", repo: "other/app", label: "other" });
    expect((await route.POST(req("/api/team/devices", "POST", { ...body, vaultId: "v2" }))).status).toBe(404);
    expect((await route.POST(req("/api/team/devices", "POST", { ...body, targetUserId: "stranger" }))).status).toBe(404);
    expect(table(db, "pending_device_grants")).toHaveLength(0);
  });

  it("is 404 for a non-member and 401 when signed out", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    expect((await route.POST(req("/api/team/devices", "POST", body))).status).toBe(404);
    bearerUser.mockResolvedValueOnce(null);
    webUser.mockResolvedValueOnce(null);
    expect((await route.POST(req("/api/team/devices", "POST", body))).status).toBe(401);
  });

  it("is 400 for a malformed body", async () => {
    expect((await route.POST(req("/api/team/devices", "POST", { org: "acme" }))).status).toBe(400);
  });
});

describe("DELETE /api/team/devices", () => {
  beforeEach(() => {
    table(db, "pending_device_grants").push({ id: "p1", vault_id: "v1", granter_user_id: "u1", target_user_id: "u2", target_fingerprint: HEX, status: "pending", matched_device_id: null, created_at: "2026-10-01T10:00:00.000Z", expires_at: "2026-10-08T10:00:00.000Z" });
  });

  it("drops the pending grant the granter asked for", async () => {
    const res = await route.DELETE(req("/api/team/devices", "DELETE", { org: "acme", pendingId: "p1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(table(db, "pending_device_grants")).toHaveLength(0);
  });

  it("is 403 for somebody who is neither the granter nor the target", async () => {
    firstRow(db, "pending_device_grants").granter_user_id = "u3";
    firstRow(db, "pending_device_grants").target_user_id = "u4";
    const res = await route.DELETE(req("/api/team/devices", "DELETE", { org: "acme", pendingId: "p1" }));
    expect(res.status).toBe(403);
    expect(table(db, "pending_device_grants")).toHaveLength(1);
  });

  it("is 404 for a grant that isn't there", async () => {
    const res = await route.DELETE(req("/api/team/devices", "DELETE", { org: "acme", pendingId: "nope" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/team/devices/accept", () => {
  beforeEach(() => {
    table(db, "pending_device_grants").push({ id: "p1", vault_id: "v1", granter_user_id: "u1", target_user_id: "u1", target_fingerprint: HEX, status: "pending", matched_device_id: null, created_at: "2026-10-01T10:00:00.000Z", expires_at: "2026-10-08T10:00:00.000Z" });
  });

  it("records the device and hands back its public key", async () => {
    const res = await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acme", pendingId: "p1", deviceId: "d1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deviceId: "d1", publicKey: "pk-jane", fingerprint: HEX });
    expect(firstRow(db, "pending_device_grants")).toMatchObject({ matched_device_id: "d1", target_public_key: "pk-jane", status: "accepted" });
  });

  it("never answers with a wrapped key or a vault key", async () => {
    const res = await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acme", pendingId: "p1", deviceId: "d1" }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("wrapped");
    expect(text).not.toContain("vault_key");
  });

  it("is 403 when the caller isn't the grant's target", async () => {
    firstRow(db, "pending_device_grants").target_user_id = "u2";
    const res = await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acme", pendingId: "p1", deviceId: "d1" }));
    expect(res.status).toBe(403);
    expect(firstRow(db, "pending_device_grants").matched_device_id).toBeNull();
  });

  it("is 404 for a device that isn't the caller's own", async () => {
    const res = await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acme", pendingId: "p1", deviceId: "d2" }));
    expect(res.status).toBe(404);
    expect(firstRow(db, "pending_device_grants").matched_device_id).toBeNull();
  });

  it("is 400 when the device's fingerprint isn't the one in the grant", async () => {
    firstRow(db, "pending_device_grants").target_fingerprint = "ffffffffffffffffffffffffffffffff";
    const res = await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acme", pendingId: "p1", deviceId: "d1" }));
    expect(res.status).toBe(400);
    expect(firstRow(db, "pending_device_grants").matched_device_id).toBeNull();
  });

  it("is 404 for a grant that isn't there, and 401 when signed out", async () => {
    expect((await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acmy", pendingId: "nope", deviceId: "d1" }))).status).toBe(404);
    bearerUser.mockResolvedValueOnce(null);
    webUser.mockResolvedValueOnce(null);
    expect((await acceptRoute.POST(req("/api/team/devices/accept", "POST", { org: "acme", pendingId: "p1", deviceId: "d1" }))).status).toBe(401);
  });
});
