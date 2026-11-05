import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/testflight on weft.zip: GET is public (link + whether invites work), POST invites the bearer's own email.

vi.mock("next/server", () => ({ connection: async () => {} }));

const bearerUser = vi.hoisted(() => vi.fn());
const tf = vi.hoisted(() => ({ inviteTester: vi.fn(), testflightConfig: vi.fn(), testflightPublicUrl: vi.fn() }));
const supabaseKey = vi.hoisted(() => ({ value: "sb_test" }));

vi.mock("@/lib/web-session", () => ({ bearerUser }));
vi.mock("@/lib/testflight", () => tf);
vi.mock("@/lib/supabase-project", () => ({
  get SUPABASE_KEY() {
    return supabaseKey.value;
  },
}));

const route = await import("./route");

const CFG = { issuerId: "i", keyId: "k", privateKey: "p", groupId: "g" };
const URL_ = "https://testflight.apple.com/join/abc";

const post = (auth: string | null = "Bearer jwt") =>
  route.POST(new Request("https://weft.example/api/testflight", { method: "POST", headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  supabaseKey.value = "sb_test";
  tf.testflightConfig.mockReturnValue(CFG);
  tf.testflightPublicUrl.mockReturnValue(URL_);
});

describe("GET /api/testflight", () => {
  it("answers the link and that invites are on", async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: URL_, invites: true });
  });

  it("says invites are off without the App Store Connect config", async () => {
    tf.testflightConfig.mockReturnValue(null);
    expect(await (await route.GET()).json()).toEqual({ url: URL_, invites: false });
  });

  it("says invites are off without Supabase", async () => {
    supabaseKey.value = "";
    expect(await (await route.GET()).json()).toEqual({ url: URL_, invites: false });
  });

  it("answers a null url when none is configured", async () => {
    tf.testflightPublicUrl.mockReturnValue(null);
    expect(await (await route.GET()).json()).toEqual({ url: null, invites: true });
  });
});

describe("POST /api/testflight", () => {
  it("is 503 without the config", async () => {
    tf.testflightConfig.mockReturnValue(null);
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "TestFlight invites aren't set up on this Weft." });
    expect(bearerUser).not.toHaveBeenCalled();
  });

  it("is 503 without Supabase", async () => {
    supabaseKey.value = "";
    expect((await post()).status).toBe(503);
  });

  it("is 401 when the bearer token doesn't resolve to a user", async () => {
    bearerUser.mockResolvedValue(null);
    const res = await post(null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in to your Weft account first." });
    expect(tf.inviteTester).not.toHaveBeenCalled();
  });

  it("is 400 when the account has no email", async () => {
    bearerUser.mockResolvedValue({ id: "u1", email: null, name: "Jane" });
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Your Weft account has no email address to invite." });
    expect(tf.inviteTester).not.toHaveBeenCalled();
  });

  it("invites the session's own email and name, and is 200 on success", async () => {
    bearerUser.mockResolvedValue({ id: "u1", email: "jane@example.com", name: "Jane Doe" });
    tf.inviteTester.mockResolvedValue({ ok: true, email: "jane@example.com", already: false });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "jane@example.com", already: false });
    expect(tf.inviteTester).toHaveBeenCalledWith(CFG, { email: "jane@example.com", name: "Jane Doe" });
    expect((bearerUser.mock.calls[0] as [Request])[0].headers.get("authorization")).toBe("Bearer jwt");
  });

  it("is 502 with Apple's error when the invite fails", async () => {
    bearerUser.mockResolvedValue({ id: "u1", email: "jane@example.com", name: null });
    tf.inviteTester.mockResolvedValue({ ok: false, error: "Apple said no." });
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Apple said no." });
  });
});
