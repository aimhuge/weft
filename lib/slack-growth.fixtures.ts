// Fixtures shared by lib/slack-growth*.test.ts files: the headline numbers and the Slack settings with a growth
// channel, the way the drawer leaves them.

import type { GrowthOverview } from "./growth-read";
import type { SlackSettings } from "./slack-types";

export const OVERVIEW: GrowthOverview = {
  accounts: 12,
  new_7d: 3,
  new_30d: 9,
  signed_in_7d: 5,
  signed_in_30d: 8,
  never_signed_in: 2,
  workspaces: 6,
  invites_pending: 1,
  syncing_accounts: 4,
  synced_cards: 21,
  paying_workspaces: 2,
};

export const growthSettings = (): SlackSettings => ({
  channel: "C1",
  channelName: "general",
  folder: null,
  links: [],
  events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
  routes: { growth: { channel: "C9", channelName: "growth" } },
});
