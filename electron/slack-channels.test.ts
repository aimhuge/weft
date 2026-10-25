import { describe, expect, it, vi } from "vitest";
import { channelName, channelOf, createChannel, listChannels, NAME_MAX } from "./slack-channels.cjs";
import { SlackError } from "./slack-api.cjs";

// The Slack drawer's channels, as Electron main reads and makes them (electron/slack-channels.cjs): the
// names Slack accepts, the list the picker shows, and a new channel made from that picker.

// A Web API call already bound to the bot token: the fake records the method and the body. The answer
// arrives as a promise, so a Slack failure comes back as a rejection, the way slackCall's does.
function fakeCall(answer: (method: string, body: Record<string, unknown>) => unknown) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const call = vi.fn((method: string, body: Record<string, unknown> = {}) => {
    calls.push({ method, body });
    return Promise.resolve().then(() => answer(method, body));
  });
  return { call, calls };
}

describe("channelName", () => {
  it("makes a name Slack accepts out of what a person typed", () => {
    expect(channelName("Weft Updates!")).toBe("weft-updates");
    expect(channelName("#a..b")).toBe("a-b");
    expect(channelName("a  b")).toBe("a-b");
    expect(channelName("a_b")).toBe("a_b");
    expect(channelName("#Weft")).toBe("weft");
  });

  it("takes the hyphens off the ends", () => {
    expect(channelName("-lead")).toBe("lead");
    expect(channelName("trail-")).toBe("trail");
    expect(channelName("--both--")).toBe("both");
  });

  it("keeps a name no longer than Slack's own limit", () => {
    expect(channelName("a".repeat(200))).toHaveLength(NAME_MAX);
    expect(NAME_MAX).toBe(80);
  });

  it("has no name to give when nothing is left of what was typed", () => {
    expect(channelName("")).toBe("");
    expect(channelName("   ")).toBe("");
    expect(channelName("!!!")).toBe("");
  });
});

describe("channelOf", () => {
  it("reads a channel as Slack's own words", () => {
    expect(channelOf({ id: "C1", name: "general", is_private: false, is_member: true })).toEqual({ id: "C1", name: "general", isPrivate: false, isMember: true });
    expect(channelOf({ id: "C2", name: "secret", is_private: true, is_member: false })).toEqual({ id: "C2", name: "secret", isPrivate: true, isMember: false });
  });

  it("has no name and no membership for a channel Slack says nothing about", () => {
    expect(channelOf(undefined)).toEqual({ id: "", name: "", isPrivate: false, isMember: false });
  });
});

describe("listChannels", () => {
  it("lists the bot's own channels first, then the rest by name", async () => {
    const { call } = fakeCall(() => ({
      channels: [
        { id: "C3", name: "zeta", is_member: false },
        { id: "C1", name: "general", is_member: true },
        { id: "C2", name: "alpha", is_member: false },
      ],
    }));
    expect(await listChannels(call)).toEqual([
      { id: "C1", name: "general", isPrivate: false, isMember: true },
      { id: "C2", name: "alpha", isPrivate: false, isMember: false },
      { id: "C3", name: "zeta", isPrivate: false, isMember: false },
    ]);
  });

  it("pages through Slack's pages, and asks for the channels the bot can post to", async () => {
    const { call, calls } = fakeCall((_method, body) =>
      body.cursor ? { channels: [{ id: "C2", name: "second" }], response_metadata: { next_cursor: "" } } : { channels: [{ id: "C1", name: "first" }], response_metadata: { next_cursor: "page2" } },
    );
    await listChannels(call);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toEqual({ types: "public_channel,private_channel", exclude_archived: true, limit: 200 });
    expect(calls[1]?.body.cursor).toBe("page2");
  });

  it("stops paging after a few pages, however many Slack offers", async () => {
    const { call } = fakeCall(() => ({ channels: [{ id: "C1", name: "general" }], response_metadata: { next_cursor: "more" } }));
    await listChannels(call);
    expect(call).toHaveBeenCalledTimes(5);
  });
});

describe("createChannel", () => {
  it("makes a public channel the bot is in from the start", async () => {
    const { call, calls } = fakeCall(() => ({ channel: { id: "C9", name: "weft-updates" } }));
    expect(await createChannel(call, "Weft Updates!")).toEqual({ id: "C9", name: "weft-updates", isPrivate: false, isMember: true });
    expect(calls).toEqual([{ method: "conversations.create", body: { name: "weft-updates", is_private: false } }]);
  });

  it("says the name is missing, and asks Slack for nothing", async () => {
    const { call } = fakeCall(() => ({ channel: { id: "C9" } }));
    await expect(createChannel(call, "   ")).rejects.toThrow("Give the channel a name");
    expect(call).not.toHaveBeenCalled();
  });

  it("says in words that the name is taken", async () => {
    const { call } = fakeCall(() => {
      throw new SlackError("name_taken", "Slack said name_taken");
    });
    await expect(createChannel(call, "general")).rejects.toThrow("#general is taken");
  });

  it("passes Slack's own failure on", async () => {
    const { call } = fakeCall(() => {
      throw new SlackError("missing_scope", "This Slack token is missing the channels:manage scope.");
    });
    await expect(createChannel(call, "general")).rejects.toThrow("channels:manage");
  });
});
