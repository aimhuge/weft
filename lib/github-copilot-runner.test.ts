import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelTurn } from "./cli-adapter";
import { GITHUB_COPILOT_CODE, cancelCopilot, driveGitHubCopilot } from "./github-copilot-runner";
import { Inbox, type Session } from "./runner-state";

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  getAuthStatus: vi.fn(),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
  sendAndWait: vi.fn(),
  forceStop: vi.fn(),
  abort: vi.fn(),
  handle: vi.fn(),
  updateCard: vi.fn(),
}));
vi.mock("./github-copilot-client", async (original) => ({
  ...await original<typeof import("./github-copilot-client")>(),
  githubCopilotClient: () => Promise.resolve(mock),
}));
vi.mock("./github-copilot-tools", () => ({ githubCopilotTools: () => [] }));
vi.mock("./runner-turn", () => ({ handle: mock.handle }));
vi.mock("./secret-run", () => ({ redactStored: (_id: string, text: string) => text }));
vi.mock("./store", async (original) => ({ ...await original<typeof import("./store")>(), updateCard: mock.updateCard }));

function thread(...prompts: string[]): Session {
  const inbox = new Inbox();
  for (const prompt of prompts) inbox.push(prompt);
  inbox.close();
  return { cardId: "copilot-test", spec: { cwd: process.cwd() }, abort: new AbortController(), inbox, toolIndex: new Map() } as unknown as Session;
}

const resultRows = () => mock.handle.mock.calls.map((call) => call[2] as { type: string }).filter((row) => row.type === "result");

describe("GitHub Copilot runner", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  beforeEach(() => {
    vi.resetAllMocks();
    // This suite may run on a Weft Worker itself, where WEFT_WORKER is already set.
    vi.stubEnv("WEFT_WORKER", "");
    mock.getAuthStatus.mockResolvedValue({ isAuthenticated: true });
    mock.forceStop.mockResolvedValue(undefined);
    mock.abort.mockResolvedValue(undefined);
    const copilot = { sessionId: "copilot-1", sendAndWait: mock.sendAndWait, abort: mock.abort };
    mock.createSession.mockResolvedValue(copilot);
    mock.resumeSession.mockResolvedValue(copilot);
    mock.sendAndWait.mockResolvedValue({ data: { content: "The reply" } });
  });

  it("creates a conversation, resumes it on the next turn and files both results", async () => {
    const session = thread("one", "two");
    await driveGitHubCopilot(session);
    expect(mock.createSession).toHaveBeenCalledOnce();
    expect(mock.createSession).toHaveBeenCalledWith(expect.objectContaining({
      enableConfigDiscovery: false,
      enableFileHooks: false,
      availableTools: ["custom:weft_list_files", "custom:weft_read_file", "custom:weft_edit_file"],
    }));
    expect(mock.resumeSession).toHaveBeenCalledWith("copilot-1", expect.objectContaining({ workingDirectory: process.cwd() }));
    expect(mock.sendAndWait).toHaveBeenNthCalledWith(1, expect.objectContaining({ prompt: "one" }), expect.any(Number));
    expect(mock.sendAndWait).toHaveBeenNthCalledWith(2, expect.objectContaining({ prompt: "two" }), expect.any(Number));
    expect(mock.handle).toHaveBeenCalledTimes(4);
    expect(mock.handle).toHaveBeenLastCalledWith("copilot-test", session, expect.objectContaining({ type: "result", session_id: "copilot-1" }));
    expect(mock.forceStop).toHaveBeenCalledTimes(2);
    // The conversation's id goes on the card once, for the next start to resume.
    expect(mock.updateCard).toHaveBeenCalledOnce();
    expect(mock.updateCard).toHaveBeenCalledWith("copilot-test", { sessionId: "copilot-1" });
  });

  it("resumes the card's own conversation after a restart", async () => {
    const session = thread("one");
    session.spec.sessionId = "copilot-1";
    await driveGitHubCopilot(session);
    expect(mock.createSession).not.toHaveBeenCalled();
    expect(mock.resumeSession).toHaveBeenCalledWith("copilot-1", expect.anything());
  });

  it("refuses a worker, a fork and a rewind before any turn", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    await expect(driveGitHubCopilot(thread("one"))).rejects.toThrow(/local desktop/);
    vi.stubEnv("WEFT_WORKER", "");
    const fork = thread("one");
    fork.spec.forkSession = true;
    await expect(driveGitHubCopilot(fork)).rejects.toThrow(/forks or rewind/);
    expect(mock.start).not.toHaveBeenCalled();
  });

  it("fails a turn that ends without a reply", async () => {
    mock.sendAndWait.mockResolvedValue(undefined);
    await expect(driveGitHubCopilot(thread("one"))).rejects.toThrow(/without a reply/);
    expect(mock.forceStop).toHaveBeenCalledOnce();
  });

  it("stops a turn through the SDK session and keeps the thread open for the next one", async () => {
    const session = thread("one", "two");
    mock.sendAndWait.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      mock.abort.mockImplementationOnce(() => {
        reject(new Error("The requested run was aborted before completion."));
        return Promise.reject(new Error("already idle"));
      });
    }));
    const drive = driveGitHubCopilot(session);
    await vi.waitFor(() => expect(mock.sendAndWait).toHaveBeenCalledOnce());
    expect(cancelTurn(session)).toBe(true);
    await drive;
    expect(mock.abort).toHaveBeenCalledOnce();
    expect(session.abort.signal.aborted).toBe(false);
    // The stopped turn ends with a result row, and the next message still runs.
    expect(resultRows()).toHaveLength(2);
    expect(mock.sendAndWait).toHaveBeenCalledTimes(2);
    expect(mock.forceStop).toHaveBeenCalledTimes(2);
  });

  it("stops a turn that hasn't opened its conversation yet", async () => {
    const session = thread("one");
    mock.start.mockImplementation(() => {
      cancelTurn(session);
      return Promise.resolve();
    });
    await driveGitHubCopilot(session);
    expect(mock.createSession).not.toHaveBeenCalled();
    expect(mock.abort).not.toHaveBeenCalled();
    expect(resultRows()).toHaveLength(1);
  });

  it("sends a message's images as blob attachments", async () => {
    const session = thread();
    const content = [{ type: "text", text: "look" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }];
    session.inbox = [{ type: "user", message: { role: "user", content }, parent_tool_use_id: null }] as never;
    await driveGitHubCopilot(session);
    expect(mock.sendAndWait).toHaveBeenCalledWith({ prompt: "look", attachments: [{ type: "blob", mimeType: "image/png", data: "AAAA" }] }, expect.any(Number));
  });

  it("does nothing on a stop between turns", () => {
    expect(() => cancelCopilot(thread(), {})).not.toThrow();
  });

  it("puts its code in the runner's build fingerprint", () => {
    expect(GITHUB_COPILOT_CODE).toContain(driveGitHubCopilot);
    expect(GITHUB_COPILOT_CODE).toContain(cancelTurn);
  });

  it("asks for sign-in without trying to send a prompt when the account is signed out", async () => {
    mock.getAuthStatus.mockResolvedValue({ isAuthenticated: false });
    await expect(driveGitHubCopilot(thread("one"))).rejects.toThrow(/not logged in/);
    expect(mock.createSession).not.toHaveBeenCalled();
    expect(mock.forceStop).toHaveBeenCalledOnce();
  });

  it("stops the SDK runtime when the card is stopped", async () => {
    const session = thread("one");
    mock.sendAndWait.mockImplementation(() => new Promise((_resolve, reject) => {
      mock.forceStop.mockImplementation(() => {
        reject(new Error("Stopped"));
        return Promise.resolve();
      });
    }));
    const drive = driveGitHubCopilot(session);
    const stopped = expect(drive).rejects.toThrow("Stopped");
    await vi.waitFor(() => expect(mock.sendAndWait).toHaveBeenCalledOnce());
    session.abort.abort();
    await stopped;
    expect(mock.forceStop).toHaveBeenCalled();
  });

  it("ignores a runtime that fails to stop when the card is closed", async () => {
    const session = thread("one");
    mock.sendAndWait.mockImplementation(() => new Promise((_resolve, reject) => {
      mock.forceStop.mockImplementationOnce(() => {
        reject(new Error("Closed"));
        return Promise.reject(new Error("already stopped"));
      });
    }));
    const drive = driveGitHubCopilot(session);
    const closed = expect(drive).rejects.toThrow("Closed");
    await vi.waitFor(() => expect(mock.sendAndWait).toHaveBeenCalledOnce());
    session.abort.abort();
    await closed;
  });
});
