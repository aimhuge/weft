import os from "node:os";
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
vi.mock("./puku-trial", () => ({ startPukuTrial: vi.fn((onSignIn: () => void) => onSignIn()) }));
vi.mock("./import", () => ({ startSessionSync: vi.fn() }));
vi.mock("./search", () => ({ startSearchIndex: vi.fn() }));
vi.mock("./scheduler", () => ({ startScheduler: vi.fn() }));
const suggest = vi.hoisted(() => ({ startSuggestRefresh: vi.fn(), chipCardId: vi.fn<(text: string) => string | undefined>() }));
vi.mock("./copilot-initiative-run", () => ({ startCheckIns: vi.fn() }));
vi.mock("./runner-state", () => ({ isBusy: vi.fn(() => false) }));
vi.mock("./copilot-suggest", () => suggest);
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
// The reaper's check can fail; the server logs it and carries on.
const reaper = vi.hoisted(() => ({ fails: false }));
vi.mock("./cli-reaper", () => ({
  reapStrayClis: vi.fn(() => (reaper.fails ? Promise.reject(new Error("disk gone")) : Promise.resolve([]))),
}));
vi.mock("./worker-reaper", () => ({ startWorkerReaper: vi.fn() }));
// The three modules prewarm() loads lazily. Their watchers are faked here, and the app-build one
// throws so the failure path is covered too (lib/copilot-lazy-start.test.ts has the other half).
const lazy = vi.hoisted(() => ({ appBuildFails: false }));
vi.mock("./app-build-watch", () => ({
  startAppBuildWatcher: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the watcher throws a plain string, and the server logs it as it is
    if (lazy.appBuildFails) throw "no esbuild";
    return { stop: () => {}, rebuild: () => {}, pendingCount: () => 0 };
  },
}));
vi.mock("./worktree-pool", () => ({ startWorktreePool: vi.fn() }));
vi.mock("./cron-run", () => ({ startCronClock: vi.fn() }));
vi.mock("./settings", () => ({
  listProjects: vi.fn(() => db.projects),
  defaultPermissionMode: () => "auto",
  copilotModel: vi.fn(() => ""),
}));
// localStorage in node is undefined; modelFor() reads it. Stub a no-op store.
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const store = await import("./store");
const runner = await import("./runner");
const { startSessionSync } = await import("./import");
const { startSearchIndex } = await import("./search");
const { startScheduler } = await import("./scheduler");
const { resumeInterrupted } = await import("./resume");
const { consumeServerExit } = await import("./crash-blame");
const { startIssueSync } = await import("./github-issues");
const { startProjectSeed } = await import("./project-seed-run");
const { startSlack } = await import("./slack");
const { startKeychainAuditSync } = await import("./keychain-audit-sync");
const { lastSeen } = await import("./copilot-digest");
const { ensureCopilot, sendToCopilot, resetCopilot, setCopilotPersona, prewarm } = await import("./copilot");

const g = globalThis as unknown as { __weftPrewarmed?: boolean; __weftCopilotSeen?: unknown };
const card = (id: string, over: Partial<Card> = {}) => {
  const c: Card = { id, title: id, prompt: "", cwd: `/dev/${id}`, backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
  db.cards.set(id, c);
  return c;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.cards.clear();
  db.projects = [];
  delete g.__weftPrewarmed;
  delete g.__weftCopilotSeen;
  reaper.fails = false;
  lazy.appBuildFails = false;
});

describe("ensureCopilot", () => {
  it("creates the copilot card in the home folder the first time, with no model of its own", () => {
    // There is no default model: with no pick in Settings and nothing remembered, the copilot
    // starts on whatever its CLI chooses.
    const c = ensureCopilot();
    expect(store.createCard).toHaveBeenCalledWith(
      {
        title: "Copilot",
        prompt: "",
        cwd: os.homedir(),
        backend: "claude",
        permissionMode: "auto",
        model: undefined,
        role: "copilot",
      },
      COPILOT_ID,
    );
    expect(c.id).toBe(COPILOT_ID);
  });

  it("uses the pick from Settings when one is set", async () => {
    const settings = await import("./settings");
    vi.mocked(settings.copilotModel).mockReturnValueOnce("claude-haiku-5-5");
    ensureCopilot();
    expect(store.createCard).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-5-5", role: "copilot" }),
      COPILOT_ID,
    );
  });

  it("moves to the CLI that serves the picked model", async () => {
    const settings = await import("./settings");
    vi.mocked(settings.copilotModel).mockReturnValueOnce("puku-ai-2.8");
    ensureCopilot();
    expect(store.createCard).toHaveBeenCalledWith(
      expect.objectContaining({ backend: "puku", model: "puku-ai-2.8" }),
      COPILOT_ID,
    );
  });

  it("returns the existing card after that", () => {
    const existing = card(COPILOT_ID, { role: "copilot", title: "Mine" });
    expect(ensureCopilot()).toBe(existing);
    expect(store.createCard).not.toHaveBeenCalled();
  });
});

describe("sendToCopilot", () => {
  it("sends the plain text when nothing on the board changed, and remembers the board", () => {
    card(COPILOT_ID, { role: "copilot" });
    card("a", { column: "running" });
    g.__weftCopilotSeen = { a: { column: "running" } };
    sendToCopilot("hello");
    expect(runner.sendUserMessage).toHaveBeenCalledWith(COPILOT_ID, "hello", { cli: "hello" });
    expect(lastSeen()).toEqual({ a: { column: "running", error: undefined } });
  });

  it("puts what finished since the last message in front of the CLI's copy only", () => {
    card(COPILOT_ID, { role: "copilot" });
    card("a", { column: "review", lastLine: "Done the thing" });
    g.__weftCopilotSeen = { a: { column: "running" } };
    sendToCopilot("what's new?");
    const [id, text, opts] = vi.mocked(runner.sendUserMessage).mock.calls[0]!;
    expect([id, text]).toEqual([COPILOT_ID, "what's new?"]);
    expect(opts!.cli).toMatch(/^\[Weft board update.*\n- Finished, in Review: "a" \(a\): Done the thing\n\nwhat's new\?$/);
    expect(lastSeen()).toEqual({ a: { column: "review", error: undefined } });
  });

  it("tells the CLI which card a suggested chip is about, and skips a card that's gone", () => {
    card(COPILOT_ID, { role: "copilot" });
    card("a", { column: "running", title: "Fix login" });
    g.__weftCopilotSeen = { a: { column: "running" } };
    suggest.chipCardId.mockReturnValueOnce("a").mockReturnValueOnce("gone");
    sendToCopilot("Commit Fix login");
    sendToCopilot("Other chip");
    const calls = vi.mocked(runner.sendUserMessage).mock.calls;
    expect(calls[0]?.[2]).toEqual({ cli: '[Weft: this is a suggested chip about card "Fix login" (a); read_thread it before acting. Not written by the user.]\n\nCommit Fix login' });
    expect(calls[1]?.[2]).toEqual({ cli: "Other chip" });
  });

  it("with no snapshot yet, counts cards that changed after the copilot's last turn", () => {
    card(COPILOT_ID, { role: "copilot", lastWeftTurn: 100 });
    card("old", { column: "review", updatedAt: 50 });
    card("new", { column: "review", updatedAt: 150 });
    sendToCopilot("hi");
    const cli = vi.mocked(runner.sendUserMessage).mock.calls[0]![2]!.cli!;
    expect(cli).toContain("(new)");
    expect(cli).not.toContain("(old)");
  });
});

describe("resetCopilot", () => {
  it("ends the session, clears the thread, zeroes the card and warms a fresh CLI, in that order", async () => {
    card(COPILOT_ID, { role: "copilot", sessionId: "s1", column: "review", costUsd: 3, turns: 9, lastLine: "x", error: "e" });
    const order: string[] = [];
    vi.mocked(runner.endSession).mockImplementationOnce(() => {
      order.push("end");
      return Promise.resolve();
    });
    vi.mocked(store.clearThread).mockImplementationOnce(() => void order.push("clear"));
    vi.mocked(runner.warmUp).mockImplementationOnce(() => void order.push("warm"));
    const c = await resetCopilot();
    expect(order).toEqual(["end", "clear", "warm"]);
    expect(runner.endSession).toHaveBeenCalledWith(COPILOT_ID);
    expect(c).toMatchObject({ sessionId: undefined, column: "backlog", costUsd: 0, turns: 0, lastLine: undefined, error: undefined, pending: null });
  });

  it("creates the copilot first when there isn't one", async () => {
    const c = await resetCopilot();
    expect(store.createCard).toHaveBeenCalledOnce();
    expect(c.column).toBe("backlog");
  });
});

describe("setCopilotPersona", () => {
  it("puts the persona on the card and starts a new chat on it", async () => {
    card(COPILOT_ID, { role: "copilot", sessionId: "s1" });
    const c = await setCopilotPersona("founder");
    expect(c).toMatchObject({ persona: "founder", sessionId: undefined, column: "backlog" });
    expect(runner.endSession).toHaveBeenCalledWith(COPILOT_ID);
    expect(runner.warmUp).toHaveBeenCalledWith(COPILOT_ID);
  });

  it("stores Wingman, the default, as no persona", async () => {
    card(COPILOT_ID, { role: "copilot", persona: "captain" });
    expect((await setCopilotPersona("wingman")).persona).toBeUndefined();
  });
});

describe("prewarm", () => {
  it("starts session sync, search, the scheduler, resumes and the copilot's CLI, once per server", () => {
    prewarm();
    prewarm();
    for (const fn of [startSessionSync, startSearchIndex, startScheduler, consumeServerExit, resumeInterrupted, startIssueSync, startProjectSeed, startSlack, startKeychainAuditSync]) expect(fn).toHaveBeenCalledOnce();
    expect(db.cards.get(COPILOT_ID)?.role).toBe("copilot");
    expect(runner.warmUp).toHaveBeenCalledExactlyOnceWith(COPILOT_ID);
    // The Puku trial's sign-in callback retries puku threads waiting on a login.
    expect(runner.retryPukuWithTrial).toHaveBeenCalledOnce();
  });

  it("opens a spare in the most recent project", () => {
    db.projects = [{ path: "/dev/recent" }, { path: "/dev/older" }];
    card("a");
    prewarm();
    expect(runner.ensureSpare).toHaveBeenCalledExactlyOnceWith("/dev/recent");
  });

  it("falls back to the first non-copilot card's folder with no projects", () => {
    card(COPILOT_ID, { role: "copilot", cwd: "/home" });
    card("a", { cwd: "/dev/a" });
    prewarm();
    expect(runner.ensureSpare).toHaveBeenCalledExactlyOnceWith("/dev/a");
  });

  it("opens no spare on an empty board", () => {
    prewarm();
    expect(runner.ensureSpare).not.toHaveBeenCalled();
  });

  it("starts the watchers it loads lazily, once the imports land", async () => {
    const { startWorktreePool } = await import("./worktree-pool");
    const { startCronClock } = await import("./cron-run");
    prewarm();
    // The lazy imports settle a tick or two later.
    await vi.waitFor(() => expect(startWorktreePool).toHaveBeenCalled());
    expect(startCronClock).toHaveBeenCalled();
    lazy.appBuildFails = false;
  });

  it("logs a watcher that won't start, and carries on", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    lazy.appBuildFails = true;
    prewarm();
    await vi.waitFor(() => expect(errors.join("\n")).toContain("app-build-watch: not started:"));
    // The failure is reported as it is, not as an Error's message.
    expect(errors.join("\n")).toContain("no esbuild");
    lazy.appBuildFails = false;
    spy.mockRestore();
  });

  it("logs a stray-CLI check that failed, and carries on", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    reaper.fails = true;
    prewarm();
    await vi.waitFor(() => expect(errors.join("\n")).toContain("[weft] stray CLI check failed:"));
    expect(errors.join("\n")).toContain("disk gone");
    reaper.fails = false;
    spy.mockRestore();
  });
});
