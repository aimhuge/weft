import { describe, expect, it } from "vitest";
import { formOf, slackCall, slackMessage, SlackError } from "./slack-api.cjs";

type Init = { method: string; headers: Record<string, string>; body?: string };

// A fake slack.com: answers with the body it was given, or a failure with a status and a body.
function fakeFetch(answer: { status?: number; body: unknown }, calls: { url: string; init: Init }[] = []) {
  return (url: string | URL, init: Init) => {
    calls.push({ url: String(url), init });
    const status = answer.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => (answer.body === "bad json" ? Promise.reject(new Error("x")) : Promise.resolve(answer.body)),
    });
  };
}

describe("slackCall", () => {
  it("posts a form to the method with the token as a bearer", async () => {
    const calls: { url: string; init: Init }[] = [];
    const fetch = fakeFetch({ body: { ok: true, ts: "1.2" } }, calls);
    const answer = await slackCall(fetch as unknown as typeof globalThis.fetch, "xoxb-tok", "chat.postMessage", { channel: "C1", text: "hi" });
    expect(answer).toEqual({ ok: true, ts: "1.2" });
    expect(calls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers.Authorization).toBe("Bearer xoxb-tok");
    expect(calls[0]?.init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(calls[0]?.init.body))).toEqual({ channel: "C1", text: "hi" });
  });

  it("posts an empty body when there are no arguments", async () => {
    const calls: { url: string; init: Init }[] = [];
    await slackCall(fakeFetch({ body: { ok: true } }, calls) as unknown as typeof globalThis.fetch, "t", "auth.test");
    expect(calls[0]?.init.body).toBe("");
  });

  it("throws a SlackError when Slack says it failed", async () => {
    const fetch = fakeFetch({ body: { ok: false, error: "invalid_auth" } });
    await expect(slackCall(fetch as unknown as typeof globalThis.fetch, "bad", "auth.test")).rejects.toThrow("Slack turned the token down");
    await expect(slackCall(fetch as unknown as typeof globalThis.fetch, "bad", "auth.test")).rejects.toBeInstanceOf(SlackError);
  });

  it("keeps the code on the error, so a caller can act on it", async () => {
    const fetch = fakeFetch({ body: { ok: false, error: "not_in_channel" } });
    await expect(slackCall(fetch as unknown as typeof globalThis.fetch, "t", "chat.postMessage")).rejects.toMatchObject({ code: "not_in_channel" });
  });

  it("throws when the request itself fails", async () => {
    const fetch = fakeFetch({ status: 500, body: { ok: false, error: "internal_error" } });
    await expect(slackCall(fetch as unknown as typeof globalThis.fetch, "t", "auth.test")).rejects.toThrow("Slack said http_500");
  });

  it("reads an answer that isn't JSON as a failure", async () => {
    const fetch = fakeFetch({ body: "bad json" });
    await expect(slackCall(fetch as unknown as typeof globalThis.fetch, "t", "auth.test")).rejects.toThrow("Slack said unknown_error");
  });
});

describe("slackMessage", () => {
  it("says something a user can act on for the common codes", () => {
    expect(slackMessage("invalid_auth")).toContain("turned the token down");
    expect(slackMessage("not_authed")).toContain("wants a token");
    expect(slackMessage("account_inactive")).toContain("no longer active");
    expect(slackMessage("channel_not_found")).toContain("can't see that channel");
    expect(slackMessage("not_in_channel")).toContain("isn't in that channel");
    expect(slackMessage("is_archived")).toContain("archived");
    expect(slackMessage("ratelimited")).toContain("slow down");
  });

  it("names the scope a missing_scope needs", () => {
    expect(slackMessage("missing_scope", { needed: ["channels:read", "chat:write"] })).toContain("channels:read, chat:write");
    expect(slackMessage("missing_scope", { needed: "chat:write" })).toContain("chat:write");
    expect(slackMessage("missing_scope", {})).toContain("missing a scope");
    expect(slackMessage("missing_scope", { needed: [1, "chat:write"] })).toContain("chat:write");
  });

  it("passes an unknown code along", () => {
    expect(slackMessage("some_new_code")).toBe("Slack said some_new_code");
  });
});

describe("formOf", () => {
  it("sends objects as JSON, numbers and booleans as text, and leaves out what's unset", () => {
    const form = new URLSearchParams(formOf({ blocks: [{ type: "section" }], limit: 200, exclude_archived: true, cursor: undefined, x: null }));
    expect(Object.fromEntries(form)).toEqual({ blocks: '[{"type":"section"}]', limit: "200", exclude_archived: "true" });
  });
});
