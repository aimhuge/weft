import { describe, expect, it } from "vitest";
import { API, make } from "./slack.harness";

// Two things can go wrong when Weft posts to a channel it isn't in: joining a channel Slack can't be
// joined to, and going on saying "connected" after the token stops working.
describe("posting to a channel the bot isn't in", () => {
  it("doesn't join a channel it couldn't ask Slack about", async () => {
    // Slack wouldn't say whether the channel is private: a channel of an unknown kind is not one to
    // join on a guess, so the original failure is what the user hears.
    const { slack, calls } = make({
      ...API,
      "chat.postMessage": { body: { ok: false, error: "not_in_channel" } },
      "conversations.info": { body: { ok: false, error: "channel_not_found" } },
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    await expect(slack.post({ channel: "C9", text: "hi" })).rejects.toThrow("isn't in that channel");
    expect(calls.find((c) => c.method === "conversations.join")).toBeUndefined();
  });

  it("doesn't join a channel Slack didn't say was public", async () => {
    // Slack answered, but without saying the channel is public: joining needs a positive answer.
    const { slack, calls } = make({
      ...API,
      "chat.postMessage": { body: { ok: false, error: "not_in_channel" } },
      "conversations.info": { body: { ok: true, channel: { id: "C9" } } },
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    await expect(slack.post({ channel: "C9", text: "hi" })).rejects.toThrow("isn't in that channel");
    expect(calls.find((c) => c.method === "conversations.join")).toBeUndefined();
  });
});

describe("a token that stops working", () => {
  it("forgets the workspace when a post finds out", async () => {
    // The token was fine when it was set up and is revoked after: the cached answer would keep the
    // drawer saying "connected" to a workspace Slack has dropped the app from.
    let revoked = false;
    const { slack } = make({
      ...API,
      "auth.test": () => (revoked ? { body: { ok: false, error: "invalid_auth" } } : { body: { ok: true, team: "Acme", url: "https://acme.slack.com/", user: "weft" } }),
      "chat.postMessage": () => (revoked ? { body: { ok: false, error: "invalid_auth" } } : { body: { ok: true, channel: "C1", ts: "1.2" } }),
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.status()).toMatchObject({ signedIn: true, team: "Acme" });
    revoked = true;
    await expect(slack.post({ channel: "C1", text: "hi" })).rejects.toThrow("turned the token down");
    // The next status asks Slack again, and reports what Slack says.
    const status = await slack.status();
    expect(status).toMatchObject({ signedIn: true, team: null, bot: null });
    expect(status.error).toContain("turned the token down");
  });

  it("forgets the workspace when listing the channels finds a dead token", async () => {
    let revoked = false;
    const { slack } = make({
      ...API,
      "auth.test": () => (revoked ? { body: { ok: false, error: "token_revoked" } } : { body: { ok: true, team: "Acme", url: "https://acme.slack.com/", user: "weft" } }),
      "conversations.list": () => (revoked ? { body: { ok: false, error: "token_revoked" } } : { body: { ok: true, channels: [] } }),
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.status()).toMatchObject({ team: "Acme" });
    revoked = true;
    await expect(slack.channels()).rejects.toThrow("Slack said token_revoked");
    const status = await slack.status();
    expect(status.team).toBeNull();
    expect(status.error).toContain("Slack said token_revoked");
  });
});
