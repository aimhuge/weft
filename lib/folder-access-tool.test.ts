import { beforeEach, describe, expect, it, vi } from "vitest";

// The request_folder_access tool (lib/folder-access-tool.ts), against a fake SDK that hands back each registered tool
// and the control server's shell() mocked.

interface CapturedTool {
  name: string;
  handler: (args: { folder: string }) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

const shell = vi.hoisted(() => vi.fn<(route: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>>());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: CapturedTool["handler"]) => ({ name, handler }),
}));
vi.mock("./browser-tools", () => ({
  shell,
  text: (value: string, isError = false) => ({ content: [{ type: "text", text: value }], isError }),
}));

const { SAFE_BOARD_TOOLS, isTrustedTool } = await import("./board-tools-trust");
const { folderAccessTool } = await import("./folder-access-tool");

const run = async (folder = "downloads") => {
  const result = await (folderAccessTool() as unknown as CapturedTool).handler({ folder });
  return { text: result.content[0]?.text ?? "", isError: result.isError };
};

beforeEach(() => shell.mockReset());

describe("request_folder_access", () => {
  it("is a tool that skips the permission prompt, since it only asks the user", () => {
    expect((folderAccessTool() as unknown as CapturedTool).name).toBe("request_folder_access");
    expect(SAFE_BOARD_TOOLS.has("request_folder_access")).toBe(true);
    expect(isTrustedTool("mcp__board__request_folder_access", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__simulator__launch", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__simulator__launch", "stdio")).toBe(false);
  });

  it("asks the control server for the folder", async () => {
    shell.mockResolvedValue({ status: "granted" });
    await run("desktop");
    expect(shell).toHaveBeenCalledWith("/folder-access/ask", { folder: "desktop" });
  });

  it("says when access is already there", async () => {
    shell.mockResolvedValue({ status: "granted" });
    expect((await run()).text).toMatch(/already read downloads.*restart Weft/);
  });

  it("says when the folder doesn't exist", async () => {
    shell.mockResolvedValue({ status: "missing" });
    expect((await run()).text).toBe("There is no downloads folder on this Mac.");
  });

  it("says it only applies on a Mac", async () => {
    shell.mockResolvedValue({ status: "unsupported" });
    expect((await run()).text).toMatch(/only applies on a Mac/);
  });

  it("tells the thread Settings is open when the user took Open Settings", async () => {
    shell.mockResolvedValue({ status: "denied", openedSettings: true });
    expect((await run()).text).toMatch(/opened System Settings.*restart Weft/);
  });

  it("tells the thread not to ask again when the user chose Not now", async () => {
    shell.mockResolvedValue({ status: "denied", openedSettings: false });
    expect((await run()).text).toMatch(/chose Not now.*Don't ask again/);
  });

  it("reports a folder the shell doesn't know as an error", async () => {
    shell.mockResolvedValue({ status: "unknown" });
    expect(await run()).toEqual({ text: "Weft can't ask for downloads.", isError: true });
  });

  it("passes on the shell's error, from an Error or not", async () => {
    shell.mockRejectedValueOnce(new Error("The browser pane only exists in the desktop app (npm run desktop)."));
    expect(await run()).toEqual({ text: "The browser pane only exists in the desktop app (npm run desktop).", isError: true });
    shell.mockRejectedValueOnce("boom");
    expect(await run()).toEqual({ text: "boom", isError: true });
  });
});
