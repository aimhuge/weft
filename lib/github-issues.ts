import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { globalSingleton } from "./global-singleton";
import { defaultPermissionMode, issueFolders, setIssueSync } from "./settings";
import { addCards, DATA_DIR, listCards, updateCard } from "./store";
import { createTag } from "./tag-store";
import { normalizeTags } from "./tags";
import type { Card, CardIssue } from "./types";

// GitHub issues feed the board: a project folder's open issues become Backlog cards, through the gh
// CLI. One direction only; Weft never edits an issue. A card that has started is the user's: sync
// leaves it alone. The folders that sync are in settings (lib/settings.ts issueFolders).

const run = promisify(execFile);

// How often the server re-reads each synced folder's issues, and how long after start it first does.
const POLL_MS = 5 * 60_000;
const FIRST_POLL_MS = 20_000;
const OPEN_LIMIT = 500;
// Closed issues are read most recently updated first, to archive the cards of ones closed lately.
const CLOSED_LIMIT = 100;
const FIELDS = "number,title,body,labels,url,state,updatedAt";

export interface IssueLabel {
  name: string;
  color?: string;
  description?: string;
}

export interface GhIssue {
  number: number;
  title: string;
  body?: string;
  labels?: IssueLabel[];
  url: string;
  state: string;
  updatedAt: string;
}

export interface SyncCounts {
  added: number;
  updated: number;
  archived: number;
}

export interface SyncStatus {
  at: number;
  repo?: string;
  error?: string;
  counts?: SyncCounts;
}

const g = globalSingleton("__weftIssueSync", () => ({
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  inflight: new Map<string, Promise<SyncCounts>>(),
  status: new Map<string, SyncStatus>(),
}));

// The issues each repo has had a card made for, so a card you deleted doesn't come back.
const IMPORTED_FILE = path.join(DATA_DIR, "github-issues.json");

function imported(): Record<string, number[]> {
  try {
    return (JSON.parse(fs.readFileSync(IMPORTED_FILE, "utf8")) as { imported?: Record<string, number[]> }).imported ?? {};
  } catch {
    return {};
  }
}

function saveImported(map: Record<string, number[]>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(IMPORTED_FILE, JSON.stringify({ imported: map }, null, 2));
}

// What went wrong with gh, in words the user can act on.
export function ghError(err: unknown, folder: string): string {
  const e = err as { stderr?: string; message?: string; code?: string };
  if (e.code === "ENOENT") return "The GitHub CLI isn't installed. brew install gh, then gh auth login.";
  const text = (e.stderr || e.message || String(err)).trim();
  if (/auth login|not logged|authentication/i.test(text)) return "The GitHub CLI isn't logged in. Run gh auth login.";
  if (/no git remote|none of the git remotes|not a git repository|could not determine/i.test(text)) {
    return `${path.basename(folder)} has no GitHub remote, so it has no issues to import.`;
  }
  return text.split("\n").slice(-3).join(" ");
}

async function gh(args: string[], folder: string): Promise<string> {
  try {
    const { stdout } = await run("gh", args, { cwd: folder, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    throw new Error(ghError(err, folder));
  }
}

// "owner/name" for the folder's GitHub repo.
export async function repoOf(folder: string): Promise<string> {
  const { nameWithOwner } = JSON.parse(await gh(["repo", "view", "--json", "nameWithOwner"], folder)) as { nameWithOwner?: string };
  if (!nameWithOwner) throw new Error(`${path.basename(folder)} has no GitHub remote, so it has no issues to import.`);
  return nameWithOwner;
}

// The repo's open issues and its recently updated closed ones.
export async function fetchIssues(repo: string, folder: string): Promise<GhIssue[]> {
  const list = async (state: string, limit: number, extra: string[] = []) =>
    JSON.parse(await gh(["issue", "list", "--repo", repo, "--state", state, "--limit", String(limit), "--json", FIELDS, ...extra], folder)) as GhIssue[];
  const open = await list("open", OPEN_LIMIT);
  const closed = await list("closed", CLOSED_LIMIT, ["--search", "sort:updated-desc"]);
  return [...open, ...closed];
}

function issueMeta(repo: string, issue: GhIssue): CardIssue {
  return {
    repo,
    number: issue.number,
    url: issue.url,
    state: issue.state.toLowerCase() === "closed" ? "closed" : "open",
    updatedAt: issue.updatedAt,
  };
}

function labelTags(issue: GhIssue) {
  return normalizeTags((issue.labels ?? []).map((l) => l.name));
}

// Labels that become card tags join the tag catalog with their GitHub colour and description,
// unless the catalog already has them (createTag refuses those, and a colour it can't read).
function catalogLabels(issue: GhIssue) {
  for (const label of issue.labels ?? []) {
    try {
      createTag(label.name, label.color, label.description);
    } catch {
      // Already in the catalog, or not a usable tag.
    }
  }
}

export function issuePrompt(repo: string, issue: GhIssue) {
  const ref = `${repo}#${issue.number}`;
  return [
    issue.body?.trim(),
    `GitHub issue ${ref}: ${issue.url}`,
    `When you commit the fix, add "Fixes ${ref}" to the commit message.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function newCard(folder: string, repo: string, issue: GhIssue, now: number): Card {
  const tags = labelTags(issue);
  catalogLabels(issue);
  return {
    id: randomUUID(),
    column: "backlog",
    title: issue.title.trim() || `${repo}#${issue.number}`,
    titleBy: "user",
    prompt: issuePrompt(repo, issue),
    cwd: folder,
    backend: "claude",
    permissionMode: defaultPermissionMode(),
    ...(tags.length ? { tags, tagsBy: "user" as const } : {}),
    issue: issueMeta(repo, issue),
    createdAt: now,
    updatedAt: now,
  };
}

// A card the user (or an automation) has run: sync never touches it.
function started(card: Card) {
  return card.column !== "backlog" || Boolean(card.sessionId) || (card.turns ?? 0) > 0;
}

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

// What sync changes on an issue's existing card, or null to leave it.
function cardPatch(card: Card & { issue: CardIssue }, meta: CardIssue, issue: GhIssue): Partial<Card> | null {
  if (started(card) || card.archived) return null;
  if (meta.state === "closed") return { issue: meta, archived: true };
  if (meta.updatedAt === card.issue.updatedAt && meta.state === card.issue.state) return null;
  const patch: Partial<Card> = { issue: meta };
  const tags = labelTags(issue);
  // Only when the issue itself changed since Weft last read it, so tags you edited on the card stay.
  if (meta.updatedAt !== card.issue.updatedAt && !sameTags(tags, card.tags ?? [])) {
    Object.assign(patch, { tags, tagsBy: "user" });
    catalogLabels(issue);
  }
  return patch;
}

// Makes or updates the cards for these issues (also how lib/project-seed-run.ts parks a few on a new project).
export function applyIssues(folder: string, repo: string, issues: GhIssue[]): SyncCounts {
  const counts: SyncCounts = { added: 0, updated: 0, archived: 0 };
  const key = repo.toLowerCase();
  const byNumber = new Map<number, Card & { issue: CardIssue }>();
  for (const card of listCards()) {
    if (card.issue && card.issue.repo.toLowerCase() === key) byNumber.set(card.issue.number, card as Card & { issue: CardIssue });
  }
  const record = imported();
  const known = new Set(record[key] ?? []);
  const fresh: Card[] = [];
  const now = Date.now();
  const seen = new Set<number>();
  for (const issue of issues) {
    if (seen.has(issue.number)) continue;
    seen.add(issue.number);
    const meta = issueMeta(repo, issue);
    const card = byNumber.get(issue.number);
    if (card) {
      const patch = cardPatch(card, meta, issue);
      if (!patch) continue;
      updateCard(card.id, patch);
      if (patch.archived) counts.archived++;
      else counts.updated++;
    } else if (meta.state === "open" && !known.has(issue.number)) {
      fresh.push(newCard(folder, repo, issue, now));
    }
  }
  if (fresh.length) {
    addCards(fresh);
    counts.added = fresh.length;
    record[key] = [...known, ...fresh.flatMap((c) => (c.issue ? [c.issue.number] : []))];
    saveImported(record);
  }
  return counts;
}

async function runSync(folder: string): Promise<SyncCounts> {
  let repo: string | undefined;
  try {
    if (!fs.existsSync(folder)) throw new Error(`${folder} isn't there anymore.`);
    repo = await repoOf(folder);
    const counts = applyIssues(folder, repo, await fetchIssues(repo, folder));
    g.status.set(folder, { at: Date.now(), repo, counts });
    return counts;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    g.status.set(folder, { at: Date.now(), repo, error });
    throw new Error(error);
  }
}

// Reads the folder's GitHub issues into cards now. One sync per folder at a time; a second call
// while one runs gets the same result.
export function syncIssues(folder: string): Promise<SyncCounts> {
  const running = g.inflight.get(folder);
  if (running) return running;
  const job = runSync(folder).finally(() => g.inflight.delete(folder));
  g.inflight.set(folder, job);
  return job;
}

export function issueSyncFolders() {
  return issueFolders();
}

export function enableIssueSync(folder: string) {
  setIssueSync(folder, true);
}

export function disableIssueSync(folder: string) {
  setIssueSync(folder, false);
  g.status.delete(folder);
}

// How each synced folder's last sync went.
export function issueSyncStatus(): Record<string, SyncStatus> {
  return Object.fromEntries(
    issueFolders().flatMap((f) => {
      const status = g.status.get(f);
      return status ? [[f, status] as const] : [];
    }),
  );
}

// Syncs every opted-in folder in turn. A failure is logged and kept for GET; it never throws.
export async function syncAllIssues() {
  for (const folder of issueFolders()) {
    try {
      await syncIssues(folder);
    } catch (err) {
      console.warn(`GitHub issues for ${folder}: ${(err as Error).message}`);
    }
  }
}

// Once per server process: a first sync shortly after start, then every 5 minutes, off the request path.
export function startIssueSync() {
  if (g.timer) return;
  g.timer = setInterval(() => void syncAllIssues(), POLL_MS);
  g.timer.unref();
  setTimeout(() => void syncAllIssues(), FIRST_POLL_MS).unref();
}
