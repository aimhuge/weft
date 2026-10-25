import { beforeEach, describe, expect, it, vi } from "vitest";

// Starting the Slack OAuth install (app/api/slack/oauth/install/route.ts). The link it redirects to is what
// shows Slack's channel picker — the picker is the only thing that creates the webhook.

vi.mock("@/lib/slack-oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack-oauth")>("@/lib/slack-oauth");
  return { ...actual, configFromEnv: vi.fn() };
});

const { GET } = await import("./route");
const { configFromEnv } = await import("@/lib/slack-oauth");

beforeEach(() => {
  vi.mocked(configFromEnv).mockReset();
  vi.mocked(configFromEnv).mockReturnValue({ clientId: "123.456", clientSecret: "shh", redirectUri: "https://weft.zip/api/slack/oauth/callback" });
});

describe("the Slack OAuth install", () => {
  it("redirects to Slack's authorize page with the incoming-webhook scope", () => {
    const res = GET();
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("123.456");
    expect(url.searchParams.get("scope")).toBe("incoming-webhook");
    expect(url.searchParams.get("redirect_uri")).toBe("https://weft.zip/api/slack/oauth/callback");
  });

  it("keeps the secret out of the url", () => {
    const res = GET();
    expect(res.headers.get("location")).not.toContain("shh");
  });

  it("answers 503 when the app's credentials are missing", async () => {
    vi.mocked(configFromEnv).mockReturnValue(null);
    const res = GET();
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("SLACK_CLIENT_ID");
  });
});
