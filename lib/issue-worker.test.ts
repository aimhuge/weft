import { beforeEach, describe, expect, it, vi } from "vitest";

// The sync's own logic with every dependency passed in; workerIssueDeps' defaults over mocked settings and records.
const settings = vi.hoisted(() => ({
  listProjects: vi.fn(() => [{ path: "/Users/me/dev/app" }]),
  workerFolders: vi.fn(() => ["/Users/me/dev/other"]),
  issueWorkflow: vi.fn(() => ({ landing: "run" })),
}));
vi.mock("./settings", () => settings);
const record = vi.hoisted(() => ({ knownIssues: vi.fn(() => new Set([1])), rememberIssues: vi.fn() }));
vi.mock("./issue-record", () => record);
const account = vi.hoisted(() => ({ sendRun: vi.fn(() => Promise.resolve({ commandId: "cmd" })) }));
vi.mock("./workers-account", () => account);

const { issueProject, syncWorkerIssues, workerIssueDeps, workerIssueRepo, WORKER_BACKLOG_LATER } = await import("./issue-worker");

const PROJECT = "worker://w1/app";
type Issue = { number: number; title: string; state: string; labels?: { name: string }[] };
const issue = (number: number, over: Partial<Issue> = {}): Issue => ({ number, title: `Issue ${number}`, state: "OPEN", ...over });

function deps(issues: Issue[], over: Partial<Parameters<typeof syncWorkerIssues<Issue>>[1]> = {}) {
  const known = new Set<number>([1]);
  const base = {
    folders: () => ["/Users/me/dev/app"],
    repoOf: vi.fn(() => Promise.resolve("acme/app")),
    fetchIssues: vi.fn(() => Promise.resolve(issues)),
    issuePrompt: (repo: string, i: Issue) => `${repo}#${i.number}`,
    workflow: () => ({ landing: "run" as const }),
    known: () => known,
    remember: vi.fn((_repo: string, numbers: number[]) => numbers.forEach((n) => known.add(n))),
    send: vi.fn<(run: unknown) => Promise<unknown>>(() => Promise.resolve()),
  };
  return { ...base, ...over, remember: base.remember, send: base.send };
}

beforeEach(() => vi.clearAllMocks());

describe("syncWorkerIssues", () => {
  it("sends each new open issue to the worker as a started card, once, under its title and labels", async () => {
    const d = deps([issue(1), issue(2, { labels: [{ name: "Bug" }] }), issue(2), issue(3, { state: "closed" }), issue(4, { title: "  " })]);
    expect(await syncWorkerIssues(PROJECT, d)).toEqual({ repo: "acme/app", counts: { added: 2, updated: 0, archived: 0 } });
    expect(d.fetchIssues).toHaveBeenCalledWith("acme/app", "/Users/me/dev/app");
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(d.send).toHaveBeenNthCalledWith(1, { workerId: "w1", folder: "app", prompt: "acme/app#2", title: "Issue 2", tags: ["bug"] });
    expect(d.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: "acme/app#4", tags: [] }));
    expect(d.remember.mock.calls).toEqual([["acme/app", [2]], ["acme/app", [4]]]);
  });

  it("puts the project's validation skill first in the prompt", async () => {
    const d = deps([issue(2)], { workflow: () => ({ landing: "run" as const, skill: "triage" }) });
    await syncWorkerIssues(PROJECT, d);
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ prompt: "acme/app#2\n\nStart by using the triage skill." }));
  });

  it("keeps what went before a failure, so the next sync doesn't send it again", async () => {
    const d = deps([issue(2), issue(3)]);
    d.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"));
    await expect(syncWorkerIssues(PROJECT, d)).rejects.toThrow("offline");
    expect(d.remember.mock.calls).toEqual([["acme/app", [2]]]);
  });

  it("refuses a landing a worker can't take yet, a project that isn't a worker's, and one with no checkout here", async () => {
    await expect(syncWorkerIssues(PROJECT, deps([], { workflow: () => ({ landing: "backlog" as const }) }))).rejects.toThrow(WORKER_BACKLOG_LATER);
    await expect(syncWorkerIssues("/Users/me/dev/app", deps([]))).rejects.toThrow("isn't a worker project");
    await expect(syncWorkerIssues(PROJECT, deps([], { folders: () => ["/Users/me/dev/ling"] }))).rejects.toThrow("no checkout of app");
  });
});

describe("workerIssueRepo", () => {
  it("reads the repo in the twin, and names the project when there's none", async () => {
    expect(await workerIssueRepo(PROJECT, ["/x/app"], () => Promise.resolve("acme/app"))).toEqual({ repo: "acme/app", twin: "/x/app" });
    await expect(workerIssueRepo("/not/a/worker", [], () => Promise.resolve(""))).rejects.toThrow("no checkout of worker");
  });
});

describe("issueProject", () => {
  it("takes a worker path as it is, and anything else through the local check", () => {
    const local = vi.fn(() => "/resolved");
    expect(issueProject(` ${PROJECT} `, local)).toBe(PROJECT);
    expect(local).not.toHaveBeenCalled();
    expect(issueProject("~/dev/app", local)).toBe("/resolved");
    expect(issueProject(7, local)).toBe("/resolved");
  });
});

describe("workerIssueDeps", () => {
  it("reads this Mac's folders, the project's workflow and the record, and sends a run", async () => {
    const d = workerIssueDeps();
    expect(d.folders()).toEqual(["/Users/me/dev/app", "/Users/me/dev/other"]);
    expect(d.workflow(PROJECT)).toEqual({ landing: "run" });
    expect(d.known("acme/app")).toEqual(new Set([1]));
    d.remember("acme/app", [2]);
    expect(record.rememberIssues).toHaveBeenCalledWith("acme/app", [2]);
    const run = { workerId: "w1", folder: "app", prompt: "p", title: "t", tags: [] };
    await d.send(run);
    expect(account.sendRun).toHaveBeenCalledWith(run);
  });
});
