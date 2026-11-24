import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_TOOLS_CODE, WEFT_SERVERS, agyTool, editedFiles, weftMcpName } from "./antigravity-tools";

// agy's tool calls in Claude Code's names (lib/antigravity-tools.ts), for the thread's rows and Weft's guards alike.

const CWD = "/tmp/p";

describe("weftMcpName", () => {
  it("turns agy's mcp_<server>_<tool> into Claude Code's mcp__<server>__<tool>", () => {
    expect(weftMcpName("mcp_browser_open_url")).toBe("mcp__browser__open_url");
    expect(weftMcpName("mcp_secrets_fill_field")).toBe("mcp__secrets__fill_field");
  });

  it("tells a server with an underscore from a shorter one by trying the longest name first", () => {
    expect(weftMcpName("mcp_board_view_screenshot")).toBe("mcp__board_view__screenshot");
    expect(weftMcpName("mcp_board_list_cards")).toBe("mcp__board__list_cards");
  });

  it("is undefined for a tool that isn't MCP, isn't one of Weft's servers, or names no tool", () => {
    expect(weftMcpName("run_command")).toBeUndefined();
    expect(weftMcpName("mcp_github_search")).toBeUndefined();
    expect(weftMcpName("mcp_browser_")).toBeUndefined();
    expect(weftMcpName("mcp_browser")).toBeUndefined();
  });

  it("takes its own list of servers", () => {
    expect(weftMcpName("mcp_x_y", ["x"])).toBe("mcp__x__y");
    expect(WEFT_SERVERS).toContain("board_view");
  });
});

describe("agyTool", () => {
  it("reads run_command as Bash, with agy's summary as the description when it gave one", () => {
    expect(agyTool("run_command", { CommandLine: "echo hello_weft", WaitMsBeforeAsync: 5000, toolSummary: "Echo hello weft" }, CWD)).toEqual({ name: "Bash", input: { command: "echo hello_weft", description: "Echo hello weft" } });
    expect(agyTool("run_command", { command: "ls" }, CWD)).toEqual({ name: "Bash", input: { command: "ls" } });
    expect(agyTool("run_command", {}, CWD)).toEqual({ name: "Bash", input: { command: "" } });
  });

  it("reads both spellings of the file reader as Read, with relative paths resolved against the folder", () => {
    expect(agyTool("read_file", { Path: "/tmp/p/x.txt" }, CWD)).toEqual({ name: "Read", input: { file_path: "/tmp/p/x.txt" } });
    expect(agyTool("view_file", { AbsolutePath: "x.txt" }, CWD)).toEqual({ name: "Read", input: { file_path: "/tmp/p/x.txt" } });
    expect(agyTool("view_file", { TargetFile: "/a" }, CWD)).toEqual({ name: "Read", input: { file_path: "/a" } });
    expect(agyTool("read_file", {}, CWD)).toEqual({ name: "Read", input: { file_path: "" } });
  });

  it("reads both spellings of the file writer as Write", () => {
    expect(agyTool("write_file", { Content: "a", Overwrite: true, Path: "/tmp/p/x.txt" }, CWD)).toEqual({ name: "Write", input: { file_path: "/tmp/p/x.txt", content: "a" } });
    expect(agyTool("write_to_file", { TargetFile: "y.txt", CodeContent: "b" }, CWD)).toEqual({ name: "Write", input: { file_path: "/tmp/p/y.txt", content: "b" } });
  });

  it("reads the replace tools as Edit", () => {
    for (const name of ["replace_file_content", "multi_replace_file_content", "sed_file"]) {
      expect(agyTool(name, { TargetFile: "z.ts", TargetContent: "old", ReplacementContent: "new" }, CWD)).toEqual({ name: "Edit", input: { file_path: "/tmp/p/z.ts", old_string: "old", new_string: "new" } });
    }
    expect(agyTool("sed_file", { Path: "/q" }, CWD).input).toEqual({ file_path: "/q", old_string: "", new_string: "" });
  });

  it("reads list_dir, grep_search and find_by_name, defaulting to the folder", () => {
    expect(agyTool("list_dir", { DirectoryPath: "src" }, CWD)).toEqual({ name: "LS", input: { path: "/tmp/p/src" } });
    expect(agyTool("list_dir", {}, CWD)).toEqual({ name: "LS", input: { path: CWD } });
    expect(agyTool("grep_search", { Query: "foo", SearchPath: "lib" }, CWD)).toEqual({ name: "Grep", input: { pattern: "foo", path: "/tmp/p/lib" } });
    expect(agyTool("grep_search", { Pattern: "bar" }, CWD)).toEqual({ name: "Grep", input: { pattern: "bar", path: CWD } });
    expect(agyTool("find_by_name", { Pattern: "*.ts", SearchDirectory: "/x" }, CWD)).toEqual({ name: "Glob", input: { pattern: "*.ts", path: "/x" } });
    expect(agyTool("find_by_name", {}, CWD)).toEqual({ name: "Glob", input: { pattern: "", path: CWD } });
  });

  it("reads the web tools as WebSearch and WebFetch", () => {
    expect(agyTool("search_web", { query: "q" }, CWD)).toEqual({ name: "WebSearch", input: { query: "q" } });
    expect(agyTool("search_web", { Query: "Q" }, CWD)).toEqual({ name: "WebSearch", input: { query: "Q" } });
    expect(agyTool("read_url_content", { Url: "https://a" }, CWD)).toEqual({ name: "WebFetch", input: { url: "https://a" } });
    expect(agyTool("read_url_content", { url: "https://b" }, CWD)).toEqual({ name: "WebFetch", input: { url: "https://b" } });
  });

  it("names Weft's MCP tools as Claude Code does, without agy's own toolSummary", () => {
    expect(agyTool("mcp_browser_open_url", { url: "x", toolSummary: "open" }, CWD)).toEqual({ name: "mcp__browser__open_url", input: { url: "x" } });
  });

  it("keeps any other tool as agy named it", () => {
    expect(agyTool("browser_subagent", { task: "t", toolSummary: "s" }, CWD)).toEqual({ name: "browser_subagent", input: { task: "t", toolSummary: "s" } });
  });

  it("never mistakes an object built-in for one of agy's tools", () => {
    expect(agyTool("constructor", { a: 1 }, CWD)).toEqual({ name: "constructor", input: { a: 1 } });
    expect(agyTool("toString", {}, CWD)).toEqual({ name: "toString", input: {} });
  });

  it("leaves the args it was given alone when it drops toolSummary", () => {
    const args = { url: "x", toolSummary: "open" };
    agyTool("mcp_browser_open_url", args, CWD);
    expect(args).toEqual({ url: "x", toolSummary: "open" });
  });
});

describe("editedFiles", () => {
  it("is the file a Write or Edit touches, and nothing for any other tool or no path", () => {
    expect(editedFiles({ name: "Write", input: { file_path: "/a" } })).toEqual(["/a"]);
    expect(editedFiles({ name: "Edit", input: { file_path: "/b" } })).toEqual(["/b"]);
    expect(editedFiles({ name: "Edit", input: { file_path: "" } })).toEqual([]);
    expect(editedFiles({ name: "Write", input: { file_path: 3 } })).toEqual([]);
    expect(editedFiles({ name: "Read", input: { file_path: "/a" } })).toEqual([]);
  });
});

it("lists its code for the runner's build fingerprint", () => {
  expect(ANTIGRAVITY_TOOLS_CODE).toEqual([weftMcpName, agyTool, editedFiles]);
});
