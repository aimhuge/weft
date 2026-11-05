import path from "node:path";
import type { GuardCall, GuardEvent } from "./decide";
import { patchCalls } from "./patch";

// What Codex's and Goose's own hooks send Weft, put into the calls Weft's guards read (lib/guards/decide.ts):
// Claude Code's tool names and fields. One CLI call can be several guard calls (a patch over three files is three
// edits); each keeps the CLI's call id, with its place after a # when there are more, so the Post hook finds
// what its Pre hook kept.

const EVENTS = new Set<GuardEvent>(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

type Mapped = { tool: string; input: Record<string, unknown> };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The first of these fields that holds text, for a tool whose field names vary between versions.
function field(input: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) if (typeof input[name] === "string") return input[name];
  return "";
}

function spread(event: GuardEvent, id: string, cwd: string, mapped: Mapped[], after: Pick<GuardCall, "response" | "error">): GuardCall[] {
  return mapped.map((m, i) => ({ event, tool: m.tool, input: m.input, cwd, id: mapped.length > 1 ? `${id}#${i}` : id, ...after }));
}

function eventOf(name: unknown): GuardEvent | null {
  return EVENTS.has(name as GuardEvent) ? (name as GuardEvent) : null;
}

function command(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(" ") : text(value);
}

// Codex 0.162 sends Claude Code's own hook payload: Bash for its shell, apply_patch for its edits, MCP tools by name.
function codexTool(tool: string, input: Record<string, unknown>, cwd: string): Mapped[] {
  if (tool === "Bash" || tool === "shell" || tool === "exec_command") return [{ tool: "Bash", input: { ...input, command: command(input.command ?? input.cmd) } }];
  if (tool === "apply_patch") return patchCalls(field(input, "command", "patch", "input"), cwd);
  return [{ tool, input }];
}

/** The guard calls in one of Codex's hook payloads; none for an event Weft doesn't guard. */
export function codexCalls(payload: unknown): GuardCall[] {
  const p = record(payload);
  const event = eventOf(p.hook_event_name);
  if (!event) return [];
  const cwd = text(p.cwd) || process.cwd();
  const mapped = codexTool(text(p.tool_name), record(p.tool_input), cwd);
  return spread(event, text(p.tool_use_id), cwd, mapped, { response: p.tool_response, error: text(p.error) || undefined });
}

// Goose 1.56's developer tools, as Claude Code's: shell is Bash, write and edit are Write and Edit, tree lists a
// folder, read_image reads a file, analyze reads the code under a path.
function gooseTool(tool: string, input: Record<string, unknown>, cwd: string): Mapped[] {
  const file = path.resolve(cwd, field(input, "path", "file_path", "source") || ".");
  switch (tool) {
    case "shell":
      return [{ tool: "Bash", input: { command: command(input.command) } }];
    case "write":
      return [{ tool: "Write", input: { file_path: file, content: field(input, "content", "file_text", "text") } }];
    case "edit":
      return [{ tool: "Edit", input: { file_path: file, old_string: field(input, "old_str", "old_string", "before", "old_text", "search"), new_string: field(input, "new_str", "new_string", "after", "new_text", "replace") } }];
    case "tree":
      return [{ tool: "LS", input: { path: file } }];
    case "read_image":
      return [{ tool: "Read", input: { file_path: file } }];
    case "analyze":
      return [{ tool: "Grep", input: { path: file } }];
    default:
      return [{ tool, input }];
  }
}

/** The guard calls in one of Goose's plugin-hook payloads; none for an event Weft doesn't guard. */
export function gooseCalls(payload: unknown): GuardCall[] {
  const p = record(payload);
  const event = eventOf(p.event);
  if (!event) return [];
  const cwd = text(p.working_dir) || process.cwd();
  const mapped = gooseTool(text(p.tool_name), record(p.tool_input), cwd);
  const failed = event === "PostToolUseFailure";
  return spread(event, text(p.tool_call_id), cwd, mapped, { response: p.tool_output, error: failed ? text(p.tool_output) || text(p.reason) : undefined });
}
