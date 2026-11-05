// A worker's build on its way to its owner's Mac (app/api/worker-build/route.ts): the bearer is the gate. POST
// answers a worker's key with a presigned PUT; GET answers the owner's session with a presigned GET, only for the
// call that is theirs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceClient = vi.hoisted(() => vi.fn());
const presignPut = vi.hoisted(() => vi.fn());
const presignGet = vi.hoisted(() => vi.fn());
const r2Config = vi.hoisted(() => vi.fn());

vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/r2", () => ({ presignPut, presignGet, r2Config }));

const route = await import("./route");

const SHA = "a".repeat(64);
const KEY = `wwk_${"b".repeat(64)}`;
const CALL = "11111111-1111-1111-1111-111111111111";
const R2 = { accountId: "acct", accessKeyId: "ak", secretAccessKey: "sk", bucket: "weft-blobs" };

// The service client the route talks to: a worker lookup, a call lookup, and a session.
interface ServiceRows {
  worker?: { id: string; org_id: string } | null;
  call?: Record<string, unknown> | null;
  user?: { id: string };
}

function fakeService({ worker = { id: "w-1", org_id: "org-1" }, call = null, user = { id: "u-1" } }: ServiceRows = {}) {
  const workerSelect = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: worker })) })) })) }));
  const callSelect = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: call })) })) }));
  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user }, error: null })) },
    from: vi.fn((table: string) => (table === "cloud_workers" ? { select: workerSelect } : { select: callSelect })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient.mockReturnValue(fakeService());
  r2Config.mockReturnValue(R2);
  presignPut.mockReturnValue("https://r2.test/put");
  presignGet.mockReturnValue("https://r2.test/get");
});

const post = (body: unknown, auth: string | null = `Bearer ${KEY}`) =>
  route.POST(
    new Request("https://weft.test/api/worker-build", {
      method: "POST",
      headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const get = (call: string, auth: string | null = "Bearer session-token") =>
  route.GET(new Request(`https://weft.test/api/worker-build?call=${call}`, { headers: auth ? { authorization: auth } : {} }));

describe("POST /api/worker-build", () => {
  it("refuses a request with no key", async () => {
    const res = await post({ sha: SHA, bytes: 5 }, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Send this worker's key." });
  });

  it("refuses a key that isn't a worker's shape", async () => {
    expect((await post({ sha: SHA, bytes: 5 }, "Bearer nope")).status).toBe(401);
  });

  it("refuses a build that doesn't name its sha256", async () => {
    const res = await post({ sha: "not-a-sha", bytes: 5 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name the build by its sha256." });
  });

  it("refuses a build over the cap", async () => {
    const res = await post({ sha: SHA, bytes: 500 * 1024 * 1024 + 1 });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "That build is over the 500 MB limit." });
  });

  it("refuses a build with no size", async () => {
    expect((await post({ sha: SHA })).status).toBe(413);
    expect((await post({ sha: SHA, bytes: 0 })).status).toBe(413);
  });

  it("says so when the server can't take builds", async () => {
    serviceClient.mockReturnValue(null);
    expect((await post({ sha: SHA, bytes: 5 })).status).toBe(503);
    serviceClient.mockReturnValue(fakeService());
    r2Config.mockReturnValue(null);
    expect((await post({ sha: SHA, bytes: 5 })).status).toBe(503);
  });

  it("refuses a key that isn't a worker's", async () => {
    serviceClient.mockReturnValue(fakeService({ worker: null }));
    const res = await post({ sha: SHA, bytes: 5 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "That key isn't a worker's." });
  });

  it("answers a worker's key with a presigned put for its own key", async () => {
    const res = await post({ sha: SHA, bytes: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://r2.test/put" });
    expect(presignPut).toHaveBeenCalledWith(R2, `qa-builds/org-1/w-1/${SHA}`);
  });
});

describe("GET /api/worker-build", () => {
  it("refuses a request with no bearer", async () => {
    const res = await get(CALL, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to Weft." });
  });

  it("refuses a call id that isn't one", async () => {
    const res = await get("not-a-call");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name the call." });
  });

  it("says so when the server can't serve builds", async () => {
    serviceClient.mockReturnValue(null);
    expect((await get(CALL)).status).toBe(503);
  });

  it("refuses a call that isn't the caller's", async () => {
    serviceClient.mockReturnValue(fakeService({ call: { org_id: "org-1", worker_id: "w-1", owner_user: "u-other", tool: "install", args: { build: { sha: SHA, kind: "app", bytes: 5 } } } }));
    const res = await get(CALL);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "That build isn't yours to read." });
  });

  it("refuses a call that isn't an install", async () => {
    serviceClient.mockReturnValue(fakeService({ call: { org_id: "org-1", worker_id: "w-1", owner_user: "u-1", tool: "tap", args: {} } }));
    expect((await get(CALL)).status).toBe(404);
  });

  it("refuses a call whose build doesn't parse", async () => {
    serviceClient.mockReturnValue(fakeService({ call: { org_id: "org-1", worker_id: "w-1", owner_user: "u-1", tool: "install", args: { build: { sha: "bad", kind: "app", bytes: 5 } } } }));
    expect((await get(CALL)).status).toBe(404);
  });

  it("answers the owner with a presigned get for the build it names", async () => {
    serviceClient.mockReturnValue(fakeService({ call: { org_id: "org-1", worker_id: "w-1", owner_user: "u-1", tool: "install", args: { build: { sha: SHA, kind: "app", bytes: 5 } } } }));
    const res = await get(CALL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://r2.test/get" });
    expect(presignGet).toHaveBeenCalledWith(R2, `qa-builds/org-1/w-1/${SHA}`);
  });
});
