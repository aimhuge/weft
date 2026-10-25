import { describe, expect, it } from "vitest";
import manifest from "./slack-manifest.json";

// The manifest Weft hands Slack (lib/slack-manifest.json), checked against the shape Slack's App Manifest API
// actually accepts. Slack rejects a manifest it doesn't like with a pointer to the offending field, but it
// rejects it at the moment someone tries to apply it — with a config token in hand, on a Slack app, minutes
// later. The mistakes worth catching are the ones that are silent until then:
//
// - `features.incoming_webhooks` takes `{ incoming_webhooks_enabled: true }`. The older `{ name: "Feedback" }`
//   shape looks right and is not what Slack reads, so the feature stays off and nothing says why.
// - `oauth_config.scopes` has `bot` and `user`. The `incoming-webhook` scope has to be a *user* scope: it's the
//   user grant whose OAuth response carries `incoming_webhook.url`, which is where the feedback webhook's
//   address comes from. A bot scope creates nothing to read.
//
// The scope names are checked against the lists Slack publishes
// (docs.slack.dev/reference/scopes, and the Slack SDK's own manifest types).

type Manifest = {
  display_information: { name: string; description: string; background_color: string };
  features: {
    bot_user?: { display_name: string; always_online?: boolean };
    slash_commands?: { command: string; description: string; usage_hint?: string; should_escape?: boolean }[];
    incoming_webhooks?: { incoming_webhooks_enabled?: boolean };
  };
  oauth_config: { scopes: { bot?: string[]; user?: string[] } };
  settings: {
    event_subscriptions?: { bot_events?: string[] };
    interactivity?: { is_enabled?: boolean };
    socket_mode_enabled?: boolean;
    token_rotation_enabled?: boolean;
  };
};

const m = manifest as Manifest;

describe("the Slack manifest", () => {
  it("turns Incoming Webhooks on the way Slack reads it", () => {
    // The shape is the whole point: `{ name }` here is silently ignored by Slack.
    expect(m.features.incoming_webhooks).toEqual({ incoming_webhooks_enabled: true });
    expect(m.features.incoming_webhooks?.incoming_webhooks_enabled).toBe(true);
  });

  it("asks for the incoming-webhook scope as a user scope, so the OAuth answer carries the webhook's URL", () => {
    expect(m.oauth_config.scopes.user).toContain("incoming-webhook");
    // A bot scope for it would be accepted and would still leave the URL unreadable.
    expect(m.oauth_config.scopes.bot ?? []).not.toContain("incoming-webhook");
  });

  it("keeps the bot scopes the rail needs, so applying the manifest doesn't unmake the app", () => {
    expect(m.oauth_config.scopes.bot).toEqual([
      "chat:write",
      "chat:write.public",
      "commands",
      "app_mentions:read",
      "channels:read",
      "groups:read",
      "channels:join",
      "channels:manage",
    ]);
  });

  it("keeps Socket Mode on, and the /weft command and the mention subscription", () => {
    // The rail's socket is what hears /weft and @mentions; a manifest without these would silence it.
    expect(m.settings.socket_mode_enabled).toBe(true);
    expect(m.features.slash_commands?.map((c) => c.command)).toEqual(["/weft"]);
    expect(m.settings.event_subscriptions?.bot_events).toEqual(["app_mention"]);
  });

  it("names the app and its bot, the way the drawer shows them", () => {
    expect(m.display_information.name).toBe("Weft");
    expect(m.features.bot_user?.display_name).toBe("Weft");
  });
});
