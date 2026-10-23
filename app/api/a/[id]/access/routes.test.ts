// app/api/a/[id]/access/route.ts: the Mac's data-app access() shape for a hosted app, so Growth's page gets past
// its first call on weft.zip and can say which author keys haven't been uploaded. Gate and store are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const { appShareAccess, serviceClient, isConfigured, createAppSecretStore } = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  isConfigured: vi.fn(),
  createAppSecretStore: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/app-secrets", () => ({ isConfigured }));
vi.mock("@/lib/app-secret-store", () => ({ createAppSecretStore }));

const GROWTH = { env: "production", reads: { signups: { supabase: "growth_signups_by_day" }, traffic: { ga4: {} } } };
const ctx = { params: Promise.resolve({ id: "s1" }) };
const req = () => new Request("http://localhost/api/a/s1/access");

function stored(...names: string[]) {
  createAppSecretStore.mockReturnValue({ hasValue: vi.fn((_id: string, name: string) => Promise.resolve(names.includes(name))) });
}

beforeEach(() => {
  vi.clearAllMocks();
  appShareAccess.mockResolvedValue({ kind: "ok", share: { name: "📈 Growth", manifest: GROWTH } });
  serviceClient.mockReturnValue({});
  isConfigured.mockReturnValue(true);
  stored("SUPABASE_SECRET_KEY");
});

describe("GET /api/a/[id]/access", () => {
  it("names what the reads need and which the author hasn't uploaded", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      project: "📈 Growth",
      env: "production",
      needs: ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON", "SUPABASE_SECRET_KEY"],
      missing: ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"],
      granted: true,
    });
  });

  it("counts every need missing when app secrets aren't set up, and defaults env to production", async () => {
    isConfigured.mockReturnValue(false);
    appShareAccess.mockResolvedValue({ kind: "ok", share: { name: "G", manifest: { reads: { a: { supabase: "f" } } } } });
    const { GET } = await import("./route");
    const body = (await (await GET(req(), ctx)).json()) as { env: string; missing: string[] };
    expect(body.env).toBe("production");
    expect(body.missing).toEqual(["SUPABASE_SECRET_KEY"]);
  });

  it("refuses a missing link, a closed gate and an unconfigured server", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValueOnce({ kind: "missing" });
    expect((await GET(req(), ctx)).status).toBe(404);
    appShareAccess.mockResolvedValueOnce({ kind: "denied" });
    expect((await GET(req(), ctx)).status).toBe(403);
    serviceClient.mockReturnValueOnce(null);
    expect((await GET(req(), ctx)).status).toBe(503);
  });
});
