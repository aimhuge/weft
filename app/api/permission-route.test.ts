import { describe, expect, it, vi } from "vitest";

// The permission route's order choices ("This first" / "Others first") live here, away from the wide
// routes.test.ts sweep, because they are the one part of answering that isn't the plain allow/deny.

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-permission-test-data",
  listCards: vi.fn(() => []),
  getCard: vi.fn(() => undefined),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  getThread: vi.fn(() => []),
}));

vi.mock("@/lib/runner", () => ({
  sendMessage: vi.fn(),
  sendUserMessage: vi.fn(),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  endSession: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  isBusy: vi.fn(() => false),
  setPermissionMode: vi.fn(),
  answerPermission: vi.fn(),
  warmUp: vi.fn(),
  ensureSpare: vi.fn(),
  retryAfterLogin: vi.fn(),
}));

vi.mock("@/lib/precedence", () => ({ putFirst: vi.fn(), putHolderFirst: vi.fn() }));

vi.mock("@/lib/settings", () => ({
  DEFAULT_THREAD_PROMPT: "You are a card on a board.",
  listProjects: vi.fn(() => []),
  touchProject: vi.fn(),
  removeProject: vi.fn(),
  markProject: vi.fn(),
  dismissSession: vi.fn(),
  dismissedSessions: vi.fn(() => []),
  threadPrompt: vi.fn(() => "tp"),
  setThreadPrompt: vi.fn(),
  keepAliveMinutes: vi.fn(() => 5),
  setKeepAliveMinutes: vi.fn(),
  defaultPermissionMode: vi.fn(() => "auto"),
  setDefaultPermissionMode: vi.fn(),
  defaultBackend: vi.fn(() => "claude"),
  setDefaultBackend: vi.fn(),
  automations: vi.fn(() => []),
  setAutomations: vi.fn(),
  pushOnDone: vi.fn(() => true),
  setPushOnDone: vi.fn(),
  subagentModel: vi.fn(() => "choose"),
  setSubagentModel: vi.fn(),
  doneModel: vi.fn(() => ""),
  doneEffort: vi.fn(() => ""),
  setDoneModel: vi.fn(),
  setDoneEffort: vi.fn(),
  copilotModel: vi.fn(() => ""),
  setCopilotModel: vi.fn(),
  reviewAllModel: vi.fn(() => ""),
  setReviewAllModel: vi.fn(),
  backupModel: vi.fn(() => ""),
  setBackupModel: vi.fn(),
  issueFolders: vi.fn(() => []),
  setIssueSync: vi.fn(),
  allowedFolders: vi.fn(() => []),
  allowFolder: vi.fn(),
  unallowFolder: vi.fn(),
  syncFolders: vi.fn(() => []),
  setSyncFolder: vi.fn(),
  settingsView: vi.fn(() => ({ threadPrompt: "tp", keepAliveMinutes: 5, automations: [] })),
}));

vi.mock("@/lib/question-reply", () => ({ readQuestionReply: vi.fn(() => undefined) }));

const runner = await import("@/lib/runner");
const permissionRoute = await import("./cards/[id]/permission/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, body: unknown) {
  return new Request(`http://localhost:3457/api${url}`, { method: "POST", headers: WRITE, body: JSON.stringify(body) });
}
const body = async (res: Response) => (await res.json()) as { ok: boolean; error: string };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const answer = (id: string, payload: unknown) => permissionRoute.POST(req(`/cards/${id}/permission`, payload), ctx(id));

describe("POST /cards:id/permission ordering", () => {
  it("puts the card holding the code first with otherFirst: true, and needs its pendingId", async () => {
    const { putHolderFirst } = await import("@/lib/precedence");
    expect(await body(await answer("c1", { otherFirst: true, pendingId: "p1" }))).toEqual({ ok: true });
    expect(putHolderFirst).toHaveBeenCalledWith("c1", "p1");
    expect(runner.answerPermission).not.toHaveBeenCalled();
    const res = await answer("c1", { otherFirst: true });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatch(/Others first needs/);
  });

  it("puts a held edit first with first: true, and needs its pendingId", async () => {
    const { putFirst } = await import("@/lib/precedence");
    expect(await body(await answer("c1", { first: true, pendingId: "p1" }))).toEqual({ ok: true });
    expect(putFirst).toHaveBeenCalledWith("c1", "p1");
    expect(runner.answerPermission).not.toHaveBeenCalled();
    const res = await answer("c1", { first: true });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatch(/This first needs/);
  });
});
