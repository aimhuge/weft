import { beforeEach, describe, expect, it, vi } from "vitest";
import { driveGitHubCopilot } from "./github-copilot-runner";
import { Inbox, type Session } from "./runner-state";

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  getAuthStatus: vi.fn(),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
  sendAndWait: vi.fn(),
  forceStop: vi.fn(),
  handle: vi.fn(),
}));
vi.mock("./github-copilot-client", async (original) => ({
  ...await original<typeof import("./github-copilot-client")>(),
  githubCopilotClient: () => Promise.resolve(mock),
}));
vi.mock("./github-copilot-tools", () => ({ githubCopilotTools: () => [] }));
vi.mock("./runner-turn", () => ({ handle: mock.handle }));
vi.mock("./secret-run", () => ({ redactStored: (_id: string, text: string) => text }));

function thread(...prompts: string[]): Session {
  const inbox = new Inbox();
  for (const prompt of prompts) inbox.push(prompt);
  inbox.close();
  return { cardId: "copilot-test", spec: { cwd: process.cwd() }, abort: new AbortController(), inbox } as Session;
}

describe("GitHub Copilot runner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.getAuthStatus.mockResolvedValue({ isAuthenticated: true });
    mock.forceStop.mockResolvedValue(undefined);
    const copilot = { sessionId: "copilot-1", sendAndWait: mock.sendAndWait };
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
});
