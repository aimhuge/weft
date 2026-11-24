import path from "node:path";
import type { ToolUse } from "./cli-messages";

// Antigravity's tools, in Claude Code's names (docs/architecture/antigravity.md). The thread draws Bash, Read, Edit and
// the rest the same on every CLI, and Weft's guards (lib/guards/calls.ts) read the same names, so agy's own are turned
// into them here, once, for both.
//
// agy 1.5.16 over ACP calls its file tools read_file and write_file (Path, Content); its docs and `agy -p` name them
// view_file and write_to_file (AbsolutePath, TargetFile, CodeContent). Both spellings are read.

// Weft's MCP servers (lib/weft-mcp.ts). agy names an MCP tool mcp_<server>_<tool>, so a server whose name has an
// underscore (board_view) is told from a shorter one (board) by trying the longest names first.
export const WEFT_SERVERS = ["board_view", "devservers", "simulator", "webhooks", "browser", "blastcp", "secrets", "board"] as const;

function text(input: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string") return value;
  }
  return "";
}

function file(input: Record<string, unknown>, cwd: string, ...names: string[]): string {
  const given = text(input, ...names);
  return given ? path.resolve(cwd, given) : "";
}

/** An MCP tool's name as Claude Code writes it (mcp__browser__open_url), or undefined for a tool that isn't one of Weft's. */
export function weftMcpName(name: string, servers: readonly string[] = WEFT_SERVERS): string | undefined {
  if (!name.startsWith("mcp_")) return undefined;
  const rest = name.slice(4);
  const server = [...servers].sort((a, b) => b.length - a.length).find((s) => rest.startsWith(`${s}_`) && rest.length > s.length + 1);
  return server ? `mcp__${server}__${rest.slice(server.length + 1)}` : undefined;
}

type Args = Record<string, unknown>;

// agy's own tools, each as the Claude Code tool it is. Two spellings for the file tools (see the top of this file).
const read = (a: Args, cwd: string): ToolUse => ({ name: "Read", input: { file_path: file(a, cwd, "Path", "AbsolutePath", "TargetFile") } });
const write = (a: Args, cwd: string): ToolUse => ({ name: "Write", input: { file_path: file(a, cwd, "Path", "TargetFile"), content: text(a, "Content", "CodeContent") } });
const edit = (a: Args, cwd: string): ToolUse => ({ name: "Edit", input: { file_path: file(a, cwd, "TargetFile", "Path"), old_string: text(a, "TargetContent"), new_string: text(a, "ReplacementContent") } });

const TOOLS: Record<string, (args: Args, cwd: string) => ToolUse> = {
  run_command: (a) => ({ name: "Bash", input: { command: text(a, "CommandLine", "command"), ...(text(a, "toolSummary") ? { description: text(a, "toolSummary") } : {}) } }),
  read_file: read,
  view_file: read,
  write_file: write,
  write_to_file: write,
  replace_file_content: edit,
  multi_replace_file_content: edit,
  sed_file: edit,
  list_dir: (a, cwd) => ({ name: "LS", input: { path: file(a, cwd, "DirectoryPath", "Path") || cwd } }),
  grep_search: (a, cwd) => ({ name: "Grep", input: { pattern: text(a, "Query", "Pattern"), path: file(a, cwd, "SearchPath", "Path") || cwd } }),
  find_by_name: (a, cwd) => ({ name: "Glob", input: { pattern: text(a, "Pattern"), path: file(a, cwd, "SearchDirectory", "Path") || cwd } }),
  search_web: (a) => ({ name: "WebSearch", input: { query: text(a, "query", "Query") } }),
  read_url_content: (a) => ({ name: "WebFetch", input: { url: text(a, "Url", "url") } }),
};

/** One of agy's tool calls, as the thread and the guards see it. */
export function agyTool(name: string, args: Args, cwd: string): ToolUse {
  const known = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
  if (known) return known(args, cwd);
  const mcp = weftMcpName(name);
  if (!mcp) return { name, input: args };
  // agy adds its own toolSummary to every call; the tool itself never asked for it.
  const input = { ...args };
  delete input.toolSummary;
  return { name: mcp, input };
}

/** The files an edit or write touches, for the card's overlap warning. */
export function editedFiles(use: ToolUse): string[] {
  if (use.name !== "Write" && use.name !== "Edit") return [];
  const target = use.input.file_path;
  return typeof target === "string" && target ? [target] : [];
}

export const ANTIGRAVITY_TOOLS_CODE = [weftMcpName, agyTool, editedFiles];
