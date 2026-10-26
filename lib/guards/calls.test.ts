import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexCalls, gooseCalls } from "./calls";

// The hook payloads Codex and Goose send Weft (lib/guards/calls.ts), read as the calls Weft's guards expect:
// Claude Code's tool names and fields.

const CWD = "/w";
const at = (file: string) => path.resolve(CWD, file);

describe("codexCalls", () => {
  it("reads a Bash call's command", () => {
    expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la" }, cwd: CWD, tool_use_id: "t1" })).toEqual([
      { event: "PreToolUse", tool: "Bash", input: { command: "ls -la" }, cwd: CWD, id: "t1" },
    ]);
  });

  it("joins a Bash command given as an array", () => {
    expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: ["ls", "-la"] } })[0]?.input.command).toBe("ls -la");
  });

  it("takes the command from a cmd field when there is no command", () => {
    expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { cmd: "pwd" } })[0]?.input.command).toBe("pwd");
  });

  it("reads Codex's own shell tool names as Bash", () => {
    for (const name of ["shell", "exec_command"]) {
      expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: name, tool_input: { command: "ls" } })[0]).toMatchObject({ tool: "Bash", input: { command: "ls" } });
    }
  });

  it("keeps the other fields of a shell call", () => {
    expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: "shell", tool_input: { command: "ls", timeout: 30 } })[0]?.input).toEqual({ command: "ls", timeout: 30 });
  });

  it("turns a patch over two files into two calls, each with its own number", () => {
    const calls = codexCalls({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Add File: a.ts\n+1\n*** Update File: b.ts\n@@\n-o\n+n\n*** End Patch" },
      cwd: CWD,
      tool_use_id: "t1",
    });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => [c.tool, c.id])).toEqual([
      ["Write", "t1#0"],
      ["MultiEdit", "t1#1"],
    ]);
    expect(calls[0]?.input).toEqual({ file_path: at("a.ts"), content: "1" });
  });

  it("keeps the call's own id when a patch names one file", () => {
    const calls = codexCalls({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: a.ts\n+1\n*** End Patch" }, cwd: CWD, tool_use_id: "t1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("t1");
  });

  it("takes the patch from whichever field holds it", () => {
    const patch = "*** Begin Patch\n*** Add File: a.ts\n+1\n*** End Patch";
    for (const name of ["command", "patch", "input"]) {
      const calls = codexCalls({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { [name]: patch }, cwd: CWD, tool_use_id: "t1" });
      expect(calls[0]?.input).toEqual({ file_path: at("a.ts"), content: "1" });
    }
  });

  it("passes an MCP tool through as it is", () => {
    const calls = codexCalls({ hook_event_name: "PreToolUse", tool_name: "mcp__browser__open_url", tool_input: { url: "https://example.com" }, cwd: CWD, tool_use_id: "t1" });
    expect(calls[0]).toMatchObject({ tool: "mcp__browser__open_url", input: { url: "https://example.com" } });
  });

  it("carries what a PostToolUse call returned", () => {
    const calls = codexCalls({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: { stdout: "a.ts" } });
    expect(calls[0]).toMatchObject({ event: "PostToolUse", response: { stdout: "a.ts" } });
  });

  it("carries the error a failed call gave", () => {
    const calls = codexCalls({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "ls" }, error: "boom" });
    expect(calls[0]).toMatchObject({ event: "PostToolUseFailure", error: "boom" });
  });

  it("gives no call for an event Weft does not guard", () => {
    expect(codexCalls({ hook_event_name: "Notification", tool_name: "Bash", tool_input: { command: "ls" } })).toEqual([]);
    expect(codexCalls({})).toEqual([]);
  });

  it("falls back to the process's own folder when the payload has no cwd", () => {
    expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } })[0]?.cwd).toBe(process.cwd());
  });

  it("reads a payload that is not an object, or a tool input that is not one", () => {
    expect(codexCalls("not a payload")).toEqual([]);
    expect(codexCalls({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: "not an object" })[0]?.input).toEqual({ command: "" });
  });
});

describe("gooseCalls", () => {
  it("reads a shell call as Bash", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "shell", tool_input: { command: "ls -la" }, working_dir: CWD, tool_call_id: "g1" })).toEqual([
      { event: "PreToolUse", tool: "Bash", input: { command: "ls -la" }, cwd: CWD, id: "g1" },
    ]);
  });

  it("reads a write as a Write of the file's content", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "write", tool_input: { path: "a.ts", content: "x" }, working_dir: CWD })[0]).toMatchObject({
      tool: "Write",
      input: { file_path: at("a.ts"), content: "x" },
    });
  });

  it("takes a write's content from file_text when there is no content", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "write", tool_input: { path: "a.ts", file_text: "x" }, working_dir: CWD })[0]?.input).toEqual({ file_path: at("a.ts"), content: "x" });
  });

  it("reads an edit as an Edit of the old and the new text", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "edit", tool_input: { path: "a.ts", old_str: "old", new_str: "new" }, working_dir: CWD })[0]).toMatchObject({
      tool: "Edit",
      input: { file_path: at("a.ts"), old_string: "old", new_string: "new" },
    });
  });

  it("reads an edit that names its old and new text before and after", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "edit", tool_input: { path: "a.ts", before: "old", after: "new" }, working_dir: CWD })[0]?.input).toEqual({
      file_path: at("a.ts"),
      old_string: "old",
      new_string: "new",
    });
  });

  it("reads a tree as an LS of the folder", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "tree", tool_input: { path: "src" }, working_dir: CWD })[0]).toMatchObject({ tool: "LS", input: { path: at("src") } });
  });

  it("reads a read_image as a Read of the image", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "read_image", tool_input: { source: "a.png" }, working_dir: CWD })[0]).toMatchObject({ tool: "Read", input: { file_path: at("a.png") } });
  });

  it("reads an analyze as a Grep of the path", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "analyze", tool_input: { path: "src" }, working_dir: CWD })[0]).toMatchObject({ tool: "Grep", input: { path: at("src") } });
  });

  it("resolves a relative path against the working folder", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "read_image", tool_input: { source: "img/a.png" }, working_dir: CWD })[0]?.input.file_path).toBe(at("img/a.png"));
  });

  it("resolves a path that is missing to the working folder", () => {
    expect(gooseCalls({ event: "PreToolUse", tool_name: "tree", tool_input: {}, working_dir: CWD })[0]?.input.path).toBe(CWD);
  });

  it("passes an MCP tool through as it is", () => {
    const calls = gooseCalls({ event: "PreToolUse", tool_name: "mcp__x__y", tool_input: { a: 1 }, working_dir: CWD });
    expect(calls[0]).toMatchObject({ tool: "mcp__x__y", input: { a: 1 } });
  });

  it("takes a failure's error from what the tool said", () => {
    expect(gooseCalls({ event: "PostToolUseFailure", tool_name: "shell", tool_input: { command: "ls" }, tool_output: "it broke" })[0]).toMatchObject({ event: "PostToolUseFailure", error: "it broke" });
  });

  it("takes a failure's error from the reason when there is no output", () => {
    expect(gooseCalls({ event: "PostToolUseFailure", tool_name: "shell", tool_input: { command: "ls" }, reason: "no such tool" })[0]).toMatchObject({ error: "no such tool" });
  });

  it("gives no call for an event Weft does not guard", () => {
    expect(gooseCalls({ event: "SessionStart", tool_name: "shell", tool_input: { command: "ls" } })).toEqual([]);
    expect(gooseCalls({})).toEqual([]);
  });
});
