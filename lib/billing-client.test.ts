import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The desktop's bridge to the deployed Weft's billing endpoint: pulls the access token from the account client,
// calls /api/billing/status, and turns errors into a short human message. SUPABASE_KEY, getSession and fetch are
// mocked so the test can pin both the signed-out path and the deployed Weft's reply.

const { getSession, fetchMock, originalFetch } = vi.hoisted(() => ({
  getSession: vi.fn(),
  fetchMock: vi.fn(),
  originalFetch: globalThis.fetch,
}));
const keys = vi.hoisted(() => ({ supabase: "anon" }));
vi.mock("./account", () => ({
  accountClient: () => ({ auth: { getSession } }),
  get SUPABASE_KEY() {
    return keys.supabase;
  },
}));

async function load() {
  vi.resetModules();
  return import("./billing-client");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEFT_BILLING_URL", "");
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

const TOKEN = "acc-tok";
function signedIn(token: string | null = TOKEN) {
  getSession.mockResolvedValueOnce({ data: { session: token ? { access_token: token } : null } });
}

describe("fetchBillingStatus", () => {
  it("is null when SUPABASE_KEY isn't set", async () => {
    keys.supabase = "";
    const { fetchBillingStatus } = await load();
    expect(await fetchBillingStatus()).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    keys.supabase = "anon";
  });

  it("is null when no session is loaded", async () => {
    signedIn(null);
    const { fetchBillingStatus } = await load();
    expect(await fetchBillingStatus()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the deployed Weft's /api/billing/status with the access token", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const { fetchBillingStatus } = await load();
    const result = await fetchBillingStatus();
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://weft-topaz.vercel.app/api/billing/status");
    expect(init).toEqual({ headers: { authorization: "Bearer acc-tok" } });
  });

  it("uses WEFT_BILLING_URL when set, trimming a trailing slash", async () => {
    vi.stubEnv("WEFT_BILLING_URL", "https://staging.example/");
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { fetchBillingStatus } = await load();
    await fetchBillingStatus();
    expect(fetchMock.mock.calls[0]![0]).toBe("https://staging.example/api/billing/status");
  });

  it("is null on a 404 or 503: billing isn't on that deployment yet, so the section stays hidden", async () => {
    for (const status of [404, 503]) {
      signedIn();
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Billing isn't set up on this Weft." }), { status }));
      const { fetchBillingStatus } = await load();
      expect(await fetchBillingStatus()).toBeNull();
    }
  });

  it("returns the server's error message on a non-OK reply", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Your Weft sign-in has expired. Sign in again." }), { status: 401, headers: { "content-type": "application/json" } }));
    const { fetchBillingStatus } = await load();
    const result = await fetchBillingStatus();
    expect(result).toEqual({ error: "Your Weft sign-in has expired. Sign in again." });
  });

  it("falls back to a status-code message when the body has no error", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 502 }));
    const { fetchBillingStatus } = await load();
    const result = await fetchBillingStatus();
    expect(result).toEqual({ error: "Weft's billing answered 502." });
  });

  it("returns a network error message when fetch throws", async () => {
    signedIn();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { fetchBillingStatus } = await load();
    const result = await fetchBillingStatus();
    expect(result).toEqual({ error: "Couldn't reach Weft's billing: offline" });
  });
});

describe("startCheckout", () => {
  it("asks the user to sign in when SUPABASE_KEY isn't set", async () => {
    keys.supabase = "";
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: false, error: "Sign in to your Weft account first." });
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    keys.supabase = "anon";
  });

  it("asks the user to sign in when no session is loaded", async () => {
    signedIn(null);
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: false, error: "Sign in to your Weft account first." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the plan and interval with the access token", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: "https://stripe.test/c/cs_x" }), { status: 200, headers: { "content-type": "application/json" } }));
    const { startCheckout } = await load();
    const result = await startCheckout("team", "yearly");
    expect(result).toEqual({ ok: true, url: "https://stripe.test/c/cs_x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://weft-topaz.vercel.app/api/billing/checkout");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer acc-tok", "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ plan: "team", interval: "yearly" }));
  });

  it("passes an applied change through", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, applied: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: true, applied: true });
  });

  it("passes the server's error message through", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Ask an owner to change the plan." }), { status: 400, headers: { "content-type": "application/json" } }));
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: false, error: "Ask an owner to change the plan." });
  });

  it("returns a network error message when fetch throws", async () => {
    signedIn();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: false, error: "Couldn't reach Weft's billing: offline" });
  });

  it("says this Weft can't take payments yet on a 404 with no JSON", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 404 }));
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: false, error: "weft.zip can't take payments from this Weft yet." });
  });

  it("falls back to a status-code message on any other reply with no JSON", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 502 }));
    const { startCheckout } = await load();
    expect(await startCheckout("pro", "monthly")).toEqual({ ok: false, error: "Weft's billing answered 502." });
  });
});
