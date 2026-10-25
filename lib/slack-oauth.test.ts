import { describe, expect, it, vi } from "vitest";

import { authorizeUrl, configFromEnv, exchangeCode, webhookFromAnswer } from "./slack-oauth";

// The OAuth install that produces the feedback channel's webhook URL (lib/slack-oauth.ts). Slack has no Web API
// method for incoming webhooks, so this install is the only programmatic route to the address — and the address
// is a credential, so it must reach the database without passing through a log or a page.

const config = { clientId: "123.456", clientSecret: "shh", redirectUri: "https://weft.zip/api/slack/oauth/callback" };
const answer = { ok: true, incoming_webhook: { url: "https://hooks.slack.com/services/T1/B2/xyz", channel: "#feedback" } };

describe("authorizeUrl", () => {
  it("asks for the incoming-webhook scope and the redirect Slack should come back to", () => {
    const url = new URL(authorizeUrl(config));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("123.456");
    expect(url.searchParams.get("scope")).toBe("incoming-webhook");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("carries a state when there is one", () => {
    expect(new URL(authorizeUrl(config, "abc")).searchParams.get("state")).toBe("abc");
    expect(new URL(authorizeUrl(config)).searchParams.get("state")).toBeNull();
  });
});

describe("webhookFromAnswer", () => {
  it("takes the URL and the channel out of the install's answer", () => {
    expect(webhookFromAnswer(answer)).toEqual({ url: "https://hooks.slack.com/services/T1/B2/xyz", channel: "#feedback" });
  });

  it("accepts an answer with no channel name", () => {
    expect(webhookFromAnswer({ ok: true, incoming_webhook: { url: "https://hooks.slack.com/services/T1/B2/xyz" } })).toEqual({
      url: "https://hooks.slack.com/services/T1/B2/xyz",
      channel: null,
    });
  });

  it("refuses an answer with no webhook, or one that isn't a Slack webhook address", () => {
    expect(webhookFromAnswer({ ok: true })).toBeNull();
    expect(webhookFromAnswer({ ok: false, error: "bad_code" })).toBeNull();
    expect(webhookFromAnswer({ ok: true, incoming_webhook: { url: "https://example.com/hook" } })).toBeNull();
    expect(webhookFromAnswer({ ok: true, incoming_webhook: {} })).toBeNull();
    expect(webhookFromAnswer(null)).toBeNull();
    expect(webhookFromAnswer("nope")).toBeNull();
  });
});

describe("exchangeCode", () => {
  // A fetcher that records what it was called with.
  const spy = (answer: unknown) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    });
    // The first call, which is the only one exchangeCode makes.
    const first = () => calls[0] as { url: string; init: RequestInit };
    return { first, fetcher: fetcher as unknown as typeof fetch };
  };

  it("posts the code with the app's credentials and reads the webhook out of the answer", async () => {
    const { first, fetcher } = spy(answer);
    expect(await exchangeCode(config, "the-code", fetcher)).toEqual({
      url: "https://hooks.slack.com/services/T1/B2/xyz",
      channel: "#feedback",
    });
    const call = first();
    expect(call.url).toBe("https://slack.com/api/oauth.v2.access");
    const fields = new URLSearchParams(call.init.body as string);
    expect(fields.get("code")).toBe("the-code");
    expect(fields.get("client_id")).toBe("123.456");
    expect(fields.get("client_secret")).toBe("shh");
    expect(fields.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("keeps the secret out of the query string", async () => {
    const { first, fetcher } = spy(answer);
    await exchangeCode(config, "the-code", fetcher);
    expect(first().url).not.toContain("shh");
  });

  it("answers null when Slack says no, or when the call fails", async () => {
    const refused = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: false, error: "bad_code" }), { status: 200 })));
    expect(await exchangeCode(config, "stale", refused as never)).toBeNull();
    const offline = vi.fn(() => Promise.reject(new Error("offline")));
    expect(await exchangeCode(config, "the-code", offline as never)).toBeNull();
  });
});

describe("configFromEnv", () => {
  it("needs both credentials", () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ SLACK_CLIENT_ID: "123.456" })).toBeNull();
    expect(configFromEnv({ SLACK_CLIENT_SECRET: "shh" })).toBeNull();
  });

  it("defaults the redirect to the deployed callback", () => {
    expect(configFromEnv({ SLACK_CLIENT_ID: "123.456", SLACK_CLIENT_SECRET: "shh" })).toEqual({
      clientId: "123.456",
      clientSecret: "shh",
      redirectUri: "https://weft.zip/api/slack/oauth/callback",
    });
  });

  it("takes an explicit redirect", () => {
    expect(
      configFromEnv({ SLACK_CLIENT_ID: "123.456", SLACK_CLIENT_SECRET: "shh", SLACK_REDIRECT_URI: "https://x.test/cb" })?.redirectUri,
    ).toBe("https://x.test/cb");
  });
});
