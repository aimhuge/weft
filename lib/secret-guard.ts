// Threads see a secret's name, never its value (docs/architecture/secrets.md): once a value is in a
// thread's context it's in the model request and the transcripts on disk for good. This PreToolUse
// hook turns away the obvious ways a thread reads one: a .env file, Weft's own sign-in token, or a dump
// of the environment. A hook, not canUseTool, because canUseTool only hears about tools that would ask
// you; reads are allowed without asking, and bypassPermissions skips it entirely.
// It's a strong default, not a sandbox: a script that reads the file itself still can.
//
// The check itself is split across three modules:
// - lib/secret-guard-files.ts: isSecretFile and its brace/glob expansion
// - lib/secret-guard-bash.ts: bashVerdict, the bash-command verdict
// - lib/secret-guard-tool.ts: toolVerdict, the per-tool verdict
// This file wires the SDK hook on top of those.

import type { HookCallback, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { fromCwd } from "./secret-guard-files";
import { toolVerdict } from "./secret-guard-tool";

export { bashVerdict, stripPrefixes, unwrapEnv } from "./secret-guard-bash";
export { isSecretFile } from "./secret-guard-files";
export { toolVerdict };

export const secretGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse") return Promise.resolve({});
  const why = fromCwd(input.cwd, () => toolVerdict(input.tool_name, input.tool_input));
  return Promise.resolve(
    why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {},
  );
};

export const SECRET_GUARD_MATCHER: HookCallbackMatcher = {
  matcher: "Read|Edit|MultiEdit|Write|NotebookRead|NotebookEdit|Grep|Glob|LS|Bash|mcp__browser__open_url",
  hooks: [secretGuard],
};

export const SECRET_GUARD_HOOKS: Partial<Record<HookEvent, HookCallbackMatcher[]>> = { PreToolUse: [SECRET_GUARD_MATCHER] };
