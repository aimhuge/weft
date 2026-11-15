import { randomUUID } from "node:crypto";
import type { HookCallback, Options, PermissionResult, SDKMessage, SDKPermissionDenial } from "@anthropic-ai/claude-agent-sdk";
import { shortToolName, summarizeInput } from "./format";
import { hooks, safeUpdate, type Pending, type Session } from "./runner-state";
import { pendingView } from "./runner-pending";
import { backToAuto, retried, stepOut, untilBackInAuto } from "./retry-window";
import { appendThread, replaceThreadItem } from "./store";
import type { Column } from "./types";
import { grantButton, grantScope, grantWrites, writeGranted } from "./write-grant";
import { scopeLabel, type WriteScope } from "./write-scope";

// Auto mode's classifier denies some calls itself (a migration it reads as a production deploy, say):
// the CLI never calls canUseTool for them, so without this the card showed nothing while the thread
// said "approve it". The SDK has no option that sends a classifier denial on to canUseTool (only the
// calls it can't decide on go there), but it reports each one as a system/permission_denied message.
// Weft notes those during the turn and, when the turn ends, asks about each on the card in Needs you:
// "Allow once and retry" grants that exact call once and sends the thread a message to retry it; "Keep denied"
// leaves it denied (docs/architecture/thread-guards.md). The grant answers the retry from a PreToolUse allow. In auto
// mode the CLI sends some hook allows on to the classifier anyway (an MCP tool's), so the granted call's own hook
// steps the live CLI out of auto mode for just that call (lib/retry-window.ts); the session never sits in default
// mode, where every path outside the cwd asks, while other calls and background subagents run.

export interface ClassifierDenial {
  toolUseId: string;
  toolName: string;
  reason: string;
  // The thread got past it later in the turn: it asked you itself, or a later call of the same tool ran.
  passed?: boolean;
}

type DeniedMessage = Extract<SDKMessage, { type: "system"; subtype: "permission_denied" }>;

// A permission_denied message from the classifier, kept on the session until the turn ends.
export function noteDenial(session: Session, msg: DeniedMessage) {
  if (msg.decision_reason_type !== "classifier" || msg.agent_id) return;
  const reason = (msg.decision_reason || msg.message || "").trim();
  (session.denials ??= []).push({ toolUseId: msg.tool_use_id, toolName: msg.tool_name, reason });
}

// A tool call the thread made after a denial this turn. Asking you (AskUserQuestion) hands the decision to you,
// so every denial before it is past; any other call is remembered until its result says whether it ran.
export function noteToolUse(session: Session, toolUseId: string, toolName: string) {
  if (!session.denials?.length) return;
  if (toolName === "AskUserQuestion") for (const d of session.denials) d.passed = true;
  else (session.sinceDenial ??= new Map()).set(toolUseId, toolName);
}

// A tool result: when a call made after a denial ran without an error, the thread found another way through
// with the same tool (the deletion the classifier blocked, run as a slightly different command).
export function noteToolResult(session: Session, toolUseId: string, isError: boolean) {
  const since = session.sinceDenial ?? new Map<string, string>();
  const toolName = since.get(toolUseId);
  if (!toolName) return;
  since.delete(toolUseId);
  if (isError) return;
  for (const d of session.denials ?? []) if (d.toolName === toolName) d.passed = true;
}

// One stable key per call, so a retry with the same input matches whatever order its keys come in.
export function callKey(toolName: string, input: unknown): string {
  return `${toolName}\n${JSON.stringify(sorted(input))}`;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])]));
}

// The turn ended: unless it was stopped (ask false), each classifier denial becomes a prompt on the card,
// which goes to Needs you. column is where the turn left the card, for "Keep denied". Returns whether any did.
// A denial the thread got past isn't asked about when the turn ended in Review or Done: asking would only grant
// a call nothing needs any more. One that ended in Needs you still asks: the thread may be waiting on it.
export function askAboutDenials(cardId: string, session: Session, denials: SDKPermissionDenial[], column: Column, ask = true): boolean {
  const stuck = column === "needs_you";
  const noted = (session.denials ?? []).filter((d) => stuck || !d.passed);
  session.denials = undefined;
  session.sinceDenial = undefined;
  // A grant the last retry didn't use is spent: it was for that turn only.
  session.retryGrants = undefined;
  void backToAuto(session);
  if (!ask) return false;
  for (const block of blocks(session, noted, denials)) session.pending.push(denialPrompt(cardId, session, block, column));
  const first = session.pending[0];
  if (!first) return false;
  safeUpdate(cardId, { column: "needs_you", pending: pendingView(first), lastLine: first.title });
  return true;
}

// What one prompt asks about: a blocked call, with any other blocked writes into the same skill folder or
// settings file folded in (so a skill built over six files asks once, not six times), and the scope allowing it grants.
interface Block {
  denial: ClassifierDenial;
  input: Record<string, unknown>;
  keys: string[];
  scope?: WriteScope;
}

function blocks(session: Session, noted: ClassifierDenial[], denials: SDKPermissionDenial[]): Block[] {
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const denial of noted) {
    const input = denials.find((x) => x.tool_use_id === denial.toolUseId)?.tool_input ?? {};
    const key = callKey(denial.toolName, input);
    if (seen.has(key)) continue;
    seen.add(key);
    const scope = grantScope(session, denial.toolName, input);
    const same = scope && out.find((b) => b.scope?.path === scope.path);
    if (same) same.keys.push(key);
    else out.push({ denial, input, keys: [key], scope });
  }
  return out;
}

function denialPrompt(cardId: string, session: Session, block: Block, column: Column): Pending {
  const { denial: d, input, keys, scope } = block;
  const summary = summarizeInput(input);
  const title = scope && keys.length > 1 ? `Auto mode blocked ${keys.length} writes to ${scopeLabel(scope)}` : `Auto mode blocked ${shortToolName(d.toolName)}${summary ? `: ${summary}` : ""}`;
  const id = randomUUID();
  const index = appendThread(cardId, { kind: "permission", id, toolName: d.toolName, title, at: Date.now() });
  const why = { category: "classifier" as const, detail: d.reason || "Auto mode's classifier denied this call", ...(scope ? { grant: grantButton(scope) } : {}) };
  return {
    id, index, toolName: d.toolName, title, input, why,
    // settle() (lib/runner-pending.ts) marks the thread item and calls this with the user's answer.
    // Once the last of them is answered: the thread retries what was allowed, or the card goes back where it was.
    resolve: (result) => {
      if (result.behavior === "allow") {
        (session.retryGrants ??= []).push(...keys);
        if (scope) grantWrites(cardId, scope);
      }
      if (session.pending.length) return;
      const granted = session.retryGrants ?? [];
      if (!granted.length) {
        safeUpdate(cardId, { column, pending: null, lastLine: `Kept denied: ${title}` });
        return;
      }
      try {
        hooks.send(cardId, retryMessage(granted.map((key) => key.slice(0, key.indexOf("\n"))), scope && result.behavior === "allow" ? [scopeLabel(scope)] : []));
      } catch (err) {
        safeUpdate(cardId, { column, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// What the thread is told to do once you allowed one or more blocked calls.
// scopes: what the allow also granted the card for good ("the research skill"), so the thread knows later writes there go through.
export function retryMessage(toolNames: string[], scopes: string[] = []) {
  const names = [...new Set(toolNames.map(shortToolName))].join(", ");
  const calls = toolNames.length === 1 ? "call" : "calls";
  const standing = scopes.length ? ` Weft also lets this card write to ${scopes.join(" and ")} from now on without asking (except changes to permissions).` : "";
  return `I allowed the ${names} ${calls} that auto mode's classifier blocked, once, in Weft. Retry exactly that ${calls} now, with the same input; Weft lets ${toolNames.length === 1 ? "it" : "them"} through this one time. If you already got what ${toolNames.length === 1 ? "it was" : "they were"} for another way, don't run ${toolNames.length === 1 ? "it" : "them"} again: say so and carry on.${standing}`;
}

// A granted retry, used up by the call it matches.
export function takeGrant(session: Session, toolName: string, input: unknown): boolean {
  const at = session.retryGrants?.indexOf(callKey(toolName, input)) ?? -1;
  if (at === -1) return false;
  session.retryGrants?.splice(at, 1);
  return true;
}

// The retry goes to whichever CLI runs the card's next message, and that may not be the one you answered on: a
// session left from an older build or prompts, or whose CLI ended, is swapped for a new one (lib/runner.ts
// sessionFor). The grants go with the card, or the retry meets auto mode's classifier again with nothing to let it by.
export function carryGrants(from: Session | undefined, to: Session) {
  if (!from || from === to || !from.retryGrants?.length) return;
  to.retryGrants = [...(to.retryGrants ?? []), ...from.retryGrants];
  from.retryGrants = undefined;
}

// What canUseTool (lib/guards/ask.ts) answers for a call while the CLI is out of auto mode, or null when it isn't
// its to answer. The granted call is allowed (an ask rule can still send it there); any other call that got
// decided in default mode, its hook having run just before the window opened, is turned back to be run again in
// auto mode instead of asking you about something auto mode may well have allowed.
export function outOfAutoAnswer(session: Session, toolName: string, input: Record<string, unknown>, toolUseId: string): PermissionResult | null {
  if (takeGrant(session, toolName, input) || writeGranted(session, toolName, input) || session.retryWindow?.ids.has(toolUseId)) return { behavior: "allow", updatedInput: input };
  if (!session.retryWindow) return null;
  return { behavior: "deny", message: "Weft stepped out of auto mode for a moment to let a call you allowed through, so this call wasn't checked. Run it again now." };
}

// A new message from the user moves on from the prompts: they replied instead of clicking.
export function dropDenialPrompts(cardId: string, session: Session) {
  session.pending = session.pending.filter((p) => {
    if (p.why?.category !== "classifier") return true;
    replaceThreadItem(cardId, p.index, { kind: "permission", id: p.id, toolName: p.toolName, title: p.title, decision: "deny", at: Date.now() });
    return false;
  });
}

// The PreToolUse hook that lets a granted retry through. Deny hooks still win. In auto mode it first steps the CLI
// out for that call, so the allow counts; every other call waits here until the CLI is back in auto mode. The
// PostToolUse hooks close the window once the granted call has run.
type Guarded = Pick<Options, "env" | "hooks">;

export function withRetryGrant(guarded: Guarded, session: Session): Guarded {
  const allow: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const tool = input.tool_input as Record<string, unknown>;
    if (!takeGrant(session, input.tool_name, tool) && !writeGranted(session, input.tool_name, tool)) {
      await untilBackInAuto(session);
      return {};
    }
    await stepOut(session, input.tool_use_id);
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Allowed in Weft after auto mode blocked it" },
    };
  };
  const ran: HookCallback = (input) => {
    if (input.hook_event_name === "PostToolUse" || input.hook_event_name === "PostToolUseFailure") retried(session, input.tool_use_id);
    return Promise.resolve({});
  };
  const h = guarded.hooks;
  return {
    ...guarded,
    hooks: {
      ...h,
      PreToolUse: [...(h?.PreToolUse ?? []), { hooks: [allow] }],
      PostToolUse: [...(h?.PostToolUse ?? []), { hooks: [ran] }],
      PostToolUseFailure: [...(h?.PostToolUseFailure ?? []), { hooks: [ran] }],
    },
  };
}
