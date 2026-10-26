import { clashQuestion, clashWhy, findClash, splitClaim, WHOLE_FILE } from "./claims";
import { getCard, listCards } from "./store";
import type { Card, PromptReason } from "./types";
import { pruneYields } from "./yields";

// The one claim flow, for every tool that writes files: an edit (lib/claim-guard.ts) and a Bash line
// (lib/bash-claims.ts) differ only in how the claim keys are worked out. The steps are the same: read
// the card, prune the yields that no longer hold, look for a clash with another busy card in the tree,
// ask the user when there is one, and remember what was asked, so the prompt can be titled with it.

// What each pending tool call will claim and, when it clashed, the question it asked, by tool use id,
// from PreToolUse to PostToolUse (or to canUseTool for the question). Denied calls never reach
// PostToolUse, so the oldest go past PENDING_CAP.
const PENDING_CAP = 200;
const pending = new Map<string, { keys: string[]; question?: string; why?: PromptReason }>();

export function remember(id: string, keys: string[], question?: string, why?: PromptReason) {
  pending.set(id, { keys, question, why });
  if (pending.size > PENDING_CAP) pending.delete(pending.keys().next().value as string);
}

// A Bash call that asked keeps nothing for the edit recorder: lib/bash-claims.ts drops it once it has run.
export function forget(id: string) {
  pending.delete(id);
}

// What a pending tool call will claim, and what it asked about.
export function pendingEntry(toolUseId: string | undefined) {
  return toolUseId ? pending.get(toolUseId) : undefined;
}

// The clash question for a tool call the hook asked about, for the permission prompt's title.
export function claimQuestion(toolUseId: string | undefined) {
  return toolUseId ? pending.get(toolUseId)?.question : undefined;
}

// Why the hook asked: who holds the clashing claim and what going ahead risks, for under the prompt's title.
export function claimWhy(toolUseId: string | undefined) {
  return toolUseId ? pending.get(toolUseId)?.why : undefined;
}

// The symbols a pending tool call edits, for the permission prompt's preview (lib/edit-preview.ts);
// undefined when the hook didn't see it or it claims the whole file.
export function claimSymbols(toolUseId: string | undefined) {
  const keys = toolUseId ? pending.get(toolUseId)?.keys : undefined;
  const symbols = keys?.map((k) => splitClaim(k).symbol);
  return symbols?.length && !symbols.includes(WHOLE_FILE) ? symbols : undefined;
}

// The answer a hook gives when it puts a question to the user.
export const ask = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: reason } });

export interface ClaimPreResult {
  // The card the call belongs to; nothing when it is gone.
  card?: Card;
  // The claims the call takes.
  keys: string[];
  // The clash another busy card holds, and the question it puts to the user.
  question?: string;
  why?: PromptReason;
}

// The PreToolUse half of the claim flow: the card, its claims, and the clash to ask about.
export async function claimPreHook(cardId: string | undefined, keysFor: () => Promise<string[]> | string[]): Promise<ClaimPreResult> {
  const card = cardId ? getCard(cardId) : undefined;
  if (!card) return { keys: [] };
  const keys = await keysFor();
  if (!keys.length) return { card, keys };
  pruneYields();
  const clash = findClash(listCards(), card, keys);
  return { card, keys, ...(clash ? { question: clashQuestion(clash), why: clashWhy(clash) } : {}) };
}

// What the PreToolUse half answers: the question to put to the user, and what to remember for the
// prompt's title. The keys are remembered too, so an edit's symbols reach the prompt's preview.
export function claimPreAnswer(out: ClaimPreResult, toolUseId: string, keys = out.keys) {
  remember(toolUseId, keys, out.question, out.why);
  return out.question ? ask(out.question) : {};
}

// The PostToolUse half of the claim flow: the card the call belonged to, or nothing when it is gone.
// The caller then does its own recording (the edit's claims, the Bash line's written files).
export function claimPostCard(cardId: string | undefined): Card | undefined {
  return cardId ? getCard(cardId) : undefined;
}
