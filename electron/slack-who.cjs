// What Slack last said about the workspace (docs/architecture/slack.md): the team, its address and the
// bot's name, from auth.test. The drawer asks for status on every open, so the answer is cached.
//
// The cache is only worth anything while the token works. A revoked token leaves the old answer behind,
// and the drawer goes on saying "connected" to a workspace Slack has forgotten the app in: so a call
// that fails because the token itself is dead throws the answer away, and the next status() asks Slack.

const { SlackError } = require("./slack-api.cjs");

// The codes that mean the token itself is no good: revoked, expired, the app uninstalled.
const AUTH_FAILURES = new Set(["invalid_auth", "token_revoked", "account_inactive", "not_authed"]);

// Whether a failure is one of Slack's own, by its name and code: the class identity shifts between the
// CommonJS module here and the copy a bundler or a test imports.
function isSlackFailure(err) {
  return err instanceof SlackError || err?.name === "SlackError";
}

/**
 * The cached auth.test answer, and when to let it go.
 * @param {() => Promise<Record<string, unknown>>} ask auth.test, called when there is no answer yet.
 */
function createSlackWho(ask) {
  let who = null;

  return {
    /** @returns {{ team: string | null, teamUrl: string | null, bot: string | null } | null} */
    get() {
      return who;
    },
    /** @param {Record<string, unknown>} answer Slack's auth.test answer. */
    set(answer) {
      who = {
        team: typeof answer?.team === "string" ? answer.team : null,
        teamUrl: typeof answer?.url === "string" ? answer.url : null,
        bot: typeof answer?.user === "string" ? answer.user : null,
      };
    },
    clear() {
      who = null;
    },
    /**
     * The cached answer, asked of Slack when there is none. An answer that isn't there is a failure to
     * report, not a reason to keep asking.
     * @returns {Promise<{ team: string | null, teamUrl: string | null, bot: string | null } | null>}
     */
    async load() {
      if (!who) this.set(await ask());
      return who;
    },
    // A call that failed because the token is dead also kills what the last good auth.test said.
    /** @param {unknown} err The failure. */
    forgetIfTokenIsDead(err) {
      if (isSlackFailure(err) && AUTH_FAILURES.has(err.code)) who = null;
    },
  };
}

module.exports = { createSlackWho, AUTH_FAILURES };
