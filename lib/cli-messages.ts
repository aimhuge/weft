import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { touchFile } from "./overlap";
import { handle } from "./runner-turn";
import { redactStored } from "./secret-run";
import { getCard, getThread, replaceThreadItem, updateCard } from "./store";
import type { Session } from "./runner-state";

// The thread rows a CLI outside the Agent SDK produces, as the SDK messages lib/runner-turn.ts already knows how to
// file (docs/architecture/cli-adapters.md). Codex, Goose and Antigravity speak different streams, but each one ends up
// as the same few things: a reply, a tool starting, a tool's result, the files it touched, and the turn's result.

export type ToolUse = { name: string; input: Record<string, unknown> };
export type ToolOutcome = { result: string; isError: boolean };
export type CliUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function sdkMessage(message: unknown) {
  return message as SDKMessage;
}

/**
 * Text a CLI produced, with any vault value the card used swapped for ‹NAME› before it's filed. A CLI's rows are text
 * and tool steps, never the SDK tool results lib/runner-turn.ts redacts on its own, so it's done here.
 */
export function scrub(session: Session, text: string): Promise<string> {
  return session.cardId ? redactStored(session.cardId, text) : Promise.resolve(text);
}

/** The assistant's text, as a row in the thread, filed under `model`. */
export async function fileReply(session: Session, raw: string, model: string, idPrefix: string): Promise<void> {
  const text = await scrub(session, raw);
  await handle(session.cardId as string, session, sdkMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: `${idPrefix}-${Date.now()}`, type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: null, stop_sequence: null, usage: NO_USAGE },
  }));
}

/** A tool the CLI started, as a tool row; a second start for the same id draws nothing. */
export async function fileToolStart(session: Session, id: string, use: ToolUse, model: string, idPrefix: string): Promise<void> {
  if (!id || session.toolIndex.has(id)) return;
  await handle(session.cardId as string, session, sdkMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: `${idPrefix}-${id}`, type: "message", role: "assistant", model, content: [{ type: "tool_use", id, ...use }], stop_reason: null, stop_sequence: null, usage: NO_USAGE },
  }));
}

/** A tool's result, written onto the row its start drew. A result with no row (its start never came) is dropped. */
export async function fileToolResult(session: Session, id: string, outcome: ToolOutcome): Promise<void> {
  const index = session.toolIndex.get(id);
  if (index === undefined || !session.cardId) return;
  const row = getThread(session.cardId)[index];
  if (row?.kind !== "tool") return;
  const result = await scrub(session, outcome.result);
  replaceThreadItem(session.cardId, index, { ...row, result, isError: outcome.isError });
}

/** The turn's result: Done (or the reply it ended on), or the error it failed with, with the tokens it used. */
export async function fileResult(session: Session, model: string, outcome: { text?: string; error?: string; usage?: CliUsage }): Promise<void> {
  const id = session.cardId;
  if (!id) return;
  const usage = outcome.usage ?? {};
  const summary = await scrub(session, outcome.error ?? (outcome.text || "Done."));
  await handle(id, session, sdkMessage({
    type: "result",
    subtype: outcome.error ? "error_execution" : "success",
    is_error: Boolean(outcome.error),
    result: summary,
    session_id: session.sessionId ?? session.spec.sessionId ?? "",
    total_cost_usd: 0,
    modelUsage: {
      [model]: {
        inputTokens: usage.input ?? 0,
        outputTokens: usage.output ?? 0,
        cacheReadInputTokens: usage.cacheRead ?? 0,
        cacheCreationInputTokens: usage.cacheWrite ?? 0,
        webSearchRequests: 0,
        costUSD: 0,
        contextWindow: 0,
        maxOutputTokens: 0,
      },
    },
  }));
}

/** Whether a path sits inside a folder: the folder itself, or somewhere under it. */
export function insideFolder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

/**
 * The files a turn touched, so the card's overlap warning knows them (lib/overlap.ts). Only files inside the card's
 * own folder count, checked on the resolved path: one that climbs out with ".." or sits elsewhere isn't the card's.
 */
export function noteTouched(session: Session, paths: string[]): void {
  const id = session.cardId;
  if (!id) return;
  const root = path.resolve(session.spec.cwd);
  for (const file of paths) {
    if (!file) continue;
    const absolute = path.resolve(root, file);
    if (!insideFolder(absolute, root)) continue;
    const touched = touchFile(getCard(id)?.touchedFiles, absolute);
    if (touched) updateCard(id, { touchedFiles: touched });
  }
}

/** The session's id from the CLI, kept on the session and the card so the next start resumes it. */
export function keepSessionId(session: Session, sessionId: string): void {
  if (!sessionId || session.sessionId === sessionId) return;
  session.sessionId = sessionId;
  if (session.cardId) updateCard(session.cardId, { sessionId });
}

/** How a CLI's stderr reaches Weft's log, tagged with the card it came from. */
export function stderrLogger(session: Session): (data: string) => void {
  return (data: string) => console.error(`[thread ${(session.cardId ?? "spare").slice(0, 8)}] ${data.trimEnd()}`);
}

export const CLI_MESSAGES_CODE = [scrub, fileReply, fileToolStart, fileToolResult, fileResult, insideFolder, noteTouched, keepSessionId, stderrLogger];
