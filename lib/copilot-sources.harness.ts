// Shared mocks and helpers for the copilot-sources tests (lib/copilot-sources*.test.ts). Each test file
// sets up its own vi.mock factories; this file just exports the data and the helpers they read.
// vitest hoists vi.mock per file, so callers wrap the imports below in vi.mock("./module", async () => …).
import { vi } from "vitest";
import type { ActivityEvent } from "./game";
import type { Finding } from "./scout-view";
import type { QualityReport, Section as QualitySection } from "./quality-view";
import type { Card, ThreadItem } from "./types";

// The board's data dir and the copilot thread's items. Tests reset them in afterEach.
export const copilotThread: ThreadItem[] = [];
export const activityEvents: ActivityEvent[] = [];

// gh CLI responses and the calls it gets. Each test seeds `gh.responses` (an "err" or "out" per subcommand)
// and inspects `gh.calls` afterwards.
export const gh = {
  responses: new Map<string, { out?: string; err?: Error }>(),
  calls: [] as { args: string[]; cwd: string }[],
};

// Mock module factories, named so each test file can do `vi.mock("./module", () => browserToolsMock(shell))`.
// The shell mock is shared with the test file so its `shell.mockResolvedValueOnce(...)` lines reach the
// module the source code calls.
export const storeMock = (dataDir: string) => ({ DATA_DIR: dataDir, listCards: (): Card[] => [], getThread: (id: string): ThreadItem[] => (id === "copilot" ? copilotThread : []) });
export const activityMock = () => ({ readActivity: (): ActivityEvent[] => activityEvents, withoutHandedOff: (events: ActivityEvent[]) => events });
export const browserToolsMock = (shellMock: ReturnType<typeof vi.fn>) => ({ shell: shellMock });
export const commitPileMock = (repoRootMock: ReturnType<typeof vi.fn>, readPileMock: ReturnType<typeof vi.fn>) => ({ readPile: readPileMock, repoRoot: repoRootMock });
export const qualityMock = (measureQualityMock: ReturnType<typeof vi.fn>) => ({ measureQuality: measureQualityMock });
export const scoutMock = (readScoutMock: ReturnType<typeof vi.fn>) => ({ readScout: readScoutMock });
export const sprintPlanMock = (mapBacklogMock: ReturnType<typeof vi.fn>) => ({ mapBacklog: mapBacklogMock });
export const webhooksMock = (listWebhooksMock: ReturnType<typeof vi.fn>) => ({ listWebhooks: listWebhooksMock });

// The mocked node:child_process.execFile: tests fill `gh.responses` and read `gh.calls`.
export const execFileMock = () => (
  _cmd: string,
  args: string[],
  opts: { cwd?: string },
  cb: (err: Error | null, out: string) => void,
) => {
  gh.calls.push({ args, cwd: opts.cwd ?? "" });
  const key = args[0] ?? "";
  const r = gh.responses.get(key) ?? {};
  setImmediate(() => cb(r.err ?? null, r.out ?? ""));
};

// A Card with the fields the sources read, so each test only sets what matters.
export const makeCard = (over: Partial<Card> & { id: string }): Card => ({
  title: `Card ${over.id}`,
  prompt: "",
  cwd: "/repo",
  backend: "claude",
  permissionMode: "default",
  column: "running",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

// A QualityReport with the shape the sources read; tests pass `sections` per case.
export const makeReport = (over: Partial<QualityReport> = {}): QualityReport => ({
  root: "/repo",
  score: 50,
  sections: [],
  coverageAt: null,
  ...over,
});

// A Section: a name and score are enough for weakest() and the line printer.
export const makeSection = (over: Partial<QualitySection> & { name: string; score: number | null }): QualitySection => ({
  key: "tests",
  summary: "",
  checks: [],
  ...over,
});

// A Finding: defaults to the fields the scout source reads; tests only override what changes.
export const makeFinding = (over: Partial<Finding> & { id: string; file: string; smell: string }): Finding => ({
  line: 1,
  category: "refactor",
  severity: "medium",
  fix: "Fix the thing",
  ...over,
});
