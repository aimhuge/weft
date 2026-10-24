// What a thread's turn means for its card: the questions it asks, how its result reads, where the card
// goes after it, what it cost and how close the plan is to its limits. Pure, so runner.ts keeps only
// the SDK loop and the store writes.
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { asText } from "./format";
import { extractReview } from "./review";
import { extractStatus, type BoardStatus } from "./status";
import type { CacheState, CardStats, Column, LimitWindow, Question } from "./types";

// The questions from an AskUserQuestion call, cleaned up for the board.
export function readQuestions(input: Record<string, unknown>): Question[] | undefined {
  if (!Array.isArray(input.questions)) return undefined;
  const questions = input.questions
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      question: asText(q.question),
      header: typeof q.header === "string" ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object")
        .map((o) => ({
          label: asText(o.label),
          description: typeof o.description === "string" ? o.description : undefined,
          ...(typeof o.preview === "string" && o.preview.trim() ? { preview: o.preview } : {}),
        }))
        .filter((o) => o.label),
    }))
    .filter((q) => q.question);
  return questions.length ? questions : undefined;
}

export interface TurnResult {
  subtype: string; // "success", or why the turn ended early ("error_max_turns", …)
  result?: string; // the final reply, on success
  isError: boolean;
  stopped: boolean; // you stopped the turn
}

// How a finished turn reads on the card: the reply without its status and review blocks, "Stopped", or
// why it ended early. A stopped turn is never an error.
export function readResult(turn: TurnResult): { summary: string; isError: boolean; status?: BoardStatus } {
  const ended = `Ended early: ${turn.subtype.replace(/_/g, " ")}`;
  // A runner like codex or puku sometimes sends the CLI's error message in `result` (a usage-limit
  // notice, a rate-limit reason, an auth failure); surface it so the user can act, not just "error execution".
  const errorDetail = turn.result?.trim();
  const parsed =
    turn.subtype === "success"
      ? (({ text, status }) => ({ text: extractReview(text).text, status }))(extractStatus(turn.result ?? ""))
      : errorDetail
      ? { text: `${ended}\n\n${errorDetail}`, status: undefined }
      : { text: ended, status: undefined };
  return { summary: turn.stopped ? "Stopped" : parsed.text, isError: !turn.stopped && turn.isError, status: parsed.status };
}

// Where the card goes when a turn ends: Review after a stop or an error, else wherever the thread's
// status line asked for, else Review. A wrap-up (/done, or a move to Done's automations) that ends
// asking for something is still a finished wrap-up, so it goes to Done and is filed away rather
// than parked in Needs you waiting for a reply nobody asked for.
export function columnAfterTurn(
  stopped: boolean,
  isError: boolean,
  status: BoardStatus | undefined,
  wrappingUp = false,
): Column {
  if (stopped || isError) return "review";
  if (status?.column === "needs_you" && wrappingUp) return "done";
  return status?.column ?? "review";
}

// Totals are cumulative within a CLI process. A resumed session usually starts from its saved total;
// when it doesn't, this process's totals are added to what the card had before. The base is fixed by
// the process's first result and kept after that.
export function turnCost(previous: number, total: number, base: number | undefined) {
  const nextBase = base ?? (total >= previous ? 0 : previous);
  return { base: nextBase, costUsd: nextBase + total };
}

// A rate-limit event's window; utilization is a fraction there.
export function eventWindow(info: { utilization?: number; resetsAt?: number }): LimitWindow | undefined {
  return info.utilization === undefined ? undefined : { used: Math.round(info.utilization * 100), resetsAt: info.resetsAt };
}

// A window from the CLI's usage report; utilization is a percentage there and the reset an ISO date.
export function usageWindow(w?: { utilization: number | null; resets_at: string | null } | null): LimitWindow | undefined {
  return w?.utilization == null ? undefined : { used: Math.round(w.utilization), resetsAt: w.resets_at ? Date.parse(w.resets_at) / 1000 : undefined };
}

// One API request's usage, as the assistant message carries it.
export interface RequestUsage {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
}

// The prompt cache after a request. Its lifetime is read from what the request wrote: an hour for the
// 1-hour cache, five minutes for the 5-minute one, else the lifetime seen before (five minutes at first).
export function cacheAfter(u: RequestUsage | undefined, at: number, previousTtl = 300): CacheState | undefined {
  if (!u) return undefined;
  const read = u.cache_read_input_tokens ?? 0;
  const tokens = (u.input_tokens ?? 0) + read + (u.cache_creation_input_tokens ?? 0);
  if (!tokens) return undefined;
  const written = u.cache_creation;
  const ttl = written?.ephemeral_1h_input_tokens ? 3600 : written?.ephemeral_5m_input_tokens ? 300 : previousTtl;
  return { at, ttl, hit: Math.round((read / tokens) * 100), tokens };
}

// The model that cost the most this turn, how full its context is, and the turn's tokens.
export function modelStats(modelUsage: Record<string, ModelUsage> | undefined, contextTokens: number | undefined): Pick<CardStats, "model" | "contextUsed" | "tokens"> {
  const models = Object.entries(modelUsage ?? {});
  const [model, main] = models.sort((a, b) => b[1].costUSD - a[1].costUSD)[0] ?? [];
  const tokens = models.reduce((sum, [, u]) => sum + u.inputTokens + u.outputTokens, 0);
  const contextUsed =
    main?.contextWindow && contextTokens ? Math.min(100, Math.round((contextTokens / main.contextWindow) * 100)) : undefined;
  return { model, contextUsed, tokens: tokens || undefined };
}
