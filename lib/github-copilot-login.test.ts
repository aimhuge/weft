import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInGitHubCopilot } from "./github-copilot-login";

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  getAuthStatus: vi.fn(),
  createSession: vi.fn(),
  begin: vi.fn(),
  advance: vi.fn(),
  forceStop: vi.fn(),
}));
vi.mock("./github-copilot-client", () => ({
  copilotSessionDefaults: {},
  githubCopilotClient: () => Promise.resolve(mock),
}));

describe("GitHub Copilot device login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.getAuthStatus.mockResolvedValue({ isAuthenticated: false });
    mock.forceStop.mockResolvedValue(undefined);
    mock.begin.mockResolvedValue({
      flowId: "flow-1",
      step: { kind: "device-code", verificationUri: "https://github.com/login/device", userCode: "ABCD-EFGH" },
    });
    mock.advance.mockResolvedValue({ kind: "completed", result: { status: "completed" } });
    mock.createSession.mockResolvedValue({ rpc: { accounts: { login: { begin: mock.begin, advance: mock.advance } } } });
  });

  it("shows GitHub's device code and verifies authentication before completing", async () => {
    const showCode = vi.fn();
    mock.getAuthStatus.mockResolvedValueOnce({ isAuthenticated: false }).mockResolvedValueOnce({ isAuthenticated: true });
    await signInGitHubCopilot(new AbortController().signal, showCode);
    expect(showCode).toHaveBeenCalledWith("https://github.com/login/device", "ABCD-EFGH");
    expect(mock.begin).toHaveBeenCalledWith({ kind: "githubDotCom", method: "device-code" });
    expect(mock.advance).toHaveBeenCalledWith({ flowId: "flow-1" });
    expect(mock.forceStop).toHaveBeenCalledOnce();
  });

  it("rejects a device URL outside GitHub", async () => {
    mock.begin.mockResolvedValueOnce({
      flowId: "flow-1",
      step: { kind: "device-code", verificationUri: "https://example.com/login/device", userCode: "ABCD-EFGH" },
    });
    await expect(signInGitHubCopilot(new AbortController().signal, vi.fn())).rejects.toThrow(/unexpected sign-in address/);
    expect(mock.advance).not.toHaveBeenCalled();
  });
});
