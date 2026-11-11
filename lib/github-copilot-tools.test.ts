import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAboutCall } from "./guards/ask";
import { githubCopilotTools } from "./github-copilot-tools";
import type { Session } from "./runner-state";

vi.mock("./guards/ask", () => ({ askAboutCall: vi.fn() }));

describe("GitHub Copilot project tools", () => {
  let cwd: string;
  let session: Session;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "weft-copilot-tools-"));
    fs.writeFileSync(path.join(cwd, "sample.txt"), "line one\nline two\n");
    fs.writeFileSync(path.join(cwd, ".env"), "DO_NOT_RETURN=sample");
    fs.mkdirSync(path.join(cwd, ".copilot"));
    fs.writeFileSync(path.join(cwd, ".copilot", "config.json"), "{}");
    session = { cardId: null, spec: { cwd }, abort: new AbortController() } as Session;
    vi.mocked(askAboutCall).mockReset();
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function run(name: string, args: Record<string, string>) {
    const handler = githubCopilotTools(session).find((tool) => tool.name === name)?.handler;
    if (!handler) throw new Error("Missing test tool");
    return handler(args, { arguments: args, sessionId: "copilot-test", toolCallId: "call-1", toolName: name });
  }

  it("reads project text and refuses credential files and traversal", async () => {
    await expect(run("weft_read_file", { path: "sample.txt" })).resolves.toBe("line one\nline two\n");
    await expect(run("weft_read_file", { path: ".env" })).resolves.toMatch(/secret/i);
    await expect(run("weft_read_file", { path: ".copilot/config.json" })).resolves.toMatch(/sign-in token/i);
    await expect(run("weft_read_file", { path: "../sample.txt" })).resolves.toMatch(/relative/i);
    await expect(run("weft_read_file", { path: "sample.txt:hidden" })).resolves.toMatch(/relative/i);
  });

  it("writes only after approval and only when the exact text is still present", async () => {
    const edit = { path: "sample.txt", before: "line two", after: "changed" };
    vi.mocked(askAboutCall).mockResolvedValueOnce({ behavior: "deny", message: "Denied on the card." });
    await expect(run("weft_edit_file", edit)).resolves.toBe("Denied on the card.");
    expect(fs.readFileSync(path.join(cwd, "sample.txt"), "utf8")).toContain("line two");
    vi.mocked(askAboutCall).mockImplementation((_session, _tool, updatedInput) => Promise.resolve({ behavior: "allow", updatedInput }));
    await expect(run("weft_edit_file", edit)).resolves.toBe("Updated the file.");
    expect(fs.readFileSync(path.join(cwd, "sample.txt"), "utf8")).toBe("line one\nchanged\n");
    await expect(run("weft_edit_file", edit)).resolves.toMatch(/exactly once/);
  });
});
