// app/api/worker-blob/route.ts: the only way a worker's key reaches the bucket. These pin the gate: the key is
// checked by hash, the org comes from the worker's row and never from the request, and a Mac's row can't be used.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web-session", () => ({ serviceClient }));

const { POST } = await import("./route");

const KEY = `wwk_${"b".repeat(64)}`;
const SHA = "a".repeat(64);
const ORG = "11111111-2222-3333-4444-555555555555";

function setup(worker: { org_id: string } | null, signed: { data: unknown; error: { message: string } | null } = { data: { path: `${ORG}/${SHA}`, token: "t" }, error: null }) {
  const eq = vi.fn().mockReturnThis();
  const query = { select: vi.fn().mockReturnThis(), eq, maybeSingle: vi.fn(() => Promise.resolve({ data: worker })) };
  const createSignedUploadUrl = vi.fn(() => Promise.resolve(signed));
  const from = vi.fn(() => query);
  const bucket = vi.fn(() => ({ createSignedUploadUrl }));
  serviceClient.mockReturnValue({ from, storage: { from: bucket } });
  return { eq, createSignedUploadUrl, bucket };
}

const post = (body: unknown = { sha: SHA }, auth: string | null = `Bearer ${KEY}`) =>
  POST(new Request("https://weft.zip/api/worker-blob", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/worker-blob", () => {
  it("signs an upload under the worker's own org", async () => {
    const { eq, createSignedUploadUrl, bucket } = setup({ org_id: ORG });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: `${ORG}/${SHA}`, token: "t" });
    expect(eq).toHaveBeenCalledWith("key_hash", createHash("sha256").update(KEY).digest("hex"));
    expect(eq).toHaveBeenCalledWith("kind", "headless");
    expect(bucket).toHaveBeenCalledWith("weft-blobs");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(`${ORG}/${SHA}`);
  });

  it("ignores an org in the request", async () => {
    const { createSignedUploadUrl } = setup({ org_id: ORG });
    await post({ sha: SHA, org: "99999999-0000-0000-0000-000000000000", path: "other/x" });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(`${ORG}/${SHA}`);
  });

  it.each([[null], ["Bearer nope"], [`Basic ${KEY}`], [`Bearer ${KEY}x`]])("refuses %s as a key", async (auth) => {
    setup({ org_id: ORG });
    expect((await post({ sha: SHA }, auth)).status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it("refuses a key no worker holds", async () => {
    const { createSignedUploadUrl } = setup(null);
    expect((await post()).status).toBe(401);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ sha: "../../etc" }], [{ sha: 1 }], [{ sha: SHA.toUpperCase() }]])("refuses %j as a sha", async (body) => {
    setup({ org_id: ORG });
    expect((await post(body)).status).toBe(400);
  });

  it("refuses a body that isn't JSON", async () => {
    setup({ org_id: ORG });
    const res = await POST(new Request("https://weft.zip/api/worker-blob", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: "nope" }));
    expect(res.status).toBe(400);
  });

  it("says when the server has no service key", async () => {
    serviceClient.mockReturnValue(null);
    expect((await post()).status).toBe(503);
  });

  it("reads a blob that's already there as done, and any other storage error as a failure", async () => {
    setup({ org_id: ORG }, { data: null, error: { message: "The resource already exists" } });
    expect(await (await post()).json()).toEqual({ exists: true });
    setup({ org_id: ORG }, { data: null, error: { message: "boom" } });
    expect((await post()).status).toBe(502);
  });
});
