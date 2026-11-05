import { folderName, timeAgo } from "./format";
import { workflowOf, type IssueLanding, type IssueWorkflow } from "./issue-landing";

// What the GitHub drawer shows (components/GithubDrawer.tsx), from GET /api/github (lib/github-status.ts): the
// gh CLI's account and, per board project, its GitHub repo and whether its issues sync into cards
// (lib/github-issues.ts). gh keeps its own token; Weft never sees it. Pure, so it's testable and safe in the browser.

export type { IssueLanding, IssueWorkflow };

export interface GithubAccount {
  login: string;
  url: string;
}

export interface GithubSyncCounts {
  added: number;
  updated: number;
  archived: number;
}

// How a folder's last issue sync went (lib/github-issues.ts SyncStatus).
export interface GithubSyncResult {
  at: number;
  repo?: string;
  error?: string;
  counts?: GithubSyncCounts;
}

export interface GithubFolder {
  folder: string;
  // owner/name, or null when the folder has no GitHub remote (error says why).
  repo: string | null;
  error: string | null;
  // Its open issues become cards, every 5 minutes.
  syncing: boolean;
  last: GithubSyncResult | null;
  // A webhook on the repo relays its issue events within seconds (lib/github-hooks.ts).
  instant: boolean;
  // Where its cards land and how a "run" card works (lib/issue-landing.ts).
  workflow: IssueWorkflow;
}

export interface GithubStatus {
  // Who gh is signed in as; null with error when it isn't installed or signed in.
  account: GithubAccount | null;
  error: string | null;
  // Signed in to a Weft account, which instant updates come through; instantError when it couldn't be asked.
  weft: boolean;
  instantError: string | null;
  folders: GithubFolder[];
}

export const LOGIN_COMMAND = "gh auth login --web";
export const INSTALL_URL = "https://cli.github.com";

export const repoUrl = (repo: string) => `https://github.com/${repo}`;
export const issuesUrl = (repo: string) => `${repoUrl(repo)}/issues`;

export function shownGithubFolders(folders: GithubFolder[], project: string | null) {
  return project ? folders.filter((f) => f.folder === project) : folders;
}

// The line under a synced folder: when it last synced and what that did, or what went wrong.
export function syncLine(f: Pick<GithubFolder, "syncing" | "last" | "instant">, now = Date.now()): { text: string; bad: boolean } | null {
  if (!f.syncing) return null;
  const last = f.last;
  if (!last) return { text: f.instant ? "Syncing as issues change" : "Syncing every 5 minutes", bad: false };
  if (last.error) return { text: last.error, bad: true };
  return { text: `Synced ${timeAgo(last.at, now)} · ${countsText(last.counts) ?? "no changes"}`, bad: false };
}

// The workflow a folder reads as, when the drawer draws one it wasn't told (an older server, a
// folder that never chose): the default landing, no skill and no agent.
export function workflowOfFolder(f: Pick<GithubFolder, "workflow">): IssueWorkflow {
  return workflowOf(f.workflow);
}

// "2 added, 1 archived", or null when a sync changed nothing.
function countsText(c: GithubSyncCounts | undefined) {
  const parts = c ? [c.added && `${c.added} added`, c.updated && `${c.updated} updated`, c.archived && `${c.archived} archived`].filter(Boolean) : [];
  return parts.length ? parts.join(", ") : null;
}

// What a sync just did, for the toast.
export function syncToast(folder: string, c: GithubSyncCounts) {
  return `GitHub issues for ${folderName(folder)}: ${countsText(c) ?? "nothing new"}`;
}

// The rail icon's hover text.
export function githubTitle(status: GithubStatus | null, project: string | null) {
  if (!status) return "GitHub: account and issue sync";
  if (!status.account) return "GitHub: sign in with the gh CLI";
  const syncing = shownGithubFolders(status.folders, project).filter((f) => f.syncing);
  const who = `GitHub: @${status.account.login}`;
  return syncing.length ? `${who} · issues sync for ${syncing.map((f) => folderName(f.folder)).join(", ")}` : `${who} · no issue sync yet`;
}
