// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  channelHint,
  channelRows,
  channelScore,
  channelLabel,
  EVENT_LABELS,
  manifestUrl,
  slackBridge,
  slackChannelName,
  slackTitle,
  SLACK_KINDS,
  SLACK_MANIFEST,
  SOCKET_STATE,
} from "./slack-view";
import { DEFAULT_SLACK_SETTINGS, type SlackChannel, type SlackStatus } from "./slack-types";

const status = (over: Partial<SlackStatus> = {}): SlackStatus => ({
  signedIn: true,
  team: "Acme",
  teamUrl: null,
  bot: "Weft",
  socket: "connected",
  error: null,
  ...over,
});

const channel = (over: Partial<SlackChannel> = {}): SlackChannel => ({
  id: "C1",
  name: "eng",
  isPrivate: false,
  isMember: true,
  ...over,
});

describe("the bridge", () => {
  it("is the shell's Slack side, or nothing in a browser tab", () => {
    expect(slackBridge()).toBeNull();
    const slack = { status: () => Promise.resolve(status()) };
    (window as unknown as { weft: unknown }).weft = { slack };
    expect(slackBridge()).toBe(slack);
    delete (window as unknown as { weft?: unknown }).weft;
  });
});

describe("the manifest", () => {
  it("names the app and gives it the /weft command", () => {
    expect(SLACK_MANIFEST.display_information.name).toBe("Weft");
    expect(SLACK_MANIFEST.display_information.description).toContain("Weft board in Slack");
    expect(SLACK_MANIFEST.features.bot_user.display_name).toBe("Weft");
    expect(SLACK_MANIFEST.features.bot_user.always_online).toBe(true);
    const [command] = SLACK_MANIFEST.features.slash_commands;
    expect(command?.command).toBe("/weft");
    expect(command?.description).toBe("Start a Weft card");
    expect(command?.usage_hint).toBe("fix the login bug");
    expect(command?.should_escape).toBe(false);
  });

  it("asks for the scopes Weft needs and listens for mentions", () => {
    expect(SLACK_MANIFEST.oauth_config.scopes.bot).toContain("chat:write");
    expect(SLACK_MANIFEST.oauth_config.scopes.bot).toContain("commands");
    expect(SLACK_MANIFEST.oauth_config.scopes.bot).toContain("channels:join");
    expect(SLACK_MANIFEST.settings.event_subscriptions.bot_events).toEqual(["app_mention"]);
    expect(SLACK_MANIFEST.settings.interactivity.is_enabled).toBe(false);
    expect(SLACK_MANIFEST.settings.socket_mode_enabled).toBe(true);
    // On: once the console has turned it on, Slack refuses a manifest that turns it off (ab3c05b).
    expect(SLACK_MANIFEST.settings.token_rotation_enabled).toBe(true);
    expect(SLACK_MANIFEST.settings.org_deploy_enabled).toBe(false);
  });

  it("builds the app-creation page from the manifest", () => {
    const url = manifestUrl();
    expect(url.startsWith("https://api.slack.com/apps?new_app=1&manifest_json=")).toBe(true);
    const json = decodeURIComponent(url.slice(url.indexOf("manifest_json=") + "manifest_json=".length));
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(SLACK_MANIFEST)));
  });
});

describe("the rail button's title", () => {
  it("asks for a workspace, then a channel, then names the channel", () => {
    expect(slackTitle(null, null)).toBe("Slack: connect a workspace");
    expect(slackTitle(status({ signedIn: false }), null)).toBe("Slack: connect a workspace");
    expect(slackTitle(status(), null)).toBe("Slack: pick a channel");
    expect(slackTitle(status(), { ...DEFAULT_SLACK_SETTINGS, channel: "C1", channelName: "eng" })).toBe("Slack: posting to #eng");
  });
});

describe("the events the drawer switches on", () => {
  it("are the five Weft posts about, each with a label", () => {
    expect([...SLACK_KINDS]).toEqual(["commits", "pushes", "deploys", "status", "growth"]);
    for (const key of SLACK_KINDS) expect(EVENT_LABELS[key]).toBeTruthy();
    expect(EVENT_LABELS.deploys).toContain("Vercel");
    expect(EVENT_LABELS.status).toContain("weft.zip");
    expect(EVENT_LABELS.growth).toContain("payment");
  });
});

describe("the socket's dot", () => {
  it("is green when it listens, amber while it connects, grey when it is off", () => {
    expect(SOCKET_STATE.connected.tone).toBe("ok");
    expect(SOCKET_STATE.connected.label).toBe("listening for /weft");
    expect(SOCKET_STATE.connecting.tone).toBe("warn");
    expect(SOCKET_STATE.off.tone).toBe("muted");
  });
});

describe("a channel the bot isn't in", () => {
  it("says a private one needs an invite and a public one joins itself", () => {
    expect(channelHint(channel())).toBe("");
    expect(channelHint(channel({ isMember: false, isPrivate: true }))).toBe(" (invite @Weft)");
    expect(channelHint(channel({ isMember: false }))).toBe(" (joins on first post)");
    expect(channelLabel(channel({ isMember: false, isPrivate: true }))).toBe("#eng (invite @Weft)");
  });
});

describe("the channel picker's order", () => {
  const ch = (name: string, isMember = false): SlackChannel => ({ id: name, name, isPrivate: false, isMember });

  it("scores the project's own name, then a channel carrying it, then the bot's channels", () => {
    expect(channelScore(ch("weft"), "/dev/weft")).toBe(3);
    expect(channelScore(ch("Weft-Dev"), "/dev/weft")).toBe(2);
    expect(channelScore(ch("general", true), "/dev/weft")).toBe(1);
    expect(channelScore(ch("general"), "/dev/weft")).toBe(0);
    expect(channelScore(ch("weft"), null)).toBe(0);
  });

  it("keeps what the search matches, best fits first", () => {
    const channels = [ch("general", true), ch("weft-dev"), ch("random")];
    expect(channelRows(channels, "", "/dev/weft").map((r) => r.item.name)).toEqual(["weft-dev", "general", "random"]);
    expect(channelRows(channels, "RAN", "/dev/weft").map((r) => r.item.name)).toEqual(["random"]);
  });
});

describe("the name a new channel gets", () => {
  it("makes a name Slack accepts out of what a person typed", () => {
    expect(slackChannelName("Weft Updates!")).toBe("weft-updates");
    expect(slackChannelName("#a..b")).toBe("a-b");
    expect(slackChannelName("a  b")).toBe("a-b");
    expect(slackChannelName("a_b")).toBe("a_b");
    expect(slackChannelName("#Weft")).toBe("weft");
  });

  it("takes the hyphens off the ends", () => {
    expect(slackChannelName("-lead")).toBe("lead");
    expect(slackChannelName("trail-")).toBe("trail");
    expect(slackChannelName("--both--")).toBe("both");
  });

  it("keeps a name no longer than Slack's own limit", () => {
    expect(slackChannelName("a".repeat(200))).toHaveLength(80);
  });

  it("has no name to give when nothing is left of what was typed", () => {
    expect(slackChannelName("")).toBe("");
    expect(slackChannelName("   ")).toBe("");
    expect(slackChannelName("!!!")).toBe("");
  });
});
