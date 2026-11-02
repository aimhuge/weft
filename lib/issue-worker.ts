// GitHub issues into a worker project (docs/architecture/project-hosts.md, T5; github-issues.md): a project on a Weft
// Worker syncs its issues like one on this Mac, through this Mac's gh, and each new issue becomes a card on the worker.
// The repo is read from this Mac's checkout of the project (lib/worker-twin.ts), since gh runs here and a worker's
// path names nothing on this disk; the issues it has already made a card for are the same record a Mac project keeps,
// so a repo synced in both places makes each card once.
//
// Where the card lands is the project's choice, as on a Mac (lib/issue-landing.ts). Run works today: the card goes as
// a `run` command, started on the worker under its title and labels. Backlog and Needs you need a card made and left
// unstarted, which a worker refuses until its `card.create` verb lands (WP2, PR #45).
// TODO(WP2): once `card.create` is on main, send Backlog and Needs you as `card.create { start: false }` (with the
// column) through hostCommand, and drop WORKER_BACKLOG_LATER.
import path from "node:path";
import type { IssueWorkflow } from "./issue-landing";
import { landingRuns, validationMessage } from "./issue-landing";
import { knownIssues, rememberIssues } from "./issue-record";
import { issueWorkflow, listProjects, workerFolders } from "./settings";
import { normalizeTags } from "./tags";
import { parseWorkerProject } from "./worker-project";
import { twinsOf } from "./worker-twin";

export const WORKER_BACKLOG_LATER =
  "A worker project's issue cards can't wait in Backlog or Needs you yet: a worker starts every card it makes. Set this project's issues to Run to start each one on the worker.";

// An issue's title is anyone's words: it names the card, and a card's title is one line.
const MAX_ISSUE_TITLE = 200;

interface Issue {
  number: number;
  title: string;
  state: string;
  labels?: { name: string }[];
}

export interface WorkerIssueDeps<I extends Issue> {
  // This Mac's folders a twin may be: the board's projects and the folders that run on a worker.
  folders: () => string[];
  repoOf: (folder: string) => Promise<string>;
  fetchIssues: (repo: string, folder: string) => Promise<I[]>;
  issuePrompt: (repo: string, issue: I) => string;
  workflow: (project: string) => IssueWorkflow;
  // The issue numbers this repo already has a card for, and a record of new ones.
  known: (repo: string) => Set<number>;
  remember: (repo: string, numbers: number[]) => void;
  send: (run: { workerId: string; folder: string; prompt: string; title: string; tags: string[] }) => Promise<unknown>;
}

// A folder the issue routes take: a worker project's path as it is, or a folder on this Mac.
export function issueProject(raw: unknown, local: (raw: unknown) => string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return parseWorkerProject(text) ? text : local(raw);
}

// The repo a worker project is, read through its twin on this Mac. The twin is found by name, so when this Mac has
// several folders of that name they must all be the same repo: otherwise one repo's issues would start cards in
// another's checkout on the worker.
export async function workerIssueRepo(project: string, folders: string[], repoOf: (folder: string) => Promise<string>): Promise<{ repo: string; twin: string }> {
  const twins = twinsOf(project, folders);
  const name = parseWorkerProject(project)?.folder ?? path.basename(project);
  const [twin] = twins;
  if (!twin) throw new Error(`This Mac has no checkout of ${name}, so it can't tell which GitHub repo it is. Open that project on this Mac once.`);
  const found = (await Promise.all(twins.map((t) => repoOf(t).then((repo) => ({ repo, twin: t }), () => null)))).filter((f) => f !== null);
  const [first] = found;
  // None has a GitHub remote: the first one's own error says why.
  if (!first) return { repo: await repoOf(twin), twin };
  const other = found.find((f) => f.repo.toLowerCase() !== first.repo.toLowerCase());
  if (other) throw new Error(`This Mac has more than one ${name}: ${first.repo} and ${other.repo}, so it can't tell which repo the worker's ${name} is. Rename one, or remove the one that isn't it from the board.`);
  return first;
}

// Sends a card to the worker for each open issue it hasn't had one for, one at a time, recording each as it goes so a
// failure part way never sends the same issue twice. Closed issues and labels never reach a card already sent: it has
// started, and sync leaves a started card alone, as on a Mac.
export async function syncWorkerIssues<I extends Issue>(project: string, deps: WorkerIssueDeps<I>): Promise<{ repo: string; counts: { added: number; updated: number; archived: number } }> {
  const worker = parseWorkerProject(project);
  if (!worker) throw new Error(`${project} isn't a worker project.`);
  const workflow = deps.workflow(project);
  if (!landingRuns(workflow.landing)) throw new Error(WORKER_BACKLOG_LATER);
  const { repo, twin } = await workerIssueRepo(project, deps.folders(), deps.repoOf);
  const known = deps.known(repo);
  const fresh = new Map<number, I>();
  for (const issue of await deps.fetchIssues(repo, twin)) {
    if (issue.state.toLowerCase() === "open" && !known.has(issue.number) && !fresh.has(issue.number)) fresh.set(issue.number, issue);
  }
  let added = 0;
  for (const issue of fresh.values()) {
    const prompt = [deps.issuePrompt(repo, issue), validationMessage(workflow.skill)].filter(Boolean).join("\n\n");
    const tags = normalizeTags((issue.labels ?? []).map((l) => l.name));
    await deps.send({ workerId: worker.workerId, folder: worker.folder, prompt, title: issue.title.trim().slice(0, MAX_ISSUE_TITLE) || `${repo}#${issue.number}`, tags });
    deps.remember(repo, [issue.number]);
    added++;
  }
  return { repo, counts: { added, updated: 0, archived: 0 } };
}

// What a sync on this Mac uses, but gh's own calls, which lib/github-issues.ts passes in. The run goes out through the
// account (lib/workers-account.ts), loaded only when there's one to send.
export function workerIssueDeps(): Pick<WorkerIssueDeps<Issue>, "folders" | "workflow" | "known" | "remember" | "send"> {
  return {
    folders: () => [...listProjects().map((p) => p.path), ...workerFolders()],
    workflow: issueWorkflow,
    known: knownIssues,
    remember: rememberIssues,
    send: async (run) => (await import("./workers-account")).sendRun(run),
  };
}
