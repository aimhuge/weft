import { randomUUID } from "node:crypto";
import type { HookCallback, HookCallbackMatcher, Options, SDKMessage, SDKPermissionDenial } from "@anthropic-ai/claude-agent-sdk";
import { shortToolName, summarizeInput } from "./format";
import { hooks, safeUpdate, type Pending, type Session } from "./runner-state";
import { pendingView } from "./runner-pending";
import { appendThread, replaceThreadItem } from "./store";
import type { Column } from "./types";

// Auto mode's classifier denies some calls itself (a migration it reads as a production deploy, say):
// the CLI never calls canUseTool for them, so without this the card showed nothing while the thread
// said "approve it". The SDK has no option that sends a classifier denial on to canUseTool (only the
// calls it can't decide on go there), but it reports each one as a system/permission_denied message.
// Weft notes those during the turn and, when the turn ends, asks about each on the card in Needs you:
// "Allow once and retry" grants that exact call once and sends the thread a message to retry it; "Keep denied"
// leaves it denied (docs/architecture/thread-guards.md). The grant answers the retry from a PreToolUse allow, which
// skips the classifier, or from canUseTool. But auto mode marks some calls classifier-only: then hook allows and
// allow rules don't count, and a classifier that gives no verdict ("it skipped this action") denies them with no
// prompt fallback. So for the retry the live CLI steps out of auto mode into default, where the call reaches
// canUseTool (lib/guards/ask.ts) and the grant allows it; it steps back once the grant is used or the turn ends.

export interface ClassifierDenial {
  toolUseId: string;
  toolName: string;
  reason: string;
}

type DeniedMessage = Extract<SDKMessage, { type: "system"; subtype: "permission_denied" }>;

// A permission_denied message from the classifier, kept on the session until the turn ends.
export function noteDenial(session: Session, msg: DeniedMessage) {
  if (msg.decision_reason_type !== "classifier" || msg.agent_id) return;
  const reason = (msg.decision_reason || msg.message || "").trim();
  (session.denials ??= []).push({ toolUseId: msg.tool_use_id, toolName: msg.tool_name, reason });
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
export function askAboutDenials(cardId: string, session: Session, denials: SDKPermissionDenial[], column: Column, ask = true): boolean {
  const noted = session.denials ?? [];
  session.denials = undefined;
  // A grant the last retry didn't use is spent: it was for that turn only.
  session.retryGrants = undefined;
  backToAuto(session);
  if (!ask) return false;
  const seen = new Set<string>();
  for (const d of noted) {
    const input = denials.find((x) => x.tool_use_id === d.toolUseId)?.tool_input ?? {};
    const key = callKey(d.toolName, input);
    if (seen.has(key)) continue;
    seen.add(key);
    session.pending.push(denialPrompt(cardId, session, d, input, column));
  }
  const first = session.pending[0];
  if (!first) return false;
  safeUpdate(cardId, { column: "needs_you", pending: pendingView(first), lastLine: first.title });
  return true;
}

function denialPrompt(cardId: string, session: Session, d: ClassifierDenial, input: Record<string, unknown>, column: Column): Pending {
  const summary = summarizeInput(input);
  const title = `Auto mode blocked ${shortToolName(d.toolName)}${summary ? `: ${summary}` : ""}`;
  const id = randomUUID();
  const index = appendThread(cardId, { kind: "permission", id, toolName: d.toolName, title, at: Date.now() });
  const why = { category: "classifier" as const, detail: d.reason || "Auto mode's classifier denied this call" };
  return {
    id, index, toolName: d.toolName, title, input, why,
    // settle() (lib/runner-pending.ts) marks the thread item and calls this with the user's answer.
    // Once the last of them is answered: the thread retries what was allowed, or the card goes back where it was.
    resolve: (result) => {
      if (result.behavior === "allow") (session.retryGrants ??= []).push(callKey(d.toolName, input));
      if (session.pending.length) return;
      const granted = session.retryGrants ?? [];
      if (!granted.length) {
        safeUpdate(cardId, { column, pending: null, lastLine: `Kept denied: ${title}` });
        return;
      }
      stepOutOfAuto(session);
      try {
        hooks.send(cardId, retryMessage(granted.map((key) => key.slice(0, key.indexOf("\n")))));
      } catch (err) {
        safeUpdate(cardId, { column, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

// What the thread is told to do once you allowed one or more blocked calls.
export function retryMessage(toolNames: string[]) {
  const names = [...new Set(toolNames.map(shortToolName))].join(", ");
  const calls = toolNames.length === 1 ? "call" : "calls";
  return `I allowed the ${names} ${calls} that auto mode's classifier blocked, once, in Weft. Retry exactly that ${calls} now, with the same input; Weft lets ${toolNames.length === 1 ? "it" : "them"} through this one time.`;
}

// A granted retry, used up by the call it matches.
export function takeGrant(session: Session, toolName: string, input: unknown): boolean {
  const at = session.retryGrants?.indexOf(callKey(toolName, input)) ?? -1;
  if (at === -1) return false;
  session.retryGrants?.splice(at, 1);
  if (!session.retryGrants?.length) backToAuto(session);
  return true;
}

// The live CLI leaves auto mode for the retry, so a classifier-only call asks canUseTool instead of being denied.
// The card's own mode (spec.permissionMode) stays as it was.
function stepOutOfAuto(session: Session) {
  if (session.spec.permissionMode !== "auto" || !session.query) return;
  session.retryOutOfAuto = true;
  void session.query.setPermissionMode("default").catch(() => {});
}

// Back to the card's mode (auto, or whatever you switched it to meanwhile).
function backToAuto(session: Session) {
  if (!session.retryOutOfAuto) return;
  session.retryOutOfAuto = undefined;
  void session.query?.setPermissionMode(session.spec.permissionMode).catch(() => {});
}

// A new message from the user moves on from the prompts: they replied instead of clicking.
export function dropDenialPrompts(cardId: string, session: Session) {
  session.pending = session.pending.filter((p) => {
    if (p.why?.category !== "classifier") return true;
    replaceThreadItem(cardId, p.index, { kind: "permission", id: p.id, toolName: p.toolName, title: p.title, decision: "deny", at: Date.now() });
    return false;
  });
}

// The PreToolUse hook that lets a granted retry through before the classifier sees it. Deny hooks still win.
// Out of auto mode it stays out of the way, so the retry reaches canUseTool and the grant is used there.
type Guarded = Pick<Options, "env" | "hooks">;

export function withRetryGrant(guarded: Guarded, session: Session): Guarded {
  const allow: HookCallback = (input) => {
    if (input.hook_event_name !== "PreToolUse" || session.retryOutOfAuto || !takeGrant(session, input.tool_name, input.tool_input)) return Promise.resolve({});
    return Promise.resolve({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Allowed once in Weft after auto mode blocked it" },
    });
  };
  const matcher: HookCallbackMatcher = { hooks: [allow] };
  return { ...guarded, hooks: { ...guarded.hooks, PreToolUse: [...(guarded.hooks?.PreToolUse ?? []), matcher] } };
}
