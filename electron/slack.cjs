// Slack's side of Electron main (docs/architecture/slack.md): the bot token and the app-level token, sealed
// by safeStorage in ~/.weft/slack-token.json so a thread never sees them, the Socket Mode connection that
// hears `/weft` and @mentions, and the posting the server asks for. Like the other providers, it answers
// the board window only.
//
// Two tokens, because Slack needs two: the bot token (xoxb-) is what posts, and the app-level token
// (xapp-) is what opens the websocket. Both are checked with Slack before either is kept, so a typo is a
// sentence on screen instead of a silent sign-out later.

const fs = require("node:fs");
const path = require("node:path");
const { slackCall, SlackError } = require("./slack-api.cjs");
const { inboundOf } = require("./slack-inbound.cjs");
const { createSlackSocket } = require("./slack-socket.cjs");
const { createSlackWho } = require("./slack-who.cjs");
const { createChannel, listChannels } = require("./slack-channels.cjs");
const { readToken, requireKeychain, writeToken } = require("./provider-token.cjs");

const TOKEN_FILE = "slack-token.json";

/**
 * @param {object} options
 * @param {string} options.dataDir Where ~/.weft is.
 * @param {import("./provider-token.cjs").Keychain} options.safeStorage Electron's safeStorage.
 * @param {typeof globalThis.fetch} [options.fetch] The fetch to use (a fake in a test).
 * @param {typeof WebSocket} [options.WebSocketImpl] The websocket class (a fake in a test).
 * @param {(inbound: import("../lib/slack-types").SlackInbound) => Promise<void>} options.forward Delivers an inbound message to the server.
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer] The timer to wait on.
 * @param {(handle: unknown) => void} [options.clearTimer] The timer to cancel.
 */
function createSlack({ dataDir, safeStorage, fetch: fetchImpl = globalThis.fetch, WebSocketImpl, forward, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const tokenFile = path.join(dataDir, TOKEN_FILE);
  let socketState = "off";
  let socketError = null;

  /** @returns {{ bot: string, app: string } | null} */
  function tokens() {
    const saved = readToken(tokenFile, safeStorage);
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      return typeof parsed?.bot === "string" && typeof parsed?.app === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  const call = (token, method, body) => slackCall(fetchImpl, token, method, body);

  // What auth.test said last: the workspace, its address and the bot's name. Cached because the drawer
  // asks for status on every open, and Slack doesn't need to be asked twice for the same answer.
  const who = createSlackWho(async () => {
    const pair = tokens();
    return pair ? await call(pair.bot, "auth.test") : {};
  });

  // A failure to deliver isn't a reason to break the socket: Slack would redeliver the envelope, and the
  // server being down for a moment shouldn't look like Slack is broken.
  async function deliver(message) {
    const inbound = inboundOf(message);
    if (!inbound) return;
    try {
      await forward(inbound);
    } catch (err) {
      console.warn(`[slack] couldn't deliver a Slack message: ${err?.message ?? err}`);
    }
  }

  // The Socket Mode connection: it opens with the app-level token and carries what Slack sends.
  const socket = createSlackSocket({
    open: async () => {
      const pair = tokens();
      if (!pair) throw new Error("Slack isn't set up.");
      const answer = await call(pair.app, "apps.connections.open");
      const url = answer?.url;
      if (typeof url !== "string" || !url) throw new Error("Slack didn't give a connection address.");
      return url;
    },
    WebSocketImpl,
    setTimer,
    clearTimer,
    onState: (state, error) => {
      socketState = state;
      socketError = state === "connected" ? null : error ?? null;
    },
    onEnvelope: (message) => {
      void deliver(message);
    },
  });

  // One chat.postMessage.
  async function postRaw(bot, body) {
    const answer = await call(bot, "chat.postMessage", body);
    return { channel: String(answer?.channel ?? body.channel), ts: String(answer?.ts ?? "") };
  }

  // Whether a channel is private, asked of Slack: conversations.list says, but the channel being posted to
  // may not be in that list (a channel the bot was invited to by name). A private channel can't be joined.
  // Only a positive answer counts: a failed question leaves the channel's kind unknown, and joining a
  // private channel is a thing Slack refuses anyway.
  async function isPublic(bot, channel) {
    const answer = await call(bot, "conversations.info", { channel });
    // Slack has to say the channel is public before Weft joins it: an answer that doesn't say isn't
    // permission to join.
    return answer?.channel?.is_private === false;
  }

  // A Web API call with the bot token for each, and a dead token forgotten so the next status() asks Slack again.
  async function withBot(work) {
    const pair = tokens();
    if (!pair) throw new Error("Connect Slack first.");
    try {
      return await work((method, body) => call(pair.bot, method, body));
    } catch (err) {
      who.forgetIfTokenIsDead(err);
      throw err;
    }
  }

  return {
    // Whether Slack is set up, who the workspace is, and how the socket is doing.
    /** @returns {Promise<import("../lib/slack-types").SlackStatus>} */
    async status() {
      const pair = tokens();
      if (!pair) return { signedIn: false, team: null, teamUrl: null, bot: null, socket: socketState, error: socketError };
      try {
        const answer = await who.load();
        return { signedIn: true, ...answer, socket: socketState, error: socketError };
      } catch (err) {
        return { signedIn: true, team: null, teamUrl: null, bot: null, socket: socketState, error: err?.message ?? "Slack wouldn't answer." };
      }
    },

    // Keeps both tokens, once Slack has accepted them.
    /** @returns {Promise<import("../lib/slack-types").SlackStatus>} */
    async setTokens(bot, app) {
      const botValue = String(bot ?? "").trim();
      const appValue = String(app ?? "").trim();
      if (!botValue.startsWith("xoxb-")) throw new Error("The bot token starts with xoxb- . Copy it from the app's OAuth page.");
      if (!appValue.startsWith("xapp-")) throw new Error("The app-level token starts with xapp- . Copy it from the app's Basic Information page.");
      requireKeychain(safeStorage);
      // Check both with Slack before keeping either: a token that doesn't work is a sentence on screen.
      const answer = await call(botValue, "auth.test");
      // apps.connections.open gives the websocket address; it isn't needed yet, so it's discarded.
      await call(appValue, "apps.connections.open");
      writeToken(tokenFile, safeStorage, JSON.stringify({ bot: botValue, app: appValue }));
      who.set(answer);
      socket.stop();
      socket.start();
      return this.status();
    },

    // Forgets the tokens and the socket that used them.
    /** @returns {Promise<import("../lib/slack-types").SlackStatus>} */
    async forgetToken() {
      socket.stop();
      fs.rmSync(tokenFile, { force: true });
      who.clear();
      return { signedIn: false, team: null, teamUrl: null, bot: null, socket: "off", error: null };
    },

    // The channels the bot can post to (electron/slack-channels.cjs).
    /** @returns {Promise<import("../lib/slack-types").SlackChannel[]>} */
    channels() {
      return withBot((call) => listChannels(call));
    },

    // A new public channel, made from the drawer's picker; the bot is in it from the start.
    /** @returns {Promise<import("../lib/slack-types").SlackChannel>} */
    createChannel(name) {
      return withBot((call) => createChannel(call, name));
    },

    // Posts a message, joining a public channel first if the bot isn't in it yet.
    /** @returns {Promise<{ channel: string, ts: string }>} */
    async post(msg) {
      const pair = tokens();
      if (!pair) throw new Error("Connect Slack first.");
      const body = {
        channel: String(msg?.channel ?? ""),
        text: String(msg?.text ?? ""),
        unfurl_links: false,
        unfurl_media: false,
        ...(Array.isArray(msg?.blocks) ? { blocks: msg.blocks } : {}),
        ...(msg?.thread_ts ? { thread_ts: String(msg.thread_ts) } : {}),
      };
      try {
        return await postRaw(pair.bot, body);
      } catch (err) {
        who.forgetIfTokenIsDead(err);
        // A public channel the bot isn't in is the one case worth fixing by itself: join it and try again.
        if (err instanceof SlackError && err.code === "not_in_channel") {
          // Joining is only safe when Slack says the channel is public: a private one can't be joined,
          // and a channel Slack couldn't tell us about is not one to guess at.
          let publicChannel;
          try {
            publicChannel = await isPublic(pair.bot, body.channel);
          } catch (infoErr) {
            who.forgetIfTokenIsDead(infoErr);
            throw err;
          }
          if (publicChannel) {
            await call(pair.bot, "conversations.join", { channel: body.channel });
            return postRaw(pair.bot, body);
          }
        }
        throw err;
      }
    },

    // Any Slack Web API method, with the bot token: the rail can read (history, channels, a user's
    // timezone) as well as post, without the token ever leaving main.
    /**
     * @param {string} method The Slack method, e.g. "conversations.history".
     * @param {Record<string, unknown>} [body] The arguments of the method.
     * @returns {Promise<Record<string, unknown>>}
     */
    async call(method, body = {}) {
      const pair = tokens();
      if (!pair) throw new Error("Connect Slack first.");
      try {
        return await slackCall(fetchImpl, pair.bot, method, body);
      } catch (err) {
        who.forgetIfTokenIsDead(err);
        throw err;
      }
    },

    // Starts the socket, if there are tokens to start it with.
    start() {
      if (!tokens()) return;
      socket.start();
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerSlack(ipcMain, { slack, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Slack only answers the board window.");
      return fn(...args);
    });
  handle("slack:status", () => slack.status());
  handle("slack:set-tokens", (bot, app) => slack.setTokens(String(bot ?? ""), String(app ?? "")));
  handle("slack:forget-token", () => slack.forgetToken());
  handle("slack:channels", () => slack.channels());
  handle("slack:create-channel", (name) => slack.createChannel(String(name ?? "")));
}

// The control server's routes: what the server asks main to post, and how Slack is doing.
function slackRoutes(slackApi) {
  const api = () => slackApi() ?? null;
  return {
    // The server posts a message to Slack with the bot token. No token, no posting.
    "POST /slack/post": async ({ channel, text, blocks, thread_ts }) => {
      const slack = api();
      if (!slack) throw new Error("Connect Slack first.");
      const status = await slack.status();
      if (!status.signedIn) throw new Error("Connect Slack first.");
      return slack.post({ channel: String(channel ?? ""), text: String(text ?? ""), blocks, thread_ts: thread_ts ? String(thread_ts) : undefined });
    },
    "POST /slack/status": async () => {
      const slack = api();
      if (!slack) throw new Error("Connect Slack first.");
      return slack.status();
    },
    // Any Slack Web API method, with the bot token main holds. The server asks for it; main makes the call.
    "POST /slack/call": async ({ method, body }) => {
      const slack = api();
      if (!slack) throw new Error("Connect Slack first.");
      const name = String(method ?? "").trim();
      if (!name) throw new Error("Give the Slack method to call.");
      return slack.call(name, body ?? {});
    },
  };
}

// Wires Slack into Electron main for the board window (board() is its webContents). server() is the
// Next server's { url, token }, or null when there is none: without it there's nowhere to forward to.
// safeStorage comes from Electron here and nowhere else; a test passes its own in.
function setupSlack({ ipcMain, dataDir, board, server, safeStorage: given, fetch: fetchImpl = globalThis.fetch, WebSocketImpl, setTimer, clearTimer }) {
  const safeStorage = given ?? require("./keychain-audit.cjs").keychainFor("Slack tokens");
  // Slack talks to the server, not to the board: main forwards each message to /api/slack/inbound.
  const forward = async (inbound) => {
    const target = server?.();
    if (!target?.url) {
      console.warn("[slack] no Weft server to forward to; a Slack message was dropped.");
      return;
    }
    await forwardTo(fetchImpl, target.url, target.token, inbound);
  };
  const slack = createSlack({ dataDir, safeStorage, forward, fetch: fetchImpl, WebSocketImpl, setTimer, clearTimer });
  registerSlack(ipcMain, { slack, isBoard: (sender) => Boolean(sender) && sender === board() });
  // start() reads the token, and safeStorage throws before the app is ready — main calls this at load,
  // so wait for ready. A test's own safeStorage has no such rule.
  const ready = given ? Promise.resolve() : require("electron").app.whenReady();
  ready.then(() => slack.start()).catch((err) => console.warn("[slack] couldn't start:", err));
  return slack;
}

// One POST to the server's inbound route, with the launch token the board's own fetches use.
async function forwardTo(fetchImpl, url, token, inbound) {
  const res = await fetchImpl(`${url}/api/slack/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-weft-token": token ?? "" },
    body: JSON.stringify(inbound),
  });
  if (!res.ok) throw new Error(`The Weft server answered ${res.status} for a Slack message.`);
}

module.exports = { createSlack, registerSlack, slackRoutes, setupSlack, TOKEN_FILE };
