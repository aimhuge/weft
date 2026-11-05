import type { HookCallbackMatcher, HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { GuardHooks } from "./hooks";

// The CLI-neutral half of Weft's guards (docs/architecture/thread-guards.md): one tool call in, one verdict out,
// from the same guard set Claude Code and puku-cli run in-process (lib/guards/hooks.ts). Codex's and Goose's own
// hooks send each call here through Weft's guard route (lib/guards/hook.ts), already put into Claude Code's
// tool names and fields (lib/guards/calls.ts), so every guard reads the call exactly as it does on Claude Code.

export type GuardEvent = "PreToolUse" | "PostToolUse" | "PostToolUseFailure";

export type GuardCall = {
  event: GuardEvent;
  /** Claude Code's name for the tool: Bash, Read, Edit, Write, LS, Grep, or an mcp__server__tool. */
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
  /** The CLI's id for this call, the same before and after it runs, so a claim asked about is the one recorded. */
  id: string;
  /** After the call: what it returned, or why it failed. */
  response?: unknown;
  error?: string;
};

/**
 * What the guards make of a call. allow: run it. deny: turn it away and tell the model why. ask: the user decides,
 * on the card, before it runs (the folder gate, a symbol claim). After a call, `feedback` is what the model must
 * be told (an edit that broke an import) and `context` what it should know (a failed check is another card's).
 */
export type Verdict =
  | { decision: "allow"; context?: string; feedback?: string }
  | { decision: "deny"; reason: string }
  | { decision: "ask"; reason: string };

// A hook matcher as Claude Code reads it: none or "*" is every tool, plain names joined by | are those names,
// anything else is a regular expression over the whole name.
export function matches(matcher: string | undefined, tool: string): boolean {
  if (!matcher || matcher === "*") return true;
  if (/^[\w|]+$/.test(matcher)) return matcher.split("|").includes(tool);
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return false;
  }
}

function hookInput(call: GuardCall): HookInput {
  const base = { session_id: "", transcript_path: "", cwd: call.cwd, tool_name: call.tool, tool_input: call.input, tool_use_id: call.id };
  if (call.event === "PostToolUseFailure") return { ...base, hook_event_name: "PostToolUseFailure", error: call.error ?? "" };
  if (call.event === "PostToolUse") return { ...base, hook_event_name: "PostToolUse", tool_response: call.response };
  return { ...base, hook_event_name: "PreToolUse" };
}

type Said = { decision?: string; reason?: string; context?: string };

// A hook that returns nothing (its type says it can't, but JavaScript hooks do) said nothing.
function read(out: HookJSONOutput | undefined): Said {
  if (!out || "async" in out) return {};
  const specific = (out.hookSpecificOutput ?? {}) as { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string };
  return {
    decision: specific.permissionDecision ?? (out.decision === "block" ? "block" : undefined),
    reason: specific.permissionDecisionReason ?? out.reason,
    context: specific.additionalContext,
  };
}

/**
 * Runs every hook of the call's event whose matcher takes its tool, in order (a claim's Pre hook keeps what its Post
 * hook records), and folds what they said the way the Agent SDK does: any deny wins, then any ask, then allow.
 */
export async function decide(hooks: GuardHooks, call: GuardCall, signal: AbortSignal): Promise<Verdict> {
  const matchers: HookCallbackMatcher[] = (hooks[call.event] ?? []).filter((m) => matches(m.matcher, call.tool));
  const said: Said[] = [];
  for (const matcher of matchers) for (const hook of matcher.hooks) said.push(read(await hook(hookInput(call), call.id, { signal })));
  const first = (decision: string) => said.find((s) => s.decision === decision);
  const deny = first("deny");
  if (deny) return { decision: "deny", reason: deny.reason || "Weft's guards turned this call away." };
  const ask = first("ask");
  if (ask) return { decision: "ask", reason: ask.reason || "Weft's guards ask before this call." };
  const context = said.flatMap((s) => (s.context ? [s.context] : [])).join("\n\n");
  const feedback = said.flatMap((s) => (s.decision === "block" && s.reason ? [s.reason] : [])).join("\n\n");
  return { decision: "allow", ...(context ? { context } : {}), ...(feedback ? { feedback } : {}) };
}
