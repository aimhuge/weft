import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { registerSlack, slackRoutes, TOKEN_FILE } from "./slack.cjs";
import { API, lastSocket, make, safeStorage, sockets, tmp, tokenFile } from "./slack.harness";

describe("createSlack", () => {
  it("shows no workspace before Slack is set up", async () => {
    const { slack, calls } = make();
    expect(await slack.status()).toEqual({ signedIn: false, team: null, teamUrl: null, bot: null, socket: "off", error: null });
    expect(calls).toHaveLength(0);
    await expect(slack.channels()).rejects.toThrow("Connect Slack first.");
    await expect(slack.post({ channel: "C1", text: "hi" })).rejects.toThrow("Connect Slack first.");
  });

  it("keeps both tokens sealed, once Slack has accepted them", async () => {
    const { slack, dataDir, calls } = make();
    const status = await slack.setTokens("  xoxb-bot  ", "  xapp-app  ");
    expect(status).toMatchObject({ signedIn: true, team: "Acme", teamUrl: "https://acme.slack.com/", bot: "weft" });
    // Both tokens are checked with Slack before either is kept.
    expect(calls.slice(0, 2).map((c) => c.method)).toEqual(["auth.test", "apps.connections.open"]);
    expect(calls[0]?.token).toBe("xoxb-bot");
    expect(calls[1]?.token).toBe("xapp-app");
    const saved = fs.readFileSync(tokenFile(dataDir), "utf8");
    expect(saved).not.toContain("xoxb-bot");
    expect(saved).not.toContain("xapp-app");
    expect(fs.statSync(tokenFile(dataDir)).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(tokenFile(dataDir))).toBe(true);
  });

  it("says what a token should look like, and keeps nothing", async () => {
    const { slack, dataDir, calls } = make();
    await expect(slack.setTokens("nope", "xapp-a")).rejects.toThrow("xoxb-");
    await expect(slack.setTokens("xoxb-a", "nope")).rejects.toThrow("xapp-");
    await expect(slack.setTokens("", "")).rejects.toThrow("xoxb-");
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(tokenFile(dataDir))).toBe(false);
  });

  it("refuses a token Slack turns down, and one without the Keychain", async () => {
    const bad = make({ ...API, "auth.test": () => ({ body: { ok: false, error: "invalid_auth" } }) });
    await expect(bad.slack.setTokens("xoxb-a", "xapp-a")).rejects.toThrow("turned the token down");
    const locked = make(API, { safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });
    await expect(locked.slack.setTokens("xoxb-a", "xapp-a")).rejects.toThrow("Keychain");
  });

  it("forgets the tokens and the socket that used them", async () => {
    const { slack, dataDir } = make();
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.forgetToken()).toEqual({ signedIn: false, team: null, teamUrl: null, bot: null, socket: "off", error: null });
    expect(fs.existsSync(tokenFile(dataDir))).toBe(false);
    expect(await slack.status()).toMatchObject({ signedIn: false });
  });

  it("lists the channels, the bot's own first, paging through Slack's pages", async () => {
    const { slack, calls } = make({
      ...API,
      "conversations.list": (_url: URL, init: { body?: string }) => {
        const cursor = new URLSearchParams(init.body ?? "").get("cursor");
        if (!cursor) return { body: { ok: true, channels: [{ id: "C2", name: "random", is_member: false }, { id: "C1", name: "general", is_member: true }], response_metadata: { next_cursor: "page2" } } };
        return { body: { ok: true, channels: [{ id: "C3", name: "aaa", is_private: true, is_member: true }], response_metadata: { next_cursor: "" } } };
      },
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.channels()).toEqual([
      { id: "C3", name: "aaa", isPrivate: true, isMember: true },
      { id: "C1", name: "general", isPrivate: false, isMember: true },
      { id: "C2", name: "random", isPrivate: false, isMember: false },
    ]);
    const lists = calls.filter((c) => c.method === "conversations.list");
    expect(lists).toHaveLength(2);
    expect(lists[0]?.body).toEqual({ types: "public_channel,private_channel", exclude_archived: "true", limit: "200" });
    expect(lists[1]?.body.cursor).toBe("page2");
  });

  it("stops paging after a few pages, however many Slack offers", async () => {
    const { slack, calls } = make({
      ...API,
      "conversations.list": { body: { ok: true, channels: [{ id: "C1", name: "general" }], response_metadata: { next_cursor: "more" } } },
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    await slack.channels();
    expect(calls.filter((c) => c.method === "conversations.list")).toHaveLength(5);
  });

  it("makes a new channel with the bot token, and says to connect Slack first without one", async () => {
    const { slack, calls } = make({
      ...API,
      "conversations.create": { channel: { id: "C9", name: "weft-updates" } },
    });
    await expect(slack.createChannel("Weft Updates!")).rejects.toThrow("Connect Slack first.");
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.createChannel("Weft Updates!")).toEqual({ id: "C9", name: "weft-updates", isPrivate: false, isMember: true });
    const made = calls.find((c) => c.method === "conversations.create");
    expect(made?.token).toBe("xoxb-a");
    expect(made?.body).toEqual({ name: "weft-updates", is_private: "false" });
  });

  it("forgets the cached workspace when the token that made a channel stopped working", async () => {
    let dead = false;
    const { slack } = make({
      ...API,
      "conversations.create": () => (dead ? { body: { ok: false, error: "invalid_auth" } } : { body: { ok: true, channel: { id: "C9", name: "made" } } }),
      "auth.test": () => (dead ? { body: { ok: false, error: "invalid_auth" } } : { body: { ok: true, team: "Acme", url: "https://acme.slack.com/", user: "weft" } }),
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    expect((await slack.status()).team).toBe("Acme");
    // The token dies: the call fails, and the workspace setTokens cached is thrown away with it.
    dead = true;
    await expect(slack.createChannel("made")).rejects.toThrow("turned the token down");
    const status = await slack.status();
    expect(status.team).toBeNull();
    expect(status.error).toContain("turned the token down");
  });

  it("posts without unfurling the links in it", async () => {
    const { slack, calls } = make();
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.post({ channel: "C1", text: "hi", blocks: [{ type: "section" }], thread_ts: "1.1" })).toEqual({ channel: "C1", ts: "1.2" });
    const post = calls.find((c) => c.method === "chat.postMessage");
    expect(post?.body).toEqual({ channel: "C1", text: "hi", unfurl_links: "false", unfurl_media: "false", blocks: '[{"type":"section"}]', thread_ts: "1.1" });
  });

  it("joins a public channel it isn't in, and tries once more", async () => {
    let posted = 0;
    const { slack, calls } = make({
      ...API,
      "chat.postMessage": () => {
        posted += 1;
        return posted === 1 ? { body: { ok: false, error: "not_in_channel" } } : { body: { ok: true, channel: "C9", ts: "2.0" } };
      },
      "conversations.info": { body: { ok: true, channel: { id: "C9", is_private: false } } },
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    expect(await slack.post({ channel: "C9", text: "hi" })).toEqual({ channel: "C9", ts: "2.0" });
    expect(calls.find((c) => c.method === "conversations.join")?.body).toEqual({ channel: "C9" });
    expect(posted).toBe(2);
  });

  it("doesn't join a private channel it isn't in", async () => {
    const { slack, calls } = make({
      ...API,
      "chat.postMessage": { body: { ok: false, error: "not_in_channel" } },
      "conversations.info": { body: { ok: true, channel: { id: "C9", is_private: true } } },
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    await expect(slack.post({ channel: "C9", text: "hi" })).rejects.toThrow("isn't in that channel");
    expect(calls.find((c) => c.method === "conversations.join")).toBeUndefined();
  });

  it("reports a saved token that stopped working", async () => {
    // The token was saved and then stopped working: the first status() call is the one that finds out,
    // because the answer is cached only once Slack has given it.
    const { slack, dataDir } = make({ ...API, "auth.test": { body: { ok: false, error: "invalid_auth" } } });
    fs.writeFileSync(tokenFile(dataDir), JSON.stringify({ token: Buffer.from(`w:${JSON.stringify({ bot: "xoxb-a", app: "xapp-a" })}`).toString("base64") }));
    const status = await slack.status();
    expect(status).toMatchObject({ signedIn: true, team: null, bot: null });
    expect(status.error).toContain("turned the token down");
  });

  it("starts the socket when there are tokens to start it with", async () => {
    const { slack } = make();
    slack.start();
    expect(sockets()).toHaveLength(0);
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
  });

  it("forwards a /weft command to the server", async () => {
    const { slack, forward } = make();
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
    lastSocket().onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "slash_commands", payload: { command: "/weft", text: "start the site", channel_id: "C1", user_id: "U1" } }) });
    await vi.waitFor(() => expect(forward).toHaveBeenCalled());
    expect(forward.mock.calls[0]?.[0]).toEqual({ kind: "command", text: "start the site", channel: "C1", user: "U1" });
  });

  it("ignores another slash command", async () => {
    const { slack, forward } = make();
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
    lastSocket().onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "slash_commands", payload: { command: "/other", text: "x", channel_id: "C1", user_id: "U1" } }) });
    await vi.waitFor(() => expect(lastSocket().sent.length).toBeGreaterThan(0));
    expect(forward).not.toHaveBeenCalled();
  });

  it("forwards an @mention without the mention of the bot in it", async () => {
    const { slack, forward } = make();
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
    lastSocket().onmessage?.({
      data: JSON.stringify({ envelope_id: "e1", type: "events_api", payload: { event: { type: "app_mention", text: "<@U0BOT> please look at this", channel: "C1", user: "U1", ts: "1.5", thread_ts: "1.4" } } }),
    });
    await vi.waitFor(() => expect(forward).toHaveBeenCalled());
    expect(forward.mock.calls[0]?.[0]).toEqual({ kind: "mention", text: "please look at this", channel: "C1", user: "U1", ts: "1.5", threadTs: "1.4" });
  });

  it("ignores a bot's own mention, and anything else", async () => {
    const { slack, forward } = make();
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
    const socket = lastSocket();
    socket.onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "events_api", payload: { event: { type: "app_mention", text: "<@U0BOT> hi", channel: "C1", user: "U0BOT", bot_id: "B1" } } }) });
    socket.onmessage?.({ data: JSON.stringify({ envelope_id: "e2", type: "events_api", payload: { event: { type: "reaction_added", channel: "C1" } } }) });
    socket.onmessage?.({ data: JSON.stringify({ envelope_id: "e3", type: "hello" }) });
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
    expect(forward).not.toHaveBeenCalled();
  });

  it("keeps the socket alive when the server can't be reached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack } = make(API, {
      forward: () => Promise.reject(new Error("server down")),
    });
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
    lastSocket().onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "slash_commands", payload: { command: "/weft", text: "x", channel_id: "C1", user_id: "U1" } }) });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]?.[0]).toContain("couldn't deliver");
    warn.mockRestore();
  });
});

describe("registerSlack", () => {
  it("answers the board window only and passes arguments through", async () => {
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = {};
    const slack = { status: vi.fn(), setTokens: vi.fn(), forgetToken: vi.fn(), channels: vi.fn(), createChannel: vi.fn() };
    registerSlack(ipcMain, { slack, isBoard: (s: unknown) => s === board });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);
    await expect(handlers.get("slack:status")!({ sender: {} })).rejects.toThrow("board window");
    await call("slack:status");
    await call("slack:set-tokens", "xoxb-a", "xapp-a");
    await call("slack:set-tokens", undefined, undefined);
    await call("slack:forget-token");
    await call("slack:channels");
    await call("slack:create-channel", "weft-updates");
    await call("slack:create-channel", undefined);
    expect(slack.status).toHaveBeenCalled();
    expect(slack.setTokens.mock.calls).toEqual([["xoxb-a", "xapp-a"], ["", ""]]);
    expect(slack.forgetToken).toHaveBeenCalled();
    expect(slack.channels).toHaveBeenCalled();
    expect(slack.createChannel.mock.calls).toEqual([["weft-updates"], [""]]);
  });

  it("answers the board window only for a new channel too", async () => {
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = { name: "board" };
    const slack = { status: vi.fn(), setTokens: vi.fn(), forgetToken: vi.fn(), channels: vi.fn(), createChannel: vi.fn() };
    registerSlack(ipcMain, { slack, isBoard: (s: unknown) => s === board });
    await expect(handlers.get("slack:create-channel")!({ sender: {} }, "x")).rejects.toThrow("board window");
    expect(slack.createChannel).not.toHaveBeenCalled();
  });
});

describe("slackRoutes", () => {
  it("posts a message for the server", async () => {
    const post = vi.fn(() => Promise.resolve({ channel: "C1", ts: "1.2" }));
    const slack = { status: vi.fn(() => Promise.resolve({ signedIn: true })), post };
    const routes = slackRoutes(() => slack) as unknown as Record<string, (body: Record<string, unknown>) => unknown>;
    expect(await routes["POST /slack/post"]!({ channel: "C1", text: "hi" })).toEqual({ channel: "C1", ts: "1.2" });
    expect(post).toHaveBeenCalledWith({ channel: "C1", text: "hi", blocks: undefined, thread_ts: undefined });
  });

  it("says to connect Slack first when there is no Slack, or none set up", async () => {
    const none = slackRoutes(() => null) as unknown as Record<string, (body: Record<string, unknown>) => unknown>;
    await expect(none["POST /slack/post"]!({ channel: "C1", text: "hi" })).rejects.toThrow("Connect Slack first.");
    await expect(none["POST /slack/status"]!({})).rejects.toThrow("Connect Slack first.");
    const signedOut = slackRoutes(() => ({ status: () => Promise.resolve({ signedIn: false }), post: vi.fn() })) as unknown as Record<string, (body: Record<string, unknown>) => unknown>;
    await expect(signedOut["POST /slack/post"]!({ channel: "C1", text: "hi" })).rejects.toThrow("Connect Slack first.");
  });

  it("tells the server how Slack is doing", async () => {
    const status = { signedIn: true, team: "Acme", teamUrl: null, bot: "weft", socket: "connected", error: null };
    const routes = slackRoutes(() => ({ status: () => Promise.resolve(status) })) as unknown as Record<string, (body: Record<string, unknown>) => unknown>;
    expect(await routes["POST /slack/status"]!({})).toEqual(status);
  });
});

describe("createSlack without a saved token", () => {
  it("reads a token file it can't make sense of as no token", async () => {
    const dataDir = tmp("weft-data-");
    fs.writeFileSync(tokenFile(dataDir), JSON.stringify({ token: Buffer.from("w:not json").toString("base64") }));
    const { slack } = make(API, { dataDir });
    expect(await slack.status()).toMatchObject({ signedIn: false });
  });
});

describe("TOKEN_FILE", () => {
  it("is the file the tokens are kept in", () => {
    expect(TOKEN_FILE).toBe("slack-token.json");
  });
});

