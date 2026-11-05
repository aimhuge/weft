// The shapes Slack's three sides share (docs/architecture/slack.md): Electron main keeps the tokens and the Socket
// Mode connection (electron/slack.cjs), the server decides what to post (lib/slack*.ts), and the rail's Slack drawer
// (components/SlackDrawer.tsx) connects it and picks the channel and events.

// The kinds of update Weft posts, each of which can go to a channel of its own. One list: the drawer's "Post about"
// checkboxes, the settings' defaults and the server's switch all read it, so a kind can't be added to one and
// forgotten in another.
export const SLACK_KINDS = ["commits", "pushes", "deploys", "status", "growth"] as const;

export type SlackEventKey = (typeof SLACK_KINDS)[number];

// What each kind is called in the drawer, beside the kind itself.
export const EVENT_LABELS: Record<SlackEventKey, string> = {
  commits: "Commits",
  pushes: "Pushes",
  deploys: "Deploys (Vercel)",
  status: "Card status (preview + weft.zip link)",
  growth: "Growth (new user, new team, payment)",
};

// Which kinds the server posts about, all of them on by default.
export type SlackEvents = Record<SlackEventKey, boolean>;

// A project with a channel of its own: its updates go there, and a card started there runs in it.
export interface SlackLink {
  folder: string;
  channel: string;
  channelName: string | null;
}

// Where each kind of update goes, when it is not the default channel: a channel id, with the name for the drawer.
export interface SlackRoute {
  channel: string;
  channelName: string | null;
}

export interface SlackSettings {
  // The default channel: updates from a project with no channel of its own, and its name for the drawer.
  channel: string | null;
  channelName: string | null;
  // The default project a card started from Slack (`/weft …` or an @mention) runs in, from a channel no project has.
  folder: string | null;
  // Projects mapped to their own channels, one channel per project.
  links: SlackLink[];
  events: SlackEvents;
  // A channel per kind of update, overriding the default (and a project's own channel) for that kind.
  routes: Partial<Record<SlackEventKey, SlackRoute>>;
}

export const DEFAULT_SLACK_SETTINGS: SlackSettings = {
  channel: null,
  channelName: null,
  folder: null,
  links: [],
  events: Object.fromEntries(SLACK_KINDS.map((kind) => [kind, true])) as SlackEvents,
  routes: {},
};

// A patch from the drawer: any setting, with events switched one at a time.
export type SlackSettingsPatch = Partial<Omit<SlackSettings, "events" | "routes">> & {
  events?: Partial<SlackEvents>;
  routes?: Partial<Record<SlackEventKey, SlackRoute | null>>;
};

// Where a card's Slack thread is: the message its updates reply under.
export interface SlackThread {
  channel: string;
  ts: string;
}

// Main's side, as the drawer reads it (window.weft.slack.status()).
export interface SlackStatus {
  signedIn: boolean;
  // The workspace and the bot's name, from auth.test.
  team: string | null;
  teamUrl: string | null;
  bot: string | null;
  // The Socket Mode connection that hears `/weft` and @mentions.
  socket: "off" | "connecting" | "connected";
  // The saved tokens didn't work, or the socket can't connect.
  error: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  // The bot is in it. A public channel it isn't in is joined on the first post; a private one needs /invite.
  isMember: boolean;
}

// What main forwards to the server's /api/slack/inbound when Slack talks to Weft.
export interface SlackInbound {
  // `/weft <text>`, or an @mention of the bot.
  kind: "command" | "mention";
  text: string;
  channel: string;
  user: string;
  // The mention's own message, and the thread it was in (a mention inside a card's thread talks to that card).
  ts?: string;
  threadTs?: string;
}

// One message for chat.postMessage, posted by main with the bot token (control route POST /slack/post).
export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
  thread_ts?: string;
}

// The board window's bridge to main (electron/preload.cjs `slack`).
export interface SlackBridge {
  status: () => Promise<SlackStatus>;
  setTokens: (bot: string, app: string) => Promise<SlackStatus>;
  forgetToken: () => Promise<SlackStatus>;
  channels: () => Promise<SlackChannel[]>;
  // A new public channel, which the bot is in from the start.
  createChannel: (name: string) => Promise<SlackChannel>;
}
