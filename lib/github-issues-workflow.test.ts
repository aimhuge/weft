import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// The project's workflow (lib/issue-landing.ts): where its issue cards land, and how a "run" card
// works — the skill that validates it first, and the agent that does the work.
//
// gh is a mocked execFile and the store an in-memory Map, so the cards are the importer's own.

type Callback = (err: unknown, out?: { stdout: string }) => void;

interface Workflow {
  landing: string;
  skill?: string;
  agent?: string;
}

const h = vi.hoisted(() => {
  const landings: Record<string, Workflow> = {};
  return {
    dir: "",
    cards: new Map<string, Card>(),
    folders: [] as string[],
    landings,
  };
});
h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-issues-workflow-"));

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
  setIssueSync: vi.fn(),
  issueWorkflow: vi.fn((folder: string) => h.landings[folder] ?? { landing: "backlog" }),
}));

// The card's thread: the importer starts it when the project asked for its issues to be worked.
const started = vi.hoisted(() => [] as string[]);
vi.mock("./issue-run", () => ({
  startIssueCard: vi.fn((card: Card) => {
    started.push(card.id);
    return Promise.resolve();
  }),
}));

vi.mock("./tag-store", () => ({ createTag: vi.fn() }));

const issueRun = await import("./issue-run");
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
function ghReturns(open: Issue[], closed: Issue[] = []) {
  execFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Callback) => {
    if (args[0] === "repo") {
      cb(null, { stdout: JSON.stringify({ nameWithOwner: REPO }) });
      return;
    }
    const state = args[args.indexOf("--state") + 1];
    cb(null, { stdout: JSON.stringify(state === "open" ? open : closed) });
  });
}

const cards = () => [...h.cards.values()];

beforeEach(() => {
  h.cards.clear();
  h.landings = {};
  started.length = 0;
  execFile.mockReset();
  vi.clearAllMocks();
  fs.rmSync(path.join(h.dir, "github-issues.json"), { force: true });
});
afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

describe("the project's workflow", () => {
  it("lands a card in Backlog by default, and never starts it", async () => {
    ghReturns([issue(1)]);
    await gi.syncIssues(FOLDER);
    expect(cards()[0]).toMatchObject({ column: "backlog" });
    expect(cards()[0]!.agent).toBeUndefined();
    expect(started).toEqual([]);
  });

  it("lands a card in Needs you when the project asked for that, and still never starts it", async () => {
    h.landings[FOLDER] = { landing: "needs_you" };
    ghReturns([issue(1)]);
    await gi.syncIssues(FOLDER);
    expect(cards()[0]).toMatchObject({ column: "needs_you" });
    expect(started).toEqual([]);
  });

  it("starts the card's thread when the project asked for its issues to be run", async () => {
    h.landings[FOLDER] = { landing: "run" };
    ghReturns([issue(1), issue(2)]);
    await gi.syncIssues(FOLDER);
    await vi.waitFor(() => expect(started).toHaveLength(2));
    // A run card waits in Backlog until the runner takes it to Running.
    expect(cards()[0]).toMatchObject({ column: "backlog" });
  });

  it("gives the card the project's agent", async () => {
    h.landings[FOLDER] = { landing: "run", agent: "triage" };
    ghReturns([issue(1)]);
    await gi.syncIssues(FOLDER);
    expect(cards()[0]).toMatchObject({ agent: "triage" });
  });

  it("starts the card with the validation skill the project named", async () => {
    h.landings[FOLDER] = { landing: "run", skill: "weft:plan" };
    ghReturns([issue(1)]);
    await gi.syncIssues(FOLDER);
    await vi.waitFor(() => expect(started).toHaveLength(1));
    // The skill goes into the card's first turn, before any work.
    expect(vi.mocked(issueRun.startIssueCard)).toHaveBeenCalledWith(expect.objectContaining({ id: started[0] }), "weft:plan");
  });

  it("starts a card with no skill, and the agent is on the card itself", async () => {
    h.landings[FOLDER] = { landing: "run", agent: "triage" };
    ghReturns([issue(1)]);
    await gi.syncIssues(FOLDER);
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(vi.mocked(issueRun.startIssueCard)).toHaveBeenCalledWith(expect.objectContaining({ agent: "triage" }), undefined);
  });

  it("keeps a card parked in Needs you following its issue, until it has run", async () => {
    h.landings[FOLDER] = { landing: "needs_you" };
    ghReturns([issue(1, { labels: [{ name: "bug" }] })]);
    await gi.syncIssues(FOLDER);
    const card = cards()[0]!;
    // A new label on the issue reaches the parked card.
    ghReturns([issue(1, { updatedAt: "2026-02-01T00:00:00Z", labels: [{ name: "bug" }, { name: "docs" }] })]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 1, archived: 0 });
    expect(card).toMatchObject({ column: "needs_you", tags: ["bug", "docs"] });
    // And closing the issue archives it.
    ghReturns([], [issue(1, { state: "CLOSED" })]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 0, archived: 1 });
    expect(card).toMatchObject({ archived: true });
  });

  it("leaves a Needs you card alone once it has run", async () => {
    h.landings[FOLDER] = { landing: "needs_you" };
    ghReturns([issue(1)]);
    await gi.syncIssues(FOLDER);
    const card = cards()[0]!;
    Object.assign(card, { sessionId: "s" });
    ghReturns([], [issue(1, { state: "CLOSED" })]);
    expect(await gi.syncIssues(FOLDER)).toEqual({ added: 0, updated: 0, archived: 0 });
    expect(card.archived).toBeUndefined();
  });
});
