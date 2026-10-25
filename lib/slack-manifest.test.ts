import { describe, expect, it } from "vitest";
import manifest from "./slack-manifest.json";

// The manifest Weft hands Slack (lib/slack-manifest.json), checked against the shape Slack's App Manifest API
// actually accepts. Slack rejects a manifest it doesn't like with a pointer to the offending field, but it
// rejects it at the moment someone tries to apply it — with a config token in hand, on a Slack app, minutes
// later. The mistakes worth catching are the ones that are silent until then:
//
// - `incoming_webhooks` lives under `settings`, not `features`. Slack's manifest reference puts it at
//   `settings.incoming_webhooks.incoming_webhooks_enabled`; there is no `features.incoming_webhooks`
//   subgroup, so a manifest that puts it there is silently ignored and the feature stays off with nothing
//   to say why.
// - `oauth_config.scopes` has `bot` and `user`. The `incoming-webhook` scope supports **bot and legacy bot
//   only** — Slack rejects it under `scopes.user` with `illegal_user_scopes`. It is the *install* (not the
//   scope's type) whose OAuth answer carries `incoming_webhook.url`, and an install grants bot scopes too.
//
// The scope names are checked against the lists Slack publishes
// (docs.slack.dev/reference/scopes, and the Slack SDK's own manifest types).

type Manifest = {
  display_information: { name: string; description: string; background_color: string };
  features: {
    bot_user?: { display_name: string; always_online?: boolean };
    slash_commands?: { command: string; description: string; usage_hint?: string; should_escape?: boolean }[];
  };
  oauth_config: { scopes: { bot?: string[]; user?: string[] }; redirect_urls?: string[]; pkce_enabled?: boolean };
  settings: {
    event_subscriptions?: { bot_events?: string[] };
    interactivity?: { is_enabled?: boolean };
    socket_mode_enabled?: boolean;
    token_rotation_enabled?: boolean;
    incoming_webhooks?: { incoming_webhooks_enabled?: boolean };
  };
};

const m = manifest as Manifest;

describe("the Slack manifest", () => {
  it("turns Incoming Webhooks on the way Slack reads it", () => {
    // Two shapes to get right, both silent when wrong: the key lives under `settings`, not `features`,
    // and the leaf is `incoming_webhooks_enabled`, not a name.
    expect(m.settings.incoming_webhooks).toEqual({ incoming_webhooks_enabled: true });
    expect(m.settings.incoming_webhooks?.incoming_webhooks_enabled).toBe(true);
    expect((m.features as { incoming_webhooks?: unknown }).incoming_webhooks).toBeUndefined();
  });

  it("asks for the incoming-webhook scope as a bot scope, so the install answer carries the webhook's URL", () => {
    // Slack rejects this scope under `scopes.user` (`illegal_user_scopes`) — it is bot/legacy-bot only.
    expect(m.oauth_config.scopes.bot).toContain("incoming-webhook");
    expect(m.oauth_config.scopes.user ?? []).not.toContain("incoming-webhook");
  });

  it("keeps the bot scopes the rail needs, so applying the manifest doesn't unmake the app", () => {
    expect(m.oauth_config.scopes.bot).toEqual([
      "app_mentions:read",
      "channels:join",
      "channels:manage",
      "channels:read",
      "chat:write",
      "chat:write.public",
      "commands",
      "groups:read",
      "incoming-webhook",
    ]);
  });

  it("keeps Socket Mode on, and the /weft command and the mention subscription", () => {
    // The rail's socket is what hears /weft and @mentions; a manifest without these would silence it.
    expect(m.settings.socket_mode_enabled).toBe(true);
    expect(m.features.slash_commands?.map((c) => c.command)).toEqual(["/weft"]);
    expect(m.settings.event_subscriptions?.bot_events).toEqual(["app_mention"]);
  });

  it("registers the OAuth redirect the install needs to hand back the webhook", () => {
    // Without a redirect URL, Slack has nowhere to send the install code, so the answer that carries
    // incoming_webhook.url never arrives.
    expect(m.oauth_config.redirect_urls).toContain("https://weft.zip/api/slack/oauth/callback");
  });

  it("keeps token rotation on, because Slack refuses to turn it off again", () => {
    // Token rotation was enabled on the app in the console. Slack's answer to a manifest that disables it
    // is `cannot_disable_once_enabled` — so a manifest saying `false` fails validation outright, and the
    // sync never lands. The setting is one-way: this must stay `true` from here on.
    expect(m.settings.token_rotation_enabled).toBe(true);
  });

  it("names the app and its bot, the way the drawer shows them", () => {
    expect(m.display_information.name).toBe("Weft");
    expect(m.features.bot_user?.display_name).toBe("Weft");
  });
});
