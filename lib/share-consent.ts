// The consent gate on mcp__board__share_card (lib/share-tool.ts, docs/architecture/sharing.md#share_card-a-thread-shares-its-own-card).
// Publishing a card is outward-facing: a public link can be cached or indexed the moment it exists. So the first public
// share of a card always asks the user, in every permission mode, bypassPermissions included: a PreToolUse "ask" sends
// the call to the card's permission prompt whatever the mode (as the folder gate does, lib/folder-guard.ts). Once the
// user allows it, the tool stamps card.shareConsent and later calls on that card (a new lead page, the chat switch)
// go through without asking. Taking a link private is never outward-facing, so it never asks.
//
// One confirmation per card, not a setting: a setting would let every future thread publish unasked, and the user
// asked never to publish silently on the first use.
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { getCard } from "./store";
import type { Card } from "./types";

export const SHARE_TOOL_NAME = "mcp__board__share_card";

export type ShareDecision = "allow" | "ask";

export function shareDecision(card: Pick<Card, "shareConsent"> | undefined, input: Record<string, unknown>): ShareDecision {
  if (input.public === false) return "allow";
  return card?.shareConsent ? "allow" : "ask";
}

// What the prompt asks, in the user's words.
export function shareQuestion(input: Record<string, unknown>): string {
  const chat = input.show_chat === true ? "with this thread's chat" : "the browser pane only, chat hidden";
  return `Publish this card at a public weft.zip link (${chat})? Asked once per card.`;
}

function gate(cardId: () => string | undefined): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== SHARE_TOOL_NAME) return Promise.resolve({});
    const args = (input.tool_input ?? {}) as Record<string, unknown>;
    const decision = shareDecision(getCard(cardId() ?? ""), args);
    const reason = decision === "ask" ? shareQuestion(args) : "This card's share was allowed before.";
    return Promise.resolve({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: decision, permissionDecisionReason: reason } });
  };
}

// For lib/guards/hooks.ts: the session's card id, read at each call, since a warm spare gets its card later.
export function shareConsentMatcher(cardId: () => string | undefined): HookCallbackMatcher {
  return { matcher: SHARE_TOOL_NAME, hooks: [gate(cardId)] };
}
