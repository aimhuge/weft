import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./web-session", () => ({ serviceClient: vi.fn(() => null) }));
vi.mock("./slack-webhook-store", () => ({ readWebhook: vi.fn(() => Promise.resolve(null)), FEEDBACK_PURPOSE: "feedback" }));

const { FEEDBACK_COLLECT_URL, LIMIT, WINDOW_MS, allow, cleanPayload, collectFeedback, forwardFeedback, resetLimits, slackText } = await import("./feedback-send");
const { serviceClient } = await import("./web-session");
const { readWebhook } = await import("./slack-webhook-store");

const summary = { title: "Cards <vanish>", body: "- **Often** & daily\n* after a restart" };
const body = { summary, messages: [{ role: "user", text: "they vanish" }], from: { name: "Ada", email: "ada@b.co" }, version: "1.2.3" };
const ok = () => vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
const table = (error: unknown = null) => {
  const insert = vi.fn(() => Promise.resolve({ error }));
  return { client: { from: vi.fn(() => ({ insert })) } as never, insert };
};

beforeEach(() => {
  resetLimits();
  vi.mocked(readWebhook).mockReset();
  vi.mocked(readWebhook).mockResolvedValue(null);
});

describe("forwardFeedback", () => {
  it("posts the payload to the deployed collector", async () => {
    const fetcher = ok();
    expect(await forwardFeedback(cleanPayload(body), fetcher as never)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(FEEDBACK_COLLECT_URL, expect.objectContaining({ method: "POST" }));
  });

  it("answers false on an error status or a network failure", async () => {
    expect(await forwardFeedback(cleanPayload(body), vi.fn(() => Promise.resolve(new Response(null, { status: 502 }))) as never)).toBe(false);
    expect(await forwardFeedback(cleanPayload(body), vi.fn(() => Promise.reject(new Error("offline"))) as never)).toBe(false);
  });
});

describe("cleanPayload", () => {
  it("keeps a checked summary and clips the rest", () => {
    expect(cleanPayload(body)).toEqual({ summary, messages: [{ role: "user", text: "they vanish" }], from: { name: "Ada", email: "ada@b.co" }, version: "1.2.3" });
  });

  it("drops a bad transcript, an empty sender and a missing version", () => {
    expect(cleanPayload({ summary, messages: "x", from: { name: " " } })).toEqual({ summary, messages: [], from: null, version: null });
    expect(cleanPayload({ summary, from: "Ada" }).from).toBeNull();
  });

  it("needs a summary", () => {
    expect(() => cleanPayload(null)).toThrow();
  });
});

describe("slackText", () => {
  it("escapes, bullets and bolds for Slack, signed with the sender", () => {
    const text = slackText(cleanPayload(body));
    expect(text).toContain("*💬 Cards &lt;vanish&gt;*");
    expect(text).toContain("• *Often* &amp; daily\n• after a restart");
    expect(text).toContain("_From Ada <mailto:ada@b.co|ada@b.co> · Weft v1.2.3_");
  });

  it("says when nobody was signed in", () => {
    expect(slackText({ summary, messages: [], from: null, version: null })).toContain("_From someone signed out_");
  });
});

describe("allow", () => {
  it(`lets ${LIMIT} through per window, per key`, () => {
    for (let i = 0; i < LIMIT; i++) expect(allow("a", 1000)).toBe(true);
    expect(allow("a", 1000)).toBe(false);
    expect(allow("b", 1000)).toBe(true);
    expect(allow("a", 1000 + WINDOW_MS)).toBe(true);
  });
});

describe("collectFeedback", () => {
  const env = { SLACK_FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/x" };

  it("stores it and posts it to Slack", async () => {
    const { client, insert } = table();
    const fetcher = ok();
    expect(await collectFeedback(body, "ip", { env, fetcher, service: client })).toBe(204);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ title: summary.title, from_email: "ada@b.co", version: "1.2.3" }));
    expect(fetcher).toHaveBeenCalledWith(env.SLACK_FEEDBACK_WEBHOOK_URL, expect.objectContaining({ method: "POST" }));
  });

  it("stores a signed-out summary with no sender", async () => {
    const { client, insert } = table();
    expect(await collectFeedback({ summary }, "ip", { env: {}, service: client })).toBe(204);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ from_name: null, from_email: null, version: null }));
  });

  it("is fine when only one of the two works", async () => {
    expect(await collectFeedback(body, "ip", { env, fetcher: ok(), service: table("down").client })).toBe(204);
    expect(await collectFeedback(body, "ip", { env, fetcher: vi.fn(() => Promise.reject(new Error("x"))), service: table().client })).toBe(204);
  });

  it("answers 502 when both fail and 503 when neither is set up", async () => {
    expect(await collectFeedback(body, "ip", { env, fetcher: vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))), service: table("down").client })).toBe(502);
    expect(await collectFeedback(body, "ip2", { env: {}, service: null })).toBe(503);
  });

  it("refuses a bad body and a flood", async () => {
    expect(await collectFeedback({}, "ip", { env: {}, service: null })).toBe(400);
    for (let i = 0; i < LIMIT; i++) await collectFeedback(body, "flood", { env: {}, service: null });
    expect(await collectFeedback(body, "flood", { env: {}, service: null })).toBe(429);
  });

  it("posts to the webhook the OAuth install stored, when the environment names none", async () => {
    // The install puts the address in the database (lib/slack-webhook-store.ts), so it never has to be copied
    // out of a console page by hand.
    vi.mocked(readWebhook).mockResolvedValueOnce("https://hooks.slack.com/stored");
    const fetcher = ok();
    expect(await collectFeedback(body, "ip", { env: {}, fetcher, service: table().client })).toBe(204);
    expect(fetcher).toHaveBeenCalledWith("https://hooks.slack.com/stored", expect.objectContaining({ method: "POST" }));
  });

  it("prefers the environment's webhook over the stored one", async () => {
    const fetcher = ok();
    await collectFeedback(body, "ip", { env, fetcher, service: table().client });
    expect(fetcher).toHaveBeenCalledWith(env.SLACK_FEEDBACK_WEBHOOK_URL, expect.objectContaining({ method: "POST" }));
    expect(readWebhook).not.toHaveBeenCalled();
  });

  it("reads process.env and the real service client by default", async () => {
    vi.stubEnv("SLACK_FEEDBACK_WEBHOOK_URL", "");
    expect(await collectFeedback(body, "default")).toBe(503);
    expect(serviceClient).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
