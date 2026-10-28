// The recovery key's route: /api/team/vaults/<vaultId>/recovery.
//
// The gate and the writes are mocked at their boundaries, the way app/api/team/devices/route.test.ts
// does it: a small fake service client, a fake team gate, and a fake RPC. What these tests care
// about is the wire — which status a caller gets, what gets written, and what never leaves.
//
// The rules under test, in one line each:
//   - a member may read; a non-member may not (404, the same as a workspace that isn't there)
//   - a vault from another workspace is a 404 too
//   - GET needs the acknowledgement tick, the 24 words and the sealed material — a missing one is a 400
//   - GET writes the recovery rows and hands the words back, and nothing else
//   - nothing sensitive is ever in the response: no vault key, no private key, no passphrase
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const bearerUser = vi.hoisted(() => vi.fn());
const webUser = vi.hoisted(() => vi.fn());
const teamAccessFor = vi.hoisted(() => vi.fn());
const bearerSupabase = vi.hoisted(() => vi.fn());
const webClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web-session", () => ({ bearerUser, webUser, bearerSupabase, webClient }));
vi.mock("@/lib/teams", () => ({ teamAccessFor }));

const route = await import("./route");

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };
const WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);

type Row = Record<string, unknown>;

// The fake Supabase client: tables of rows, and a chain that applies the filters the route's queries
// use. `rpc` is the recovery write — private.share_vault_recovery — and it is what really happens
// server-side, so the fake records the arguments it was given.
function makeDb() {
  const db: Record<string, Row[]> = {
    org_memberships: [
      { org_id: "o1", user_id: "u1" },
      { org_id: "o1", user_id: "u2" },
    ],
    vaults: [{ id: "v1", org_id: "o1", repo: "acme/app", label: "weft" }],
    devices: [],
    vault_grants: [],
    vault_events: [],
  };
  const rpcCalls: { name: string; args: Row }[] = [];
  const from = vi.fn((table: string) => {
    const rows = () => db[table] ?? [];
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    let op = "select";
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
      const row = { id: `new-${table}`, ...values };
      db[table] = [...rows(), row];
      written = [row];
      return chain;
    });
    chain.update = vi.fn(() => chain);
    chain.delete = vi.fn(() => chain);
    chain.upsert = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (resolve: (v: unknown) => void) => {
        const isWrite = op !== "select";
        const data = isWrite ? (selected ? (single ? (written[0] ?? null) : written) : null) : single ? (apply()[0] ?? null) : apply();
        return Promise.resolve({ data, error: null, count: isWrite ? written.length : apply().length }).then(resolve);
      },
      configurable: true,
    });
    return chain;
  });
  // The recovery write. The real one is a transaction that makes the device row, the grant and the
  // event row; the fake records the arguments and hands back a device id.
  const rpc = vi.fn((name: string, args: Row) => {
    rpcCalls.push({ name, args });
    if (name !== "share_vault_recovery") return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` }, status: 404 });
    const deviceId = "device-recovery-1";
    db.devices!.push({ id: deviceId, user_id: null, name: "recovery", public_key: args.p_public_key, fingerprint: "recovery", platform: "darwin", revoked_at: null });
    db.vault_grants!.push({ id: "grant-1", vault_id: args.p_vault_id, device_id: deviceId, key_version: args.p_key_version, wrapped_key: args.p_wrapped_key, granted_by: "u1" });
    db.vault_events!.push({ id: "event-1", vault_id: args.p_vault_id, actor_user_id: "u1", action: "vault.recovery_shown", metadata: { reason: null } });
    return Promise.resolve({ data: deviceId, error: null, status: 200 });
  });
  return { client: { from, rpc }, db, rpcCalls };
}

type Db = ReturnType<typeof makeDb>;

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

// The GET's request. It carries a body — the recovery material and the words — which the WHATWG
// Request refuses for GET, so the test builds the shape the route actually uses (json, url,
// headers). Electron main sends it over Node's http.request, which does allow a GET with a body;
// a browser's fetch does not, which is why the page never calls this route itself.
function getReq(url: string, body: unknown): Request {
  const headers = new Headers({ "content-type": "application/json", authorization: "Bearer jwt.tok.en" });
  return {
    url: `https://weft.example${url}`,
    headers,
    method: "GET",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Request;
}

// The body a GET carries: the recovery material the caller made in main, and the words.
function showBody(over: Record<string, unknown> = {}) {
  return { org: "acme", publicKey: "pk-recovery", wrappedKey: "sealed-box", keyVersion: 1, words: WORDS, saved: true, ...over };
}

// The route's context: the vault id, as Next 16 hands it over.
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
});

describe("GET /api/team/vaults/<id>/recovery", () => {
  it("writes the recovery rows and hands the words back", async () => {
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody()), ctx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { words: string[]; deviceId: string };
    expect(json.words).toEqual(WORDS);
    expect(json.deviceId).toBe("device-recovery-1");

    // The three rows, in one transaction: the recovery device, the grant, the event.
    expect(db.db.devices).toHaveLength(1);
    expect(db.db.devices![0]).toMatchObject({ user_id: null, name: "recovery", fingerprint: "recovery", public_key: "pk-recovery" });
    expect(db.db.vault_grants).toHaveLength(1);
    expect(db.db.vault_grants![0]).toMatchObject({ vault_id: "v1", device_id: "device-recovery-1", wrapped_key: "sealed-box" });
    expect(db.db.vault_events).toHaveLength(1);
    expect(db.db.vault_events![0]).toMatchObject({ action: "vault.recovery_shown" });
  });

  it("calls the recovery RPC with the sealed material, never a vault key", async () => {
    await route.GET(getReq("/api/team/vaults/v1/recovery", showBody()), ctx());
    expect(db.rpcCalls).toHaveLength(1);
    const call = db.rpcCalls[0]!;
    expect(call.name).toBe("share_vault_recovery");
    expect(call.args.p_vault_id).toBe("v1");
    expect(call.args.p_public_key).toBe("pk-recovery");
    expect(call.args.p_wrapped_key).toBe("sealed-box");
    // The words are not part of the write: only the public key and the sealed box cross it.
    expect(JSON.stringify(call.args)).not.toContain("word1");
  });

  it("answers with the words and nothing else sensitive", async () => {
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody()), ctx());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("passphrase");
    expect(text).not.toContain("privateKey");
    expect(text).not.toContain("vaultKey");
    expect(text).not.toContain("sealed-box");
  });

  it("needs the saved tick: without it, nothing is written", async () => {
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody({ saved: false })), ctx());
    expect(res.status).toBe(400);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.db.devices).toHaveLength(0);
  });

  it("needs 24 words: a short set is a 400", async () => {
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody({ words: ["abandon", "ability"] })), ctx());
    expect(res.status).toBe(400);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("needs the sealed material: without it, nothing is written", async () => {
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody({ wrappedKey: "" })), ctx());
    expect(res.status).toBe(400);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("is 404 for a non-member, so membership can't be probed", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody()), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("is 404 for a vault from another workspace", async () => {
    db.db.vaults!.push({ id: "v2", org_id: "o2", repo: "other/app", label: "other" });
    const res = await route.GET(getReq("/api/team/vaults/v2/recovery", showBody()), ctx("v2"));
    expect(res.status).toBe(404);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("is 401 when signed out", async () => {
    bearerUser.mockResolvedValueOnce(null);
    webUser.mockResolvedValueOnce(null);
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", showBody()), ctx());
    expect(res.status).toBe(401);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("is 400 for a malformed body", async () => {
    const res = await route.GET(getReq("/api/team/vaults/v1/recovery", { org: "acme" }), ctx());
    expect(res.status).toBe(400);
  });
});

describe("POST /api/team/vaults/<id>/recovery", () => {
  it("records the acknowledgement, with no words and no key material", async () => {
    const res = await route.POST(req("/api/team/vaults/v1/recovery", "POST", { org: "acme", saved: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.db.vault_events).toHaveLength(1);
    const event = db.db.vault_events![0]!;
    expect(event).toMatchObject({ vault_id: "v1", actor_user_id: "u1", action: "vault.recovery_shown" });
    expect(JSON.stringify(event)).not.toContain("word");
  });

  it("is 404 for a non-member, and 401 when signed out", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    expect((await route.POST(req("/api/team/vaults/v1/recovery", "POST", { org: "acme", saved: true }), ctx())).status).toBe(404);
    bearerUser.mockResolvedValueOnce(null);
    webUser.mockResolvedValueOnce(null);
    expect((await route.POST(req("/api/team/vaults/v1/recovery", "POST", { org: "acme", saved: true }), ctx())).status).toBe(401);
    expect(db.db.vault_events).toHaveLength(0);
  });

  it("is 400 without the saved tick, and 404 for another workspace's vault", async () => {
    expect((await route.POST(req("/api/team/vaults/v1/recovery", "POST", { org: "acme" }), ctx())).status).toBe(400);
    db.db.vaults!.push({ id: "v2", org_id: "o2", repo: "other/app", label: "other" });
    expect((await route.POST(req("/api/team/vaults/v2/recovery", "POST", { org: "acme", saved: true }), ctx("v2"))).status).toBe(404);
    expect(db.db.vault_events).toHaveLength(0);
  });
});
