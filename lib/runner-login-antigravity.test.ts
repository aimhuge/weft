import { beforeEach, describe, expect, it, vi } from "vitest";

// An Antigravity thread that hits an auth wall keeps its session id (agy resumes a conversation by id, with no
// cached auth failure to replay) and opens agy's own login (lib/runner-login.ts needLogin).

const m = vi.hoisted(() => ({
  startLogin: vi.fn(),
  updateCard: vi.fn(),
  safeUpdate: vi.fn(),
  card: { id: "c1", sessionId: "conv-1" },
}));

vi.mock("./login", () => ({ startLogin: m.startLogin, noteTrial: vi.fn(), cancelLogin: vi.fn() }));
vi.mock("./puku-trial", () => ({ fetchTrialToken: vi.fn(), hasOwnPukuLogin: () => true, trialJustFetched: () => false }));
vi.mock("./runner-state", () => ({
  CLI_NAMES: { antigravity: "Antigravity", claude: "Claude Code" },
  errorText: String,
  loginWaiters: new Map(),
  safeUpdate: m.safeUpdate,
}));
vi.mock("./store", () => ({ getCard: () => m.card, updateCard: m.updateCard }));

const { needLogin } = await import("./runner-login");

beforeEach(() => {
  m.startLogin.mockReset();
  m.updateCard.mockReset();
  m.safeUpdate.mockReset();
});

describe("needLogin on Antigravity", () => {
  it("keeps the conversation id and starts agy's login", () => {
    needLogin("c1", "antigravity", "authentication required");
    expect(m.updateCard).not.toHaveBeenCalled();
    expect(m.startLogin).toHaveBeenCalledWith("antigravity", expect.any(Function));
    expect(m.safeUpdate).toHaveBeenCalledWith("c1", expect.objectContaining({ column: "needs_you", lastLine: "Log in to Antigravity to run this thread" }));
  });

  it("still drops a Claude Code session, as before", () => {
    needLogin("c1", "claude", "Not logged in");
    expect(m.updateCard).toHaveBeenCalledWith("c1", { sessionId: undefined });
  });
});
