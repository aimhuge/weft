import { agyTool, editedFiles } from "./antigravity-tools";
import type { CliUsage, ToolOutcome, ToolUse } from "./cli-messages";

// What one of agy's ACP session/update notifications means for the thread (docs/architecture/antigravity.md). Pure:
// lib/antigravity-runner.ts files the steps. Shapes measured against agy 1.5.16:
//
//   agent_message_chunk  {content: {type: "text", text}}                     a slice of the reply
//   tool_call            {toolCallId, name, rawInput, kind, title}           a tool starting
//   tool_call_update     {toolCallId, status, rawOutput, content, locations} its progress; completed or failed ends it
//   usage_update         {used, size}                                        how full the context window is
//   agent_thought_chunk, available_commands_update, session_info_update, plan  nothing the thread shows
export type AgyStep =
  | { kind: "text"; text: string }
  | { kind: "tool-start"; id: string; use: ToolUse }
  | { kind: "tool-end"; id: string; use: ToolUse; outcome: ToolOutcome; files: string[] }
  | { kind: "context"; used: number; size: number };

type Update = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolOf(update: Update, cwd: string): ToolUse {
  return agyTool(str(update.name), record(update.rawInput ?? update.args), cwd);
}

// A tool's output: its content's text blocks, else rawOutput's (a string, or {output}), else a word on the diff it made.
function outputOf(update: Update): string {
  const content = Array.isArray(update.content) ? update.content : [];
  const texts = content.map((c) => record(record(c).content)).filter((c) => c.type === "text").map((c) => str(c.text));
  if (texts.some(Boolean)) return texts.join("\n").trim();
  const raw = update.rawOutput;
  if (typeof raw === "string") return raw.trim();
  const rawText = str(record(raw).output);
  if (rawText) return rawText.trim();
  const diffs = content.map(record).filter((c) => c.type === "diff");
  return diffs.length ? `Wrote ${diffs.map((d) => str(d.path)).filter(Boolean).join(", ")}.` : "";
}

// A tool's update: nothing until it has finished, then its result and, for an edit that worked, the files it wrote.
function toolEnd(update: Update, cwd: string): AgyStep[] {
  const id = str(update.toolCallId);
  if (!id || (update.status !== "completed" && update.status !== "failed")) return [];
  const use = toolOf(update, cwd);
  const located = (Array.isArray(update.locations) ? update.locations : []).map((l) => str(record(l).path)).filter(Boolean);
  const files = update.kind === "edit" && update.status === "completed" ? [...new Set([...editedFiles(use), ...located])] : [];
  return [{ kind: "tool-end", id, use, outcome: { result: outputOf(update), isError: update.status === "failed" }, files }];
}

/** The thread steps in one session/update, given the card's folder for relative paths. */
export function agySteps(params: unknown, cwd: string): AgyStep[] {
  const update = record(record(params).update);
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = str(record(update.content).text);
      return text ? [{ kind: "text", text }] : [];
    }
    case "tool_call": {
      const id = str(update.toolCallId);
      return id ? [{ kind: "tool-start", id, use: toolOf(update, cwd) }] : [];
    }
    case "tool_call_update":
      return toolEnd(update, cwd);
    case "usage_update": {
      const used = Number(update.used);
      const size = Number(update.size);
      return Number.isFinite(used) && Number.isFinite(size) && size > 0 ? [{ kind: "context", used, size }] : [];
    }
    default:
      return [];
  }
}

/** A session/prompt answer's token counts, as Weft's result row takes them. */
export function agyUsage(result: unknown): CliUsage {
  const usage = record(record(result).usage);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { input: n(usage.inputTokens), output: n(usage.outputTokens) + n(usage.thoughtTokens), cacheRead: n(usage.cachedReadTokens), cacheWrite: n(usage.cachedWriteTokens) };
}

/** Why a turn ended, when it wasn't a plain finish: the error the result row shows, or undefined. */
export function agyStopError(result: unknown): string | undefined {
  const reason = str(record(result).stopReason);
  if (reason === "refusal") return "The model refused to continue this turn.";
  if (reason === "max_tokens") return "The model ran out of output tokens before it finished.";
  if (reason === "max_turn_requests") return "The turn hit agy's limit on model requests.";
  return undefined;
}

export const ANTIGRAVITY_EVENTS_CODE = [agySteps, agyUsage, agyStopError];
