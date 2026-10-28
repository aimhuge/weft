import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// gh is a mocked execFile, the store an in-memory Map, settings and the tag catalog mocks; the
// imported-issues record is a real file in a temp folder.
//
// The project's workflow — where its cards land, and how a "run" card works — has its own file
// (lib/github-issues-workflow.test.ts).

type Callback = (err: unknown, out?: { stdout: string }) => void;

const h = vi.hoisted(() => {
  const landings: Record<string, { landing: string; skill?: string; agent?: string }> = {};
  return {
    dir: "",
    cards: new Map<string, Card>(),
    folders: [] as string[],
    landings,
  };
});
h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-issues-"));

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
  listCards: vi.fn(() => [...h.cards.values()]),
  addCards: vi.fn((cards: Card[]) => {
    for (const c of cards) h.cards.set(c.id, c);
  }),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => Object.assign(h.cards.get(id)!, patch)),
}));

vi.mock("./settings", () => ({
  defaultPermissionMode: vi.fn(() => "auto"),
  issueFolders: vi.fn(() => [...h.folders]),
  setIssueSync: vi.fn((folder: string, on: boolean) => {
    h.folders = h.folders.filter((f) => f !== folder);
    if (on) h.folders.push(folder);
  }),
  issueWorkflow: vi.fn((folder: string) => h.landings[folder] ?? { landing: "backlog" }),
}));

// The card's thread: the importer starts it when the project asked for its issues to be worked.
// Mocked here so the runner never loads; the workflow's own file checks what it starts with.
const started = vi.hoisted(() => [] as string[]);
vi.mock("./issue-run", () => ({
  startIssueCard: vi.fn((card: Card) => {
    started.push(card.id);
    return Promise.resolve();
  }),
}));

vi.mock("./tag-store", () => ({
  createTag: vi.fn((name: string) => {
    if (name === "bug") throw new Error("There's already a tag “bug”.");
    return { name };
  }),
}));

const store = await import("./store");
const tagStore = await import("./tag-store");
const gi = await import("./github-issues");

const FOLDER = h.dir;
const REPO = "acme/app";

interface Issue {
  number: number;
  title: string;
  body?: string;
  labels?: { name: string; color?: string; description?: string }[];
  url: string;
  state: string;
  updatedAt: string;
}

function issue(n: number, over: Partial<Issue> = {}): Issue {
  return { number: n, title: `Issue ${n}`, body: `Body ${n}`, labels: [], url: `https://github.com/${REPO}/issues/${n}`, state: "OPEN", updatedAt: "2026-01-01T00:00:00Z", ...over };
}

// gh answers: repo view, then open issues, then closed issues.
function ghReturns(open: Issue[], closed: Issue[] = [], repo: string | null = REPO) {
  execFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Callback) => {
    if (args[0] === "repo") {
      cb(null, { stdout: JSON.stringify(repo ? { nameWithOwner: repo } : {}) });
      return;
    }
    const state = args[args.indexOf("--state") + 1];
    cb(null, { stdout: JSON.stringify(state === "open" ? open : closed) });
  });
}

function ghFails(err: unknown) {
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => cb(err));
}

const cards = () => [...h.cards.values()];

beforeEach(() => {
  h.cards.clear();
  h.folders = [];
  h.landings = {};
  started.length = 0;
  execFile.mockReset();
  vi.clearAllMocks();
  fs.rmSync(path.join(h.dir, "github-issues.json"), { force: true });
});
afterEach(() => vi.useRealTimers());
afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

describe("syncIssues", () => {
  it("makes a Backlog card per open issue with its prompt, tags and issue, and never starts it", async () => {
    ghReturns([
      issue(1, { title: "Crash on save", labels: [{ name: "Bug", color: "d73a4a", description: "Broken" }, { name: "UI" }] }),
      issue(2, { body: "", title: "  " }),
    ]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 2, updated: 0, archived: 0 });
    const [one, two] = cards();
    expect(one).toMatchObject({
      column: "backlog",
      title: "Crash on save",
      titleBy: "user",
      cwd: FOLDER,
      backend: "claude",
      permissionMode: "auto",
      tags: ["bug", "ui"],
      tagsBy: "user",
      issue: { repo: REPO, number: 1, url: `https://github.com/${REPO}/issues/1`, state: "open", updatedAt: "2026-01-01T00:00:00Z" },
    });
    expect(one!.prompt).toBe(
      `Body 1\n\nGitHub issue ${REPO}#1: https://github.com/${REPO}/issues/1\n\nWhen you commit the fix, add "Fixes ${REPO}#1" to the commit message.`,
    );
    expect(two!.title).toBe(`${REPO}#2`);
    expect(two!.tags).toBeUndefined();
    expect(two!.prompt.startsWith("GitHub issue")).toBe(true);
    expect(store.addCards).toHaveBeenCalledOnce();
    expect(tagStore.createTag).toHaveBeenCalledWith("Bug", "d73a4a", "Broken");
    expect(tagStore.createTag).toHaveBeenCalledWith("UI", undefined, undefined);
  });

  it("calls gh without a shell: repo view in the folder, open issues, then recently updated closed ones", async () => {
    ghReturns([]);
    await gi.syncIssues(FOLDER);
    const calls = execFile.mock.calls.map((c): unknown[] => [c[0], c[1], (c[2] as { cwd: string }).cwd]);
    expect(calls[0]).toEqual(["gh", ["repo", "view", "--json", "nameWithOwner"], FOLDER]);
    expect(calls[1]![1]).toEqual(["issue", "list", "--repo", REPO, "--state", "open", "--limit", "500", "--json", "number,title,body,labels,url,state,updatedAt"]);
    expect(calls[2]![1]).toContain("sort:updated-desc");
  });

  it("doesn't bring back a card you deleted, or make one for a closed issue or a duplicate", async () => {
    ghReturns([issue(1), issue(1)], [issue(9, { state: "CLOSED" })]);
    expect((await gi.syncIssues(FOLDER)).added).toBe(1);
    h.cards.clear();
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 0, archived: 0 });
    // A new issue still comes in after that.
    ghReturns([issue(1), issue(3)]);
    expect((await gi.syncIssues(FOLDER)).added).toBe(1);
    expect(cards().map((c) => c.issue?.number)).toEqual([3]);
  });

  it("archives the unstarted card of a closed issue and leaves a started one alone", async () => {
    ghReturns([issue(1), issue(2), issue(3)]);
    await gi.syncIssues(FOLDER);
    const [a, b, c] = cards();
    Object.assign(b!, { column: "review" });
    Object.assign(c!, { sessionId: "s" });
    ghReturns([], [issue(1, { state: "CLOSED" }), issue(2, { state: "closed" }), issue(3, { state: "CLOSED" })]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 0, archived: 1 });
    expect(a).toMatchObject({ archived: true, issue: { state: "closed" } });
    expect(b!.archived).toBeUndefined();
    expect(c!.archived).toBeUndefined();
    // An archived card stays archived and untouched.
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 0, archived: 0 });
  });

  it("follows an issue's edits on a Backlog card: its state and new labels, but not tags you set yourself", async () => {
    ghReturns([issue(1, { labels: [{ name: "bug" }] }), issue(2, { labels: [{ name: "ui" }] }), issue(4)]);
    await gi.syncIssues(FOLDER);
    const [one, two, four] = cards();
    Object.assign(four!, { turns: 2 });
    // Unchanged issues: nothing to do.
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 0, archived: 0 });
    vi.mocked(tagStore.createTag).mockClear();
    ghReturns([
      issue(1, { updatedAt: "2026-02-01T00:00:00Z", labels: [{ name: "bug" }, { name: "docs", color: "0075ca" }] }),
      issue(2, { updatedAt: "2026-02-01T00:00:00Z", labels: [{ name: "ui" }] }),
      issue(4, { updatedAt: "2026-02-01T00:00:00Z", labels: [{ name: "x" }] }),
    ]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 2, archived: 0 });
    expect(one).toMatchObject({ tags: ["bug", "docs"], issue: { updatedAt: "2026-02-01T00:00:00Z" } });
    expect(two!.tags).toEqual(["ui"]);
    expect(four!.tags).toBeUndefined();
    expect(tagStore.createTag).toHaveBeenCalledWith("docs", "0075ca", undefined);
    // A reopened issue whose card wasn't archived: just its state.
    Object.assign(two!, { tags: ["mine"], issue: { ...two!.issue!, state: "closed" } });
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 1, archived: 0 });
    expect(two).toMatchObject({ tags: ["mine"], issue: { state: "open" } });
  });

  it("matches cards by repo ignoring case and leaves other repos' cards be", async () => {
    h.cards.set("other", { id: "other", column: "backlog", issue: { repo: "x/y", number: 1, url: "", state: "open", updatedAt: "" } } as Card);
    h.cards.set("mine", { id: "mine", column: "backlog", issue: { repo: "ACME/app", number: 1, url: "", state: "open", updatedAt: "old" } } as Card);
    ghReturns([issue(1)]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 1, archived: 0 });
    expect(h.cards.get("other")!.issue!.updatedAt).toBe("");
  });

  it("shares one run per folder between callers", async () => {
    ghReturns([issue(1)]);
    const [a, b] = await Promise.all([gi.syncIssues(FOLDER), gi.syncIssues(FOLDER)]);
    expect(a).toBe(b);
    expect(cards()).toHaveLength(1);
  });

  it("reads a broken imported record as empty", async () => {
    fs.writeFileSync(path.join(h.dir, "github-issues.json"), "{nope");
    ghReturns([issue(1)]);
    expect((await gi.syncIssues(FOLDER)).added).toBe(1);
    fs.writeFileSync(path.join(h.dir, "github-issues.json"), "{}");
    h.cards.clear();
    expect((await gi.syncIssues(FOLDER)).added).toBe(1);
  });
});

describe("errors", () => {
  it("says clearly when gh is missing, logged out, or the folder has no GitHub remote", async () => {
    ghFails(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));
    await expect(gi.syncIssues(FOLDER)).rejects.toThrow("The GitHub CLI isn't installed");
    ghFails(Object.assign(new Error("x"), { stderr: "To get started with GitHub CLI, please run:  gh auth login" }));
    await expect(gi.syncIssues(FOLDER)).rejects.toThrow("isn't logged in");
    ghFails(Object.assign(new Error("x"), { stderr: "no git remotes found" }));
    await expect(gi.syncIssues(FOLDER)).rejects.toThrow("has no GitHub remote");
    ghReturns([], [], null);
    await expect(gi.syncIssues(FOLDER)).rejects.toThrow("has no GitHub remote");
    ghFails(Object.assign(new Error("Command failed"), { stderr: "a\nb\nc\nHTTP 502" }));
    await expect(gi.syncIssues(FOLDER)).rejects.toThrow("b c HTTP 502");
    ghFails("plain");
    await expect(gi.syncIssues(FOLDER)).rejects.toThrow("plain");
    await expect(gi.syncIssues("/no/such/folder")).rejects.toThrow("isn't there anymore");
  });

  it("ghError falls back to the message", () => {
    expect(gi.ghError(new Error("Could not determine the repo"), "/x/app")).toBe("app has no GitHub remote, so it has no issues to import.");
  });
});

describe("opting in, status and the poll", () => {
  it("enables, lists and disables folders, and reports each one's last sync", async () => {
    gi.enableIssueSync(FOLDER);
    gi.enableIssueSync("/gone");
    expect(gi.issueSyncFolders()).toEqual([FOLDER, "/gone"]);
    ghReturns([issue(1)]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await gi.syncAllIssues();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/gone"));
    const status = gi.issueSyncStatus();
    expect(status[FOLDER]).toMatchObject({ repo: REPO, counts: { added: 1, updated: 0, archived: 0 } });
    expect(status["/gone"]!.error).toMatch("isn't there anymore");
    gi.disableIssueSync("/gone");
    expect(gi.issueSyncFolders()).toEqual([FOLDER]);
    expect(Object.keys(gi.issueSyncStatus())).toEqual([FOLDER]);
    gi.disableIssueSync(FOLDER);
    expect(gi.issueSyncStatus()).toEqual({});
    warn.mockRestore();
  });

  it("startIssueSync syncs shortly after start and then every 5 minutes, once per process", async () => {
    vi.useFakeTimers();
    h.folders = [FOLDER];
    ghReturns([]);
    gi.startIssueSync();
    gi.startIssueSync();
    expect(execFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(execFile).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(execFile).toHaveBeenCalledTimes(6);
  });
});
