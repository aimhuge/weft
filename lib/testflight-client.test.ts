import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The desktop's bridge to weft.zip's /api/testflight: the public link (null on any trouble) and the emailed invite.
// SUPABASE_KEY and getSession are mocked at ./account, fetch is injected.

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
const keys = vi.hoisted(() => ({ supabase: "anon" }));
vi.mock("./account", () => ({
  accountClient: () => ({ auth: { getSession } }),
  get SUPABASE_KEY() {
    return keys.supabase;
  },
}));

async function load() {
  vi.resetModules();
  return import("./testflight-client");
}

beforeEach(() => {
  vi.clearAllMocks();
  keys.supabase = "anon";
  vi.stubEnv("WEFT_BILLING_URL", "https://weft.example/");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signedIn = (token: string | null = "acc-tok") => getSession.mockResolvedValue({ data: { session: token ? { access_token: token } : null } });

describe("fetchTestflight", () => {
  it("returns the link and whether invites are on", async () => {
    const { fetchTestflight } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(json({ url: "https://testflight.apple.com/join/abc", invites: true }));
    expect(await fetchTestflight(fetchImpl)).toEqual({ url: "https://testflight.apple.com/join/abc", invites: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://weft.example/api/testflight");
  });

  it("reads anything but invites:true as no invites", async () => {
    const { fetchTestflight } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(json({ url: "https://testflight.apple.com/join/abc", invites: "yes" }));
    expect(await fetchTestflight(fetchImpl)).toEqual({ url: "https://testflight.apple.com/join/abc", invites: false });
  });

  it("is null when the answer has no url (null or missing)", async () => {
    const { fetchTestflight } = await load();
    expect(await fetchTestflight(vi.fn().mockResolvedValue(json({ url: null, invites: true })))).toBeNull();
    expect(await fetchTestflight(vi.fn().mockResolvedValue(json({})))).toBeNull();
  });

  it("is null on a non-ok answer, a network error or a bad body", async () => {
    const { fetchTestflight } = await load();
    expect(await fetchTestflight(vi.fn().mockResolvedValue(json({}, 503)))).toBeNull();
    expect(await fetchTestflight(vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
    expect(await fetchTestflight(vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })))).toBeNull();
  });

  it("uses global fetch by default", async () => {
    const { fetchTestflight } = await load();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ url: "https://testflight.apple.com/join/abc", invites: false }));
    try {
      expect(await fetchTestflight()).toEqual({ url: "https://testflight.apple.com/join/abc", invites: false });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("requestInvite", () => {
  const SIGN_IN = { ok: false, error: "Sign in to your Weft account first." };

  it("asks to sign in when SUPABASE_KEY isn't set", async () => {
    keys.supabase = "";
    const { requestInvite } = await load();
    const fetchImpl = vi.fn();
    expect(await requestInvite(fetchImpl)).toEqual(SIGN_IN);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks to sign in when there is no session", async () => {
    signedIn(null);
    const { requestInvite } = await load();
    const fetchImpl = vi.fn();
    expect(await requestInvite(fetchImpl)).toEqual(SIGN_IN);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs with the access token and returns weft.zip's answer", async () => {
    signedIn();
    const { requestInvite } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true, email: "a@b.co", already: false }));
    expect(await requestInvite(fetchImpl)).toEqual({ ok: true, email: "a@b.co", already: false });
    expect(fetchImpl).toHaveBeenCalledWith("https://weft.example/api/testflight", { method: "POST", headers: { authorization: "Bearer acc-tok" } });
  });

  it("reports a network failure", async () => {
    signedIn();
    const { requestInvite } = await load();
    expect(await requestInvite(vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))).toEqual({ ok: false, error: "Couldn't reach weft.zip: ECONNREFUSED" });
  });

  it("passes weft.zip's error message through", async () => {
    signedIn();
    const { requestInvite } = await load();
    expect(await requestInvite(vi.fn().mockResolvedValue(json({ ok: false, error: "Nope." }, 502)))).toEqual({ ok: false, error: "Nope." });
    // An error string wins even without ok:false.
    expect(await requestInvite(vi.fn().mockResolvedValue(json({ error: "Bare." }, 401)))).toEqual({ ok: false, error: "Bare." });
  });

  it("explains a 404 as not yet supported", async () => {
    signedIn();
    const { requestInvite } = await load();
    expect(await requestInvite(vi.fn().mockResolvedValue(new Response("not found", { status: 404 })))).toEqual({
      ok: false,
      error: "weft.zip can't send TestFlight invites yet.",
    });
  });

  it("names the status for any other unreadable answer", async () => {
    signedIn();
    const { requestInvite } = await load();
    expect(await requestInvite(vi.fn().mockResolvedValue(new Response("oops", { status: 500 })))).toEqual({ ok: false, error: "weft.zip answered 500." });
    expect(await requestInvite(vi.fn().mockResolvedValue(json({ error: 42 }, 400)))).toEqual({ ok: false, error: "weft.zip answered 400." });
  });

  it("uses global fetch by default", async () => {
    signedIn();
    const { requestInvite } = await load();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true, email: "a@b.co", already: true }));
    try {
      expect(await requestInvite()).toEqual({ ok: true, email: "a@b.co", already: true });
    } finally {
      spy.mockRestore();
    }
  });
});
