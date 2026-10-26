import { randomUUID } from "node:crypto";
import { askAboutCall } from "./ask";
import { cliAnswer, type Answer } from "./answer";
import { codexCalls, gooseCalls } from "./calls";
import { decide, type GuardCall, type GuardEvent } from "./decide";
import { guardTurn, type GuardCli, type GuardTurn } from "./turn";

// Weft's guard route's work (app/api/guards/[cli]/[event]): one hook call from a Codex or Goose turn, run through
// the turn's guard set, answered in the CLI's words. Before a call, a deny goes straight back to the model; an ask
// waits on the card for your answer (lib/guards/ask.ts), with the CLI's hook held open until then. Anything that goes
// wrong on the way refuses the call: a guard that can't decide is a no.

// Codex and Goose let a call through when their hook times out (Weft gives both an hour, lib/guards/codex.ts and
// lib/guards/goose.ts), so an ask nobody answers is refused a minute before that.
export const ASK_LIMIT_MS = 59 * 60_000;

const CLIS = new Set<GuardCli>(["codex", "goose"]);
const EVENTS = new Set<GuardEvent>(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

export function isGuardCli(cli: string): cli is GuardCli {
  return CLIS.has(cli as GuardCli);
}

export function isGuardEvent(event: string): event is GuardEvent {
  return EVENTS.has(event as GuardEvent);
}

function callsFor(cli: GuardCli, payload: unknown, event: GuardEvent): GuardCall[] {
  const calls = (cli === "codex" ? codexCalls : gooseCalls)(payload);
  // The folder gate and claims key what they ask by the call's id, so a call that came without one gets one.
  const id = randomUUID();
  return calls.filter((c) => c.event === event).map((c) => (c.id ? c : { ...c, id }));
}

async function before(turn: GuardTurn, calls: GuardCall[], signal: AbortSignal): Promise<Answer> {
  for (const call of calls) {
    const verdict = await decide(turn.hooks, call, signal);
    if (verdict.decision === "deny") return { allow: false, reason: verdict.reason };
    if (verdict.decision !== "ask") continue;
    const answer = await askAboutCall(turn.session, call.tool, call.input, call.id, AbortSignal.any([signal, AbortSignal.timeout(ASK_LIMIT_MS)]), verdict.reason);
    if (answer.behavior !== "allow") return { allow: false, reason: answer.message || "Denied in Weft." };
  }
  return { allow: true };
}

async function after(turn: GuardTurn, calls: GuardCall[], signal: AbortSignal): Promise<Answer> {
  const context: string[] = [];
  const feedback: string[] = [];
  for (const call of calls) {
    const verdict = await decide(turn.hooks, call, signal);
    if (verdict.decision !== "allow") continue;
    if (verdict.context) context.push(verdict.context);
    if (verdict.feedback) feedback.push(verdict.feedback);
  }
  return { allow: true, ...(context.length ? { context: context.join("\n\n") } : {}), ...(feedback.length ? { feedback: feedback.join("\n\n") } : {}) };
}

/** The CLI's answer to one hook call, or null for a token that names no open turn of that CLI. */
export async function answerHook(cli: GuardCli, event: GuardEvent, token: string | undefined, payload: unknown, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  const turn = guardTurn(token, cli);
  if (!turn) return null;
  const both = AbortSignal.any([signal, turn.session.abort.signal]);
  const calls = callsFor(cli, payload, event);
  try {
    return cliAnswer(cli, event, event === "PreToolUse" ? await before(turn, calls, both) : await after(turn, calls, both));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[guards] ${cli} ${event} failed:`, err);
    return cliAnswer(cli, event, event === "PreToolUse" ? { allow: false, reason: `Weft's guards failed on this call (${why}), so it was turned away.` } : { allow: true });
  }
}
