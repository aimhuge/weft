// Slack's Web API, as one call (docs/architecture/slack.md). Slack answers every method with HTTP 200 and
// says in the body whether it worked ("ok": false plus a code), so a failure is two things at once: a code
// we can explain, and a sentence the user can act on. This module knows the codes worth explaining; the
// rest are passed along as "Slack said <code>", which is still better than a bare "request failed".

const SLACK_API = "https://slack.com/api";

// A Slack failure: the code Slack sent, and a sentence for the user.
class SlackError extends Error {
  /**
   * @param {string} code Slack's error code, e.g. "invalid_auth".
   * @param {string} message What to tell the user.
   */
  constructor(code, message) {
    super(message);
    this.name = "SlackError";
    this.code = code;
  }
}

// The sentences for the codes a user can fix. A missing scope is the one worth spelling out: Slack names
// the scope it wanted, and that is the whole answer.
const MESSAGES = {
  invalid_auth: "Slack turned the token down. Check that it's the bot token and that the app is still in the workspace.",
  not_authed: "Slack wants a token. Add the bot token and the app-level token.",
  account_inactive: "This Slack workspace is no longer active.",
  channel_not_found: "Slack can't see that channel. The bot may not be in it.",
  not_in_channel: "The bot isn't in that channel yet. A public channel is joined on the first post; a private one needs an invite.",
  is_archived: "That channel is archived, so Slack can't post to it.",
  ratelimited: "Slack is asking Weft to slow down. It'll try again shortly.",
};

/**
 * What to say about a failed Slack call.
 * @param {string} code Slack's error code.
 * @param {Record<string, unknown>} [answer] The whole answer, which names the scope a missing_scope needs.
 * @returns {string}
 */
function slackMessage(code, answer) {
  if (code === "missing_scope") {
    const needed = answer?.needed;
    const scope = Array.isArray(needed) ? needed.filter((n) => typeof n === "string").join(", ") : typeof needed === "string" ? needed : "";
    return scope ? `This Slack token is missing the ${scope} scope. Add it to the app's scopes and reinstall the app.` : "This Slack token is missing a scope. Add the scopes the app needs and reinstall the app.";
  }
  return MESSAGES[code] ?? `Slack said ${code}`;
}

// Every method takes a form body, while JSON is only promised for the write methods: conversations.list given JSON
// can drop its `types` and list public channels only. Objects (chat.postMessage's blocks) go as JSON strings.
function formOf(body) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return form.toString();
}

/**
 * One Web API call: a form POST to https://slack.com/api/<method> with the token as a bearer.
 * @param {typeof globalThis.fetch} fetchImpl The fetch to use (a fake in a test).
 * @param {string} token The Slack token to present.
 * @param {string} method The Slack method, e.g. "chat.postMessage".
 * @param {Record<string, unknown>} [body] The arguments of the method.
 * @returns {Promise<Record<string, unknown>>} The whole answer, with "ok" true.
 */
async function slackCall(fetchImpl, token, method, body = {}) {
  const res = await fetchImpl(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: formOf(body),
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw new SlackError(`http_${res.status}`, slackMessage(`http_${res.status}`, answer));
  if (!answer?.ok) {
    const code = typeof answer?.error === "string" ? answer.error : "unknown_error";
    throw new SlackError(code, slackMessage(code, answer));
  }
  return answer;
}

module.exports = { slackCall, slackMessage, formOf, SlackError, SLACK_API };
