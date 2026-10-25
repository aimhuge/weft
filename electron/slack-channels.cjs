// The Slack drawer's channels, as Electron main reads and makes them (docs/architecture/slack.md): the list its
// picker shows, and a new channel made from that picker. Out of electron/slack.cjs, which holds the tokens and the
// socket, so each stays under the size cap. `call(method, body)` is a Web API call already bound to the bot token.

// A workspace has more channels than one page holds; a few pages is plenty to pick from.
const MAX_PAGES = 5;
const PAGE_SIZE = 200;
// Slack's own limit on a channel's name.
const NAME_MAX = 80;

// One channel as Slack's own words, read as the drawer needs it.
function channelOf(channel) {
  return {
    id: String(channel?.id ?? ""),
    name: String(channel?.name ?? ""),
    isPrivate: channel?.is_private === true,
    isMember: channel?.is_member === true,
  };
}

// A name Slack accepts: lowercase letters, digits, hyphens and underscores, no spaces, at most 80. "Weft Updates!"
// becomes "weft-updates"; a leading # is dropped.
function channelName(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\s.]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX);
}

// The channels the bot can post to: the ones it's in first, then the rest by name.
async function listChannels(call) {
  const all = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await call("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    for (const channel of answer?.channels ?? []) all.push(channelOf(channel));
    cursor = answer?.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return all.sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.name.localeCompare(b.name));
}

// Makes a public channel, which the bot is in from the start (it made it). A name that's taken says so in words;
// Slack's own codes for the rest come through slackCall's sentences (missing_scope names channels:manage).
async function createChannel(call, text) {
  const name = channelName(text);
  if (!name) throw new Error("Give the channel a name: letters, numbers, - or _.");
  try {
    const answer = await call("conversations.create", { name, is_private: false });
    return { ...channelOf(answer?.channel), isMember: true };
  } catch (err) {
    if (err?.code === "name_taken") throw new Error(`#${name} is taken (it may be archived). Pick it from the list, or another name.`);
    throw err;
  }
}

module.exports = { channelOf, channelName, listChannels, createChannel, NAME_MAX };
