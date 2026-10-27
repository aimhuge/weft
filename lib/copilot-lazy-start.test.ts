// The lazy starts in prewarm() (lib/copilot.ts) that can't be reached from lib/copilot.test.ts: a module
// that fails to load at all. Each of the three is imported with a dynamic import and a failure handler, so
// a module that won't load must log a line and leave the server running.
//
// The module mocks here fail on purpose: their factories throw, so the import itself rejects.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COPILOT_ID, type Card } from "./types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), projects: [] as Array<{ path: string }> }));

vi.mock("./store", () => ({
  getCard: vi.fn((id: string) => db.cards.get(id)),
  listCards: vi.fn(() => [...db.cards.values()]),
  createCard: vi.fn((input: Partial<Card>, id: string) => {
    const card = { ...input, id, column: "backlog", createdAt: 1, updatedAt: 1 } as Card;
    db.cards.set(id, card);
    return card;
  }),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => Object.assign(db.cards.get(id)!, patch)),
  clearThread: vi.fn(),
}));
vi.mock("./runner", () => ({ sendUserMessage: vi.fn(), endSession: vi.fn(async () => {}), warmUp: vi.fn(), ensureSpare: vi.fn(), retryPukuWithTrial: vi.fn(async () => {}) }));
vi.mock("./puku-trial", () => ({ startPukuTrial: vi.fn() }));
vi.mock("./import", () => ({ startSessionSync: vi.fn() }));
vi.mock("./search", () => ({ startSearchIndex: vi.fn() }));
vi.mock("./scheduler", () => ({ startScheduler: vi.fn() }));
vi.mock("./copilot-initiative-run", () => ({ startCheckIns: vi.fn() }));
vi.mock("./runner-state", () => ({ isBusy: vi.fn(() => false) }));
vi.mock("./copilot-suggest", () => ({ startSuggestRefresh: vi.fn(), chipCardId: vi.fn() }));
vi.mock("./resume", () => ({ resumeInterrupted: vi.fn() }));
vi.mock("./crash-blame", () => ({ consumeServerExit: vi.fn() }));
vi.mock("./github-issues", () => ({ startIssueSync: vi.fn() }));
vi.mock("./project-seed-run", () => ({ startProjectSeed: vi.fn() }));
vi.mock("./slack", () => ({ startSlack: vi.fn() }));
vi.mock("./keychain-audit-sync", () => ({ startKeychainAuditSync: vi.fn() }));
vi.mock("./vercel-drift-open", () => ({ startVercelDrift: vi.fn() }));
vi.mock("./github-hooks", () => ({ startHookListener: vi.fn() }));
vi.mock("./blastcp-auto", () => ({ startBlastcpAuto: vi.fn() }));
vi.mock("./vercel-hooks", () => ({ startVercelListener: vi.fn() }));
vi.mock("./webhook-forward", () => ({ startWebhookRelay: vi.fn() }));
vi.mock("./cloud-sync-start", () => ({ startAccountCloudSync: vi.fn() }));
vi.mock("./league-sync", () => ({ startLeagueSync: vi.fn() }));
vi.mock("./cli-reaper", () => ({ reapStrayClis: vi.fn(() => Promise.resolve([])) }));
vi.mock("./worker-reaper", () => ({ startWorkerReaper: vi.fn() }));
vi.mock("./settings", () => ({
  listProjects: vi.fn(() => db.projects),
  defaultPermissionMode: () => "auto",
  copilotModel: vi.fn(() => ""),
}));

// The three modules prewarm() loads lazily, each of which fails to load here.
vi.mock("./app-build-watch", () => {
  throw new Error("app-build-watch won't load");
});
vi.mock("./worktree-pool", () => {
  throw new Error("worktree-pool won't load");
});
vi.mock("./cron-run", () => {
  throw new Error("cron-run won't load");
});

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { prewarm } = await import("./copilot");

const g = globalThis as unknown as { __weftPrewarmed?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  db.cards.clear();
  db.projects = [];
  delete g.__weftPrewarmed;
});

describe("prewarm, when a lazy module won't load", () => {
  it("logs each failure and still starts the server's own work", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    prewarm();
    // The lazy imports settle a tick or two later. The worktree pool's failure is silent, so only the
    // cron clock and the app-build watcher log a line.
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(2));
    expect(errors.join("\n")).toContain("[weft] cron clock failed to start:");
    expect(errors.join("\n")).toContain("app-build-watch: not started:");
    expect(spy).toHaveBeenCalled();
    // The copilot is still there, and the board still works.
    expect(db.cards.get(COPILOT_ID)?.role).toBe("copilot");
    spy.mockRestore();
  });
});
