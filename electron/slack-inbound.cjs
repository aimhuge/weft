// What Slack sends over Socket Mode, turned into what the server needs (docs/architecture/slack.md): a
// `/weft` command or an @mention of the bot. Slack's envelopes are one shape for a slash command and
// another for an event, and both carry a lot Weft doesn't want: the raw command, the mention of the bot
// in the text, and the bot's own messages coming back as mentions.
//
// Kept apart from electron/slack.cjs because this is a contract with Slack's message format, not with the
// Keychain or the websocket: it can be read on its own.

// Slack's messages come with the mention of the bot in them; the text is what's left once that's cut out.
const MENTION = /<@[A-Z0-9]+>/g;

/**
 * An @mention of the bot, read as the server needs it.
 * @param {Record<string, unknown>} event The event Slack sent.
 * @returns {import("../lib/slack-types").SlackInbound}
 */
function mentionOf(event) {
  return {
    kind: "mention",
    text: String(event.text ?? "").replace(MENTION, "").trim(),
    channel: String(event.channel ?? ""),
    user: String(event.user ?? ""),
    ts: event.ts ? String(event.ts) : undefined,
    threadTs: event.thread_ts ? String(event.thread_ts) : undefined,
  };
}

/**
 * The inbound message an envelope means, or null when Weft has nothing to do with it.
 * @param {Record<string, unknown>} message A Slack envelope.
 * @returns {import("../lib/slack-types").SlackInbound | null}
 */
function inboundOf(message) {
  const type = message?.type;
  const payload = message?.payload ?? {};
  if (type === "slash_commands") {
    // Slack can be given other slash commands; only Weft's is ours.
    if (payload.command !== "/weft") return null;
    return { kind: "command", text: String(payload.text ?? ""), channel: String(payload.channel_id ?? ""), user: String(payload.user_id ?? "") };
  }
  if (type === "events_api") {
    const event = payload.event ?? {};
    if (event.type !== "app_mention") return null;
    // A bot's own message comes back as an @mention; answering it would be talking to ourselves.
    if (event.bot_id) return null;
    return mentionOf(event);
  }
  return null;
}

module.exports = { inboundOf, mentionOf, MENTION };
