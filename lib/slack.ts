import { globalSingleton } from "./global-singleton";
import { watchCardStatus } from "./slack-cards";
import { createDeployWatch } from "./slack-deploys";
import { createGitWatch } from "./slack-git";
import { commitsMessage, pushMessage, type SlackText } from "./slack-messages";
import { sendToSlack } from "./slack-post";
import { channelFor, hasChannel } from "./slack-route";
import { slackSettings } from "./slack-store";
import type { SlackEvents } from "./slack-types";
import { listCards } from "./store";
import { COPILOT_ID } from "./types";

// Weft in Slack, the server's half (docs/architecture/slack.md): started once from prewarm(), it watches the board's
// repos for commits and pushes, Vercel for deploys and the board for cards changing column, and posts each to the
// drawer's channel. Main holds the tokens and the connection (electron/slack.cjs); nothing here runs while no
// channel is picked, apart from the card watcher, which only posts to threads that already exist.

export const GIT_MS = 5_000;
export const DEPLOY_MS = 60_000;

const state = globalSingleton("__weftSlack", () => ({ started: false, stops: [] as (() => void)[] }));

// Every project folder on the board, plus the ones Slack cards start in.
export function boardFolders(): string[] {
  const folders = new Set(listCards().flatMap((c) => (c.id === COPILOT_ID ? [] : [c.cwd])));
  const { folder, links } = slackSettings();
  if (folder) folders.add(folder);
  for (const link of links) folders.add(link.folder);
  return [...folders];
}

// Posts to the project's channel (its own, else the default) when there is one and that kind of update is switched on.
function poster(kind: keyof SlackEvents) {
  return (message: SlackText, cwd: string) => {
    const settings = slackSettings();
    const channel = channelFor(settings, cwd);
    if (channel && settings.events[kind]) sendToSlack(channel, message);
  };
}

// Vercel is asked only when deploys would be posted: a look is a few API calls per project.
const wantsDeploys = () => {
  const settings = slackSettings();
  return hasChannel(settings) && settings.events.deploys;
};

const warn = (err: unknown) => console.warn(`[weft] slack: ${err instanceof Error ? err.message : String(err)}`);

export function startSlack() {
  if (state.started) return;
  state.started = true;
  const commits = poster("commits");
  const pushes = poster("pushes");
  const git = createGitWatch({
    onCommits: (cwd, branch, list) => commits(commitsMessage(cwd, branch, list), cwd),
    onPush: (cwd, ref, count) => pushes(pushMessage(cwd, ref, count), cwd),
  });
  const deploys = createDeployWatch(poster("deploys"));
  // The git watcher looks even with Slack off (a stat per repo): turning it on later then posts what comes next,
  // not everything committed while it was off.
  let gitBusy = false;
  const lookGit = () => {
    if (gitBusy) return;
    gitBusy = true;
    git
      .tick(boardFolders())
      .catch(warn)
      .finally(() => (gitBusy = false));
  };
  const gitTimer = setInterval(lookGit, GIT_MS);
  const deployTimer = setInterval(() => {
    if (wantsDeploys()) deploys.tick(boardFolders()).catch(warn);
  }, DEPLOY_MS);
  gitTimer.unref();
  deployTimer.unref();
  lookGit();
  state.stops.push(watchCardStatus(), () => clearInterval(gitTimer), () => clearInterval(deployTimer));
}

export function stopSlack() {
  for (const stop of state.stops.splice(0)) stop();
  state.started = false;
}
