import { describe, expect, it } from "vitest";
import { inboundOf } from "./slack-inbound.cjs";

// What Slack sends over Socket Mode, and what Weft makes of it (docs/architecture/slack.md).
describe("inboundOf", () => {
  it("reads a /weft command", () => {
    expect(inboundOf({ type: "slash_commands", payload: { command: "/weft", text: "start the site", channel_id: "C1", user_id: "U1" } })).toEqual({
      kind: "command",
      text: "start the site",
      channel: "C1",
      user: "U1",
    });
  });

  it("leaves another slash command alone", () => {
    expect(inboundOf({ type: "slash_commands", payload: { command: "/other", text: "x" } })).toBeNull();
  });

  it("reads an @mention without the mention of the bot in it", () => {
    expect(inboundOf({ type: "events_api", payload: { event: { type: "app_mention", text: "<@U0BOT> please look", channel: "C1", user: "U1", ts: "1.5", thread_ts: "1.4" } } })).toEqual({
      kind: "mention",
      text: "please look",
      channel: "C1",
      user: "U1",
      ts: "1.5",
      threadTs: "1.4",
    });
  });

  it("leaves a bot's own mention alone", () => {
    expect(inboundOf({ type: "events_api", payload: { event: { type: "app_mention", text: "<@U0BOT> hi", bot_id: "B1" } } })).toBeNull();
  });

  it("leaves another event alone", () => {
    expect(inboundOf({ type: "events_api", payload: { event: { type: "reaction_added" } } })).toBeNull();
    expect(inboundOf({ type: "hello" })).toBeNull();
    expect(inboundOf({})).toBeNull();
  });

  it("leaves out the thread a mention wasn't in", () => {
    expect(inboundOf({ type: "events_api", payload: { event: { type: "app_mention", text: "hi" } } })).toEqual({
      kind: "mention",
      text: "hi",
      channel: "",
      user: "",
      ts: undefined,
      threadTs: undefined,
    });
  });
});
