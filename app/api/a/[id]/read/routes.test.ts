// app/api/a/[id]/read/route.ts: gates a named read from row.manifest.reads (Supabase RPC or GA4 runReport), splits
// the secret needs (author only, since reads never take viewer values), rate-limits, runs the read against the
// upstream service, and logs the call. The test mocks all of Supabase + globalThis.fetch so no upstream is touched.
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const {
  appShareAccess,
  serviceClient,
  webUser,
  fetchLimitVerdict,
  insertFetchLog,
  isConfigured,
  createAppSecretStore,
} = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  webUser: vi.fn(),
  fetchLimitVerdict: vi.fn(),
  insertFetchLog: vi.fn(),
  isConfigured: vi.fn(),
  createAppSecretStore: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient, webUser }));
vi.mock("@/lib/app-fetch-limit", () => ({ fetchLimitVerdict, insertFetchLog, clientIpFromHeaders: (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "" }));
vi.mock("@/lib/app-secrets", () => ({ isConfigured }));
vi.mock("@/lib/app-secret-store", () => ({ createAppSecretStore }));

const SHARE = {
  id: "s1",
  org_id: "org-1",
  app_id: "app-1",
  name: "Growth",
  kind: "folder",
  page: "index.html",
  mode: "public",
  password_hash: null,
  has_password: false,
  created_by: "u1",
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  owner: "user",
  slug: "growth",
  files: null,
  manifest: {
    supabaseUrl: "https://abc.supabase.co",
    reads: {
      // The manifest's args values are the defaults — their JS type is what the page must send back.
      growth_overview: { supabase: "growth_overview", args: { days: 7 } },
      site_visits: { ga4: { dimensions: ["date"], metrics: [{ name: "sessions" }] } },
    },
  },
};

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/a/s1/read", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEFT_MINIAPP_KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODk5OTg3NjU0MzIxMTExMTE=";
  appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE } });
  serviceClient.mockReturnValue({ from: () => ({}) });
  webUser.mockResolvedValue({ id: "user-1", email: null, name: null, avatar: null });
  fetchLimitVerdict.mockResolvedValue({ ok: true, retryAfter: 0 });
  insertFetchLog.mockResolvedValue(undefined);
  isConfigured.mockReturnValue(true);
  createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({}) });
});

afterEach(() => {
  delete process.env.WEFT_MINIAPP_KEY;
  vi.unstubAllGlobals();
});

describe("POST /api/a/[id]/read", () => {
  it("rejects a non-JSON body with 400", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/a/s1/read", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
    const res = await POST(req, ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid read name with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ name: "BAD NAME!", args: {} }), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("returns 413 when the body is over 64 KB", async () => {
    const { POST } = await import("./route");
    const big = JSON.stringify({ name: "growth_overview", args: { days: 7 } }).padEnd(70_000, "x");
    const req = new Request("http://localhost/api/a/s1/read", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(big.length) },
      body: big,
    });
    const res = await POST(req, ctx("s1"));
    expect(res.status).toBe(413);
  });

  it("returns 404 when the share is missing", async () => {
    const { POST } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "missing" });
    const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the gate is not ok", async () => {
    const { POST } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "denied" });
    const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
    expect(res.status).toBe(403);
  });

  it("returns 503 when the service client is missing", async () => {
    const { POST } = await import("./route");
    serviceClient.mockReturnValue(null);
    const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("returns 404 when the manifest has no reads", async () => {
    const { POST } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE, manifest: { supabaseUrl: "https://abc.supabase.co" } } });
    const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the read name isn't in the manifest", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ name: "unknown", args: {} }), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 429 with Retry-After when the rate limit refuses", async () => {
    const { POST } = await import("./route");
    fetchLimitVerdict.mockResolvedValue({ ok: false, bucket: { kind: "viewer", key: "user-1", count: 60 }, retryAfter: 60 });
    const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "READ", host: "supabase.co", status: 429 }));
  });

  it("returns 503 when App secrets aren't set up and the read needs them", async () => {
    const { POST } = await import("./route");
    isConfigured.mockReturnValue(false);
    const res = await POST(post({ name: "growth_overview", args: { days: 7 } }), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("runs the Supabase read, returns rows, and logs the call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ date: "2026-10-18", visits: 42 }]), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ SUPABASE_SECRET_KEY: "sb_secret_x" }) });

    const { POST } = await import("./route");
    const res = await POST(post({ name: "growth_overview", args: { days: 7 } }), ctx("s1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body).toEqual({ rows: [{ date: "2026-10-18", visits: 42 }] });
    // The Supabase URL was hit with the right apikey/authorization and the cleaned args.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [called] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(called).toContain("https://abc.supabase.co/rest/v1/rpc/growth_overview");
    expect(called).toContain("days=7");
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_secret_x");
    expect(headers.authorization).toBe("Bearer sb_secret_x");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "READ", host: "supabase.co", path: "/growth_overview", status: 200 }));
  });

  // The author's SUPABASE_SECRET_KEY goes on the wire as a bearer, so the manifest's supabaseUrl
  // must be a Supabase project host and nothing else (pentest 2026-10-20, F-11). A share whose
  // manifest points elsewhere is refused before the secret is read or any request is made.
  it("refuses a manifest supabaseUrl that isn't a Supabase host, without sending the secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ SUPABASE_SECRET_KEY: "sb_secret_x" }) });

    const { POST } = await import("./route");
    for (const bad of ["https://attacker.example", "http://abc.supabase.co", "https://abc.supabase.co.evil.example", "https://localhost:54321"]) {
      appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE, manifest: { supabaseUrl: bad, reads: { growth_overview: { supabase: "growth_overview", args: { days: 7 } } } } } });
      fetchMock.mockClear();
      const res = await POST(post({ name: "growth_overview", args: { days: 7 } }), ctx("s1"));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("supabaseUrl");
      // The refusal happens before any network call, so the secret is never put on the wire.
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("sends the manifest's arg when the page leaves it out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ SUPABASE_SECRET_KEY: "sb_secret_x" }) });

    const { POST } = await import("./route");
    const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
    expect(res.status).toBe(200);
    const [called] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(called).toContain("days=7");
  });

  it("rejects an arg with the wrong type with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ name: "growth_overview", args: { days: "seven" } }), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("translates a Supabase upstream error to the same status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "function not found", hint: "check schema" }), { status: 404, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ SUPABASE_SECRET_KEY: "sb_secret_x" }) });

    const { POST } = await import("./route");
    const res = await POST(post({ name: "growth_overview", args: { days: 7 } }), ctx("s1"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("function not found");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 404 }));
  });

  it("runs the GA4 read, flattens the rows, and signs a JWT for the OAuth exchange", async () => {
    // A real RSA key the test allows the route to sign with — OpenSSL refuses to parse a malformed PEM.
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "ya29.x", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://analyticsdata.googleapis.com/")) {
        return new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "sessions" }],
            rows: [{ dimensionValues: [{ value: "20261018" }], metricValues: [{ value: "100" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    createAppSecretStore.mockReturnValue({
      getValues: vi.fn().mockResolvedValue({
        GA4_PROPERTY_ID: "123456",
        GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: "svc@proj.iam.gserviceaccount.com",
          private_key: privateKey,
        }),
      }),
    });

    const { POST } = await import("./route");
    const res = await POST(post({ name: "site_visits", args: {} }), ctx("s1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body).toEqual({ rows: [{ date: "20261018", sessions: 100 }] });
    // Two upstream calls: the OAuth exchange and runReport.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "READ", host: "analyticsdata.googleapis.com", status: 200 }));
  });
  // How each failure maps to a status. Pinned before the read logic moved into electron/app-read-core.cjs,
  // which throws kind-tagged errors that lib/app-read.ts turns back into these statuses.
  describe("failure statuses", () => {
    const withSecret = () => createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ SUPABASE_SECRET_KEY: "sb_secret_x" }) });

    it("413 when Supabase answers more than 2 MB", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 })));
      withSecret();
      const { POST } = await import("./route");
      const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
      expect(res.status).toBe(413);
    });

    it("504 when the fetch is aborted on the timeout", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })));
      withSecret();
      const { POST } = await import("./route");
      const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
      expect(res.status).toBe(504);
      expect(((await res.json()) as { error: string }).error).toContain("15 s");
    });

    it("502 when Supabase can't be reached", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      withSecret();
      const { POST } = await import("./route");
      const res = await POST(post({ name: "growth_overview", args: {} }), ctx("s1"));
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toContain("ECONNREFUSED");
    });

    it("400 for a GA4 service account that isn't JSON or lacks its key", async () => {
      vi.stubGlobal("fetch", vi.fn());
      const { POST } = await import("./route");
      for (const sa of ["not-json", JSON.stringify({ client_email: "a@b" })]) {
        createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ GA4_PROPERTY_ID: "1", GA4_SERVICE_ACCOUNT_JSON: sa }) });
        const res = await POST(post({ name: "site_visits", args: {} }), ctx("s1"));
        expect(res.status).toBe(400);
      }
    });

    it("passes Google's token endpoint status through", async () => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad key" }), { status: 401 })));
      createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ GA4_PROPERTY_ID: "1", GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "fresh@proj.iam.gserviceaccount.com", private_key: privateKey }) }) });
      const { POST } = await import("./route");
      const res = await POST(post({ name: "site_visits", args: {} }), ctx("s1"));
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: string }).error).toContain("bad key");
    });
  });
});
