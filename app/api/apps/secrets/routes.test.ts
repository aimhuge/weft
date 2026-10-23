// app/api/apps/secrets/route.ts: the Mac's app-secrets-push.cjs POSTs author secrets + public values here.
// Auth: Bearer JWT (lib/web-session.ts's bearerUser). Author check: the JWT's sub is the share's
// created_by. Names not in the manifest's author / public list are silently dropped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const {
  appShareAccess,
  serviceClient,
  bearerUser,
  isConfigured,
  createAppSecretStore,
} = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  bearerUser: vi.fn(),
  isConfigured: vi.fn(),
  createAppSecretStore: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient, bearerUser }));
vi.mock("@/lib/app-secrets", () => ({ isConfigured }));
vi.mock("@/lib/app-secret-store", () => ({ createAppSecretStore }));

const SHARE = {
  id: "abc123xyz",
  org_id: "org-1",
  app_id: "app-1",
  name: "Growth",
  kind: "folder",
  page: "index.html",
  mode: "public",
  password_hash: null,
  has_password: false,
  created_by: "user-1",
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  owner: "user",
  slug: "growth",
  files: null,
  manifest: {
    secrets: {
      STRIPE_KEY: { from: "author", hosts: ["api.stripe.com"], paths: ["/v1/charges"] },
      OPENAI_KEY: { from: "viewer", hosts: ["api.openai.com"] },
    },
    public: ["PUBLIC_TOKEN"],
  },
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api/apps/secrets", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length), ...headers },
    body: text,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEFT_MINIAPP_KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODk5OTg3NjU0MzIxMTExMTE=";
  appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE } });
  serviceClient.mockReturnValue({ from: () => ({}) });
  bearerUser.mockResolvedValue({ id: "user-1", email: null, name: null, avatar: null });
  isConfigured.mockReturnValue(true);
  createAppSecretStore.mockReturnValue({ setValue: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  delete process.env.WEFT_MINIAPP_KEY;
});

describe("POST /api/apps/secrets", () => {
  it("rejects a non-JSON body with 400", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/apps/secrets", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a body over 4 MB with 413", async () => {
    const { POST } = await import("./route");
    const big = "x".repeat(4_300_000);
    const text = JSON.stringify({ shareId: "abc123xyz", values: { STRIPE_KEY: big } });
    const req = new Request("http://localhost/api/apps/secrets", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(text.length) },
      body: text,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("rejects a malformed shareId with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ shareId: "!!!", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(400);
  });

  it("rejects when values isn't an object with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ shareId: "abc123xyz", values: "no" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when there's no Bearer token", async () => {
    const { POST } = await import("./route");
    bearerUser.mockResolvedValue(null);
    const res = await POST(post({ shareId: "abc123xyz", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the share is missing", async () => {
    const { POST } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "missing" });
    const res = await POST(post({ shareId: "abc123xyz", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the gate denies access", async () => {
    const { POST } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "denied" });
    const res = await POST(post({ shareId: "abc123xyz", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the Bearer user isn't the share's author", async () => {
    const { POST } = await import("./route");
    bearerUser.mockResolvedValue({ id: "user-2", email: null, name: null, avatar: null });
    const res = await POST(post({ shareId: "abc123xyz", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when the manifest declares no author secrets or public names", async () => {
    const { POST } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE, manifest: { secrets: { OPENAI_KEY: { from: "viewer" } } } } });
    const res = await POST(post({ shareId: "abc123xyz", values: { OPENAI_KEY: "sk-x" } }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when WEFT_MINIAPP_KEY is missing", async () => {
    const { POST } = await import("./route");
    isConfigured.mockReturnValue(false);
    const res = await POST(post({ shareId: "abc123xyz", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(503);
  });

  it("returns 503 when the service client is missing", async () => {
    const { POST } = await import("./route");
    serviceClient.mockReturnValue(null);
    const res = await POST(post({ shareId: "abc123xyz", values: { STRIPE_KEY: "sk_x" } }));
    expect(res.status).toBe(503);
  });

  it("upserts the values, drops names not in the manifest, and reports both lists", async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    createAppSecretStore.mockReturnValue({ setValue });
    const { POST } = await import("./route");
    const res = await POST(post({
      shareId: "abc123xyz",
      values: {
        STRIPE_KEY: "sk_live_x",
        PUBLIC_TOKEN: "pub_x",
        OPENAI_KEY: "should-be-dropped", // viewer secret, not author
        UNDECLARED: "also-dropped",
      },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pushed: ["STRIPE_KEY", "PUBLIC_TOKEN"], dropped: ["OPENAI_KEY", "UNDECLARED"] });
    // Each pushed value was sealed as an author secret (viewer_id null).
    expect(setValue).toHaveBeenCalledWith("abc123xyz", "STRIPE_KEY", null, "sk_live_x");
    expect(setValue).toHaveBeenCalledWith("abc123xyz", "PUBLIC_TOKEN", null, "pub_x");
    expect(setValue).not.toHaveBeenCalledWith("abc123xyz", "OPENAI_KEY", expect.anything(), expect.anything());
  });

  it("accepts the keys the manifest's named reads need, for an app with no secrets block", async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    createAppSecretStore.mockReturnValue({ setValue });
    appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE, manifest: { reads: { signups: { supabase: "growth_signups_by_day" } } } } });
    const { POST } = await import("./route");
    const res = await POST(post({ shareId: "abc123xyz", values: { SUPABASE_SECRET_KEY: "sb_secret_x", GA4_PROPERTY_ID: "1" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pushed: ["SUPABASE_SECRET_KEY"], dropped: ["GA4_PROPERTY_ID"] });
  });

  it("continues past a single upsert failure so the rest still go up", async () => {
    const setValue = vi.fn().mockImplementation((_id: string, name: string) => {
      if (name === "STRIPE_KEY") throw new Error("cipher failed");
      return Promise.resolve();
    });
    createAppSecretStore.mockReturnValue({ setValue });
    const { POST } = await import("./route");
    const res = await POST(post({
      shareId: "abc123xyz",
      values: { STRIPE_KEY: "sk_x", PUBLIC_TOKEN: "pub_x" },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pushed: ["PUBLIC_TOKEN"], dropped: [] });
  });
});