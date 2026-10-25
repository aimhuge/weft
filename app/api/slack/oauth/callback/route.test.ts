import { beforeEach, describe, expect, it, vi } from "vitest";

// Slack's OAuth install landing on the callback (app/api/slack/oauth/callback/route.ts). The install's answer
// carries the feedback channel's webhook URL — a credential — so the route must put it in the database and
// must never print it, not even in the page it shows.

vi.mock("@/lib/slack-oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack-oauth")>("@/lib/slack-oauth");
  return { ...actual, exchangeCode: vi.fn(), configFromEnv: vi.fn() };
});
vi.mock("@/lib/slack-webhook-store", () => ({ saveWebhook: vi.fn(() => Promise.resolve(true)) }));

const { GET } = await import("./route");
const { exchangeCode, configFromEnv } = await import("@/lib/slack-oauth");
const { saveWebhook } = await import("@/lib/slack-webhook-store");

const SECRET = "https://hooks.slack.com/services/T1/B2/xyz";
const req = (query: string) => new Request(`https://weft.zip/api/slack/oauth/callback${query}`);

beforeEach(() => {
  vi.mocked(exchangeCode).mockReset();
  vi.mocked(configFromEnv).mockReset();
  vi.mocked(saveWebhook).mockReset();
  vi.mocked(saveWebhook).mockResolvedValue(true);
  vi.mocked(configFromEnv).mockReturnValue({ clientId: "123.456", clientSecret: "shh", redirectUri: "https://weft.zip/api/slack/oauth/callback" });
  vi.mocked(exchangeCode).mockResolvedValue({ url: SECRET, channel: "#feedback" });
});

describe("the Slack OAuth callback", () => {
  it("stores the webhook the install handed over", async () => {
    const res = await GET(req("?code=the-code"));
    expect(res.status).toBe(200);
    expect(saveWebhook).toHaveBeenCalledWith("feedback", SECRET, "#feedback");
    expect(exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ clientId: "123.456" }), "the-code");
  });

  it("never puts the webhook in the page it shows", async () => {
    const res = await GET(req("?code=the-code"));
    const html = await res.text();
    expect(html).not.toContain(SECRET);
    expect(html).toContain("Feedback is wired up");
  });

  it("says so when the install was declined, and changes nothing", async () => {
    const res = await GET(req("?error=access_denied"));
    expect(await res.text()).toContain("Slack declined");
    expect(saveWebhook).not.toHaveBeenCalled();
  });

  it("says so when there is no code", async () => {
    const res = await GET(req(""));
    expect(await res.text()).toContain("Nothing to do");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("says so when the app's credentials are missing", async () => {
    vi.mocked(configFromEnv).mockReturnValue(null);
    const res = await GET(req("?code=the-code"));
    expect(await res.text()).toContain("Not set up yet");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("says so when Slack refuses the code", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(null);
    const res = await GET(req("?code=stale"));
    expect(await res.text()).toContain("That didn't work");
    expect(saveWebhook).not.toHaveBeenCalled();
  });

  it("says so when the webhook could not be stored", async () => {
    vi.mocked(saveWebhook).mockResolvedValue(false);
    const res = await GET(req("?code=the-code"));
    expect(await res.text()).toContain("Saved nowhere");
  });
});
