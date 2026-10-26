import type { GuardEvent } from "./decide";
import { GUARD_TOKEN_ENV, GUARD_URL_ENV, type GuardCli } from "./turn";

// What Weft's guard route prints back to a CLI's hook, in that CLI's words, and the hook command itself.
//
// Codex 0.162 reads Claude Code's hook output: a PreToolUse permissionDecision of deny with its reason, or nothing to
// let the call go on to Codex's own sandbox; after a call, decision "block" with a reason the model is told, or
// additionalContext. Goose 1.56's plugin hooks read {"decision": "allow" | "block", "reason"}.

export type Answer = { allow: true; context?: string; feedback?: string } | { allow: false; reason: string };

export function cliAnswer(cli: GuardCli, event: GuardEvent, answer: Answer): Record<string, unknown> {
  if (cli === "goose") return answer.allow ? { decision: "allow" } : { decision: "block", reason: answer.reason };
  if (!answer.allow) {
    return event === "PreToolUse"
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: answer.reason } }
      : { decision: "block", reason: answer.reason };
  }
  if (event === "PreToolUse") return {};
  return {
    ...(answer.feedback ? { decision: "block", reason: answer.feedback } : {}),
    ...(answer.context ? { hookSpecificOutput: { hookEventName: event, additionalContext: answer.context } } : {}),
  };
}

export const UNANSWERED = "Weft's guards couldn't check this call (Weft's server didn't answer), so it was turned away. Try again in a moment.";

/**
 * The command a CLI's hook runs for one event: it posts the CLI's payload (on stdin) to Weft's guard route and prints
 * the answer. Inline, with no script file to lose or un-chmod mid-turn: Codex and Goose both let a call through when
 * their hook can't run. When Weft doesn't answer (server down, turn closed, timeout) it prints a refusal before a
 * call, so a guard that can't be asked is a no; after one it prints nothing to change. The route and token come from
 * the env the turn's guards put on the CLI, or are written in (`where`) for a CLI whose shell would show that env.
 */
export function hookCommand(cli: GuardCli, event: GuardEvent, where?: { url: string; token: string }): string {
  const fallback = event === "PreToolUse" ? JSON.stringify(cliAnswer(cli, event, { allow: false, reason: UNANSWERED })) : JSON.stringify(cliAnswer(cli, event, { allow: true }));
  // A token is base64url and the route a plain http://127.0.0.1 address, so neither needs escaping in double quotes.
  const url = `"${where ? where.url : `$${GUARD_URL_ENV}`}/${cli}/${event}"`;
  const token = where ? where.token : `$${GUARD_TOKEN_ENV}`;
  const post = `curl -sS --fail --max-time 3600 -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @- ${url} 2>/dev/null`;
  // The fallback goes in single quotes; a quote inside it closes, escapes and reopens them.
  const quoted = `'${fallback.replace(/'/g, `'\\''`)}'`;
  return `out=$(${post}); if [ -n "$out" ]; then printf '%s\\n' "$out"; else printf '%s\\n' ${quoted}; fi`;
}
